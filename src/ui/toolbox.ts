// The Toolbox: one scrolling right-sidebar ItemView. The active chart and its
// reading actions stay at the top; authoring, arrangement, reference, and
// output use disclosures.
import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type ChordProStudioPlugin from "../main";
import { KEY_OPTIONS, diatonicChords, describeChord, chordNotes, Mode } from "../core/theory";
import { findChord, positionToDiagram, chordRoot, chordVariations } from "../core/chords";
import { SECTION_LABELS, transposeKeyName } from "../core/chordpro";
import { applyFrontmatter } from "../core/frontmatter";
import { detectForm, parseSections, parseForm, formToString, fullLabel, canonicalToken, FormToken, BodySection } from "../core/form";
import { drawDiagram } from "./diagram";

export const TOOLBOX_VIEW_TYPE = "chordpro-studio-toolbox";

const HEADER_SNIPPETS = ["title", "artist", "key", "capo", "time", "tempo", "note"];
type ToolboxSection = "create" | "chart" | "order" | "reference" | "output";

const TOOLBOX_SECTIONS: Record<ToolboxSection, { label: string; icon: string }> = {
	create: { label: "Create", icon: "plus-circle" },
	chart: { label: "Chart", icon: "music-2" },
	order: { label: "Form", icon: "list-ordered" },
	reference: { label: "Reference", icon: "book-open" },
	output: { label: "Display & output", icon: "send" }
};

// Shape keys guitarists consider open-chord friendly, per mode. Used to
// highlight good capo positions in the reference capo table.
const EASY_SHAPE_KEYS: Record<Mode, Set<string>> = {
	major: new Set(["C", "G", "D", "A", "E"]),
	minor: new Set(["Am", "Em", "Dm"])
};

export class ToolboxView extends ItemView {
	private plugin: ChordProStudioPlugin;
	private currentChartNameEl!: HTMLElement;
	private currentChartPathEl!: HTMLElement;
	private previewBtn!: HTMLButtonElement;
	private performBtn!: HTMLButtonElement;
	private keySelect: HTMLSelectElement | null = null;
	private chordGridEl!: HTMLElement;
	private formEl!: HTMLElement;
	private referenceEl!: HTMLElement;
	/** Fingering dock: slides up from the bottom of the sidebar. */
	private dockEl!: HTMLElement;
	private dockBodyEl!: HTMLElement;
	private dockBackEl!: HTMLElement;
	/** Recently viewed dock chords; the back arrow steps through them. */
	private dockHistory: string[] = [];
	private dockSymbol: string | null = null;
	private transposeTargetId: string | null = null;
	/** Form editor state for the tracked song. */
	private formFile: TFile | null = null;
	private formTokens: FormToken[] = [];
	private formSections: BodySection[] = [];
	private formClearArmed = false;
	/** Signature of the last rendered form state, to skip no-op rebuilds. */
	private formSignature = "";

	constructor(leaf: WorkspaceLeaf, plugin: ChordProStudioPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TOOLBOX_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "ChordPro Studio";
	}

	getIcon(): string {
		return "guitar";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("cps-toolbox");

		const scroll = root.createDiv({ cls: "cps-toolbox-scroll" });
		this.buildCurrentChart(scroll);
		const create = this.buildDisclosure(scroll, "create");
		this.buildCreateActions(create);
		const chart = this.buildDisclosure(scroll, "chart");
		this.buildKeySection(chart);
		this.buildSectionInserts(chart);
		this.buildHeaderInserts(chart);
		const order = this.buildDisclosure(scroll, "order");
		this.buildFormSection(order);
		const reference = this.buildDisclosure(scroll, "reference");
		this.buildReferenceSection(reference);
		const output = this.buildDisclosure(scroll, "output");
		this.buildOutput(output);

		this.buildDock(root);

		this.renderChordGrid();
		this.renderReference();
		await this.refreshForm(this.plugin.getActiveSongFile());
	}

	private normalizedOpenSections(): Set<ToolboxSection> {
		const aliases: Record<string, ToolboxSection> = { song: "chart", tools: "output" };
		const valid = new Set<ToolboxSection>(Object.keys(TOOLBOX_SECTIONS) as ToolboxSection[]);
		const open = new Set<ToolboxSection>();
		for (const stored of this.plugin.settings.toolboxOpenSections) {
			const section = aliases[stored] ?? stored;
			if (valid.has(section)) open.add(section);
		}
		return open;
	}

	private buildDisclosure(root: HTMLElement, id: ToolboxSection): HTMLElement {
		const config = TOOLBOX_SECTIONS[id];
		const details = root.createEl("details", { cls: "cps-toolbox-disclosure" });
		details.dataset.section = id;
		details.open = this.normalizedOpenSections().has(id);
		const summary = details.createEl("summary");
		const icon = summary.createSpan({ cls: "cps-disclosure-icon" });
		setIcon(icon, config.icon);
		summary.createSpan({ text: config.label });
		const body = details.createDiv({ cls: "cps-toolbox-disclosure-body" });
		details.addEventListener("toggle", () => {
			const open = this.normalizedOpenSections();
			if (details.open) open.add(id);
			else open.delete(id);
			this.plugin.settings.toolboxOpenSections = [...open];
			void this.plugin.saveSettings();
		});
		return body;
	}

	private buildCurrentChart(root: HTMLElement): void {
		const header = root.createEl("section", { cls: "cps-current-chart" });
		header.createDiv({ cls: "cps-current-chart-label", text: "Current chart" });
		this.currentChartNameEl = header.createDiv({ cls: "cps-current-chart-name" });
		this.currentChartPathEl = header.createDiv({ cls: "cps-current-chart-path" });
		const actions = header.createDiv({ cls: "cps-current-chart-actions" });
		this.previewBtn = this.createActionButton(actions, "eye", "Preview", "Open chart preview");
		this.previewBtn.addEventListener("click", () => void this.plugin.openChartPreview());
		this.performBtn = this.createActionButton(actions, "presentation", "Perform", "Enter performance mode");
		this.performBtn.addEventListener("click", () => void this.plugin.enterPerformanceMode());
	}

	private createActionButton(root: HTMLElement, iconName: string, label: string, ariaLabel = label): HTMLButtonElement {
		const button = root.createEl("button", { cls: "cps-action-btn" });
		button.setAttribute("aria-label", ariaLabel);
		const icon = button.createSpan({ cls: "cps-action-icon" });
		setIcon(icon, iconName);
		button.createSpan({ text: label });
		return button;
	}

	private syncCurrentChart(file: TFile | null): void {
		if (!this.currentChartNameEl) return;
		const folder = file?.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "Vault root";
		this.currentChartNameEl.setText(file?.basename ?? "No song open");
		this.currentChartPathEl.setText(file ? folder : "Open a song to preview or perform");
		this.currentChartPathEl.toggleClass("is-empty", !file);
		this.previewBtn.disabled = !file;
		this.performBtn.disabled = !file;
	}

	private buildCreateActions(root: HTMLElement): void {
		const section = root.createDiv({ cls: "cps-section" });
		section.createDiv({ cls: "cps-section-hint", text: "Start a chart or clean up lyrics already on the clipboard." });
		const grid = section.createDiv({ cls: "cps-action-grid" });
		const actions: Array<[string, string, () => void, string]> = [
			["file-plus-2", "New song", () => this.plugin.runNewSong(), "mod-cta"],
			["clipboard-paste", "Smart paste", () => this.plugin.runSmartPaste(), ""],
			["wand-2", "Format lyrics", () => this.plugin.runFormatLyrics(), ""]
		];
		for (const [icon, label, action, extra] of actions) {
			const button = this.createActionButton(grid, icon, label);
			if (extra) button.addClass(extra);
			button.addEventListener("click", action);
		}
	}

	/** Called after auto-key follow changes the plugin key. */
	refreshKey(): void {
		if (this.keySelect && this.keySelect.value !== this.plugin.settings.lastKeyId) {
			this.keySelect.value = this.plugin.settings.lastKeyId;
		}
		this.renderChordGrid();
		this.renderReference();
	}

	// --- 5a: key selector and diatonic chords ---

	private buildKeySection(root: HTMLElement): void {
		const section = root.createDiv({ cls: "cps-section" });
		section.createDiv({ cls: "cps-section-title", text: "Key" });

		const select = section.createEl("select", { cls: "dropdown cps-key-select" });
		this.keySelect = select;
		for (const option of KEY_OPTIONS) {
			select.createEl("option", { text: option.label, value: option.id });
		}
		select.value = this.plugin.settings.lastKeyId;
		select.addEventListener("change", () => {
			this.plugin.settings.lastKeyId = select.value;
			void this.plugin.saveSettings();
			this.renderChordGrid();
			this.renderReference();
		});

		this.chordGridEl = section.createDiv({ cls: "cps-chord-grid" });
	}

	private currentKey(): { tonic: string; mode: Mode } {
		const option = KEY_OPTIONS.find((k) => k.id === this.plugin.settings.lastKeyId) ?? KEY_OPTIONS[0];
		return { tonic: option.tonic, mode: option.mode };
	}

	private renderChordGrid(): void {
		const { tonic, mode } = this.currentKey();
		const chords = diatonicChords(tonic, mode);
		this.chordGridEl.empty();

		for (const chord of chords) {
			const btn = this.chordGridEl.createDiv({ cls: "cps-chord-btn" });
			btn.setAttribute("title", `${describeChord(chord.symbol)}: ${chord.notes.join(" ")}`);

			const insertArea = btn.createDiv({ cls: "cps-chord-insert" });
			insertArea.createDiv({ cls: "cps-chord-numeral", text: chord.numeral });
			insertArea.createDiv({ cls: "cps-chord-name", text: chord.symbol });
			insertArea.addEventListener("click", () => {
				this.plugin.insertText(`[${chord.symbol}]`);
			});

			const detailBtn = btn.createDiv({ cls: "cps-chord-detail-btn" });
			setIcon(detailBtn, "guitar");
			detailBtn.setAttribute("aria-label", `Show ${chord.symbol} fingerings`);
			detailBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				this.showChordDock(chord.symbol);
			});
		}
	}

	// --- 5b: fingering dock (roadmap: clickable fingering slide-up panel) ---

	private buildDock(root: HTMLElement): void {
		this.dockEl = root.createDiv({ cls: "cps-chord-dock" });
		const header = this.dockEl.createDiv({ cls: "cps-detail-header" });
		this.dockBackEl = header.createDiv({ cls: "cps-detail-close cps-dock-back" });
		setIcon(this.dockBackEl, "arrow-left");
		this.dockBackEl.setAttribute("aria-label", "Back to the previous chord");
		this.dockBackEl.addEventListener("click", () => this.dockBack());
		header.createSpan({ cls: "cps-detail-name cps-dock-title" });
		const closeBtn = header.createDiv({ cls: "cps-detail-close" });
		setIcon(closeBtn, "x");
		closeBtn.setAttribute("aria-label", "Close fingering panel");
		closeBtn.addEventListener("click", () => this.hideDock());
		this.dockBodyEl = this.dockEl.createDiv({ cls: "cps-dock-body" });
	}

	hideDock(): void {
		this.dockEl.removeClass("is-open");
	}

	/** Step back through recently viewed chords (mid-rehearsal breadcrumbs). */
	private dockBack(): void {
		const previous = this.dockHistory.pop();
		if (previous) this.showChordDock(previous, true);
	}

	private syncDockBack(): void {
		this.dockBackEl.toggleClass("is-hidden", this.dockHistory.length === 0);
	}

	/**
	 * Show fingerings for a chord in the bottom dock. Called from the palette
	 * guitar buttons and from tapping any chord in a rendered chart.
	 */
	showChordDock(symbol: string, fromHistory = false): void {
		// Open first, populate second. Nothing computed below should be able to
		// leave the dock invisible: a failure must be visible, not silent.
		this.dockEl.addClass("is-open");
		try {
			this.populateDock(symbol, fromHistory);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.dockBodyEl.empty();
			this.dockBodyEl.createDiv({ cls: "cps-detail-empty", text: `Fingering error: ${message}` });
			console.error("[ChordPro Studio] showChordDock failed for", symbol, err);
		}
	}

	private populateDock(symbol: string, fromHistory: boolean): void {
		if (!fromHistory && this.dockSymbol && this.dockSymbol !== symbol) {
			this.dockHistory.push(this.dockSymbol);
			if (this.dockHistory.length > 12) this.dockHistory.shift();
		}
		this.dockSymbol = symbol;
		this.syncDockBack();
		const titleEl = this.dockEl.querySelector(".cps-dock-title");
		const body = this.dockBodyEl;
		body.empty();

		// Variation picker: every quality/voicing chords-db has for this root
		// (Dm, Dsus4, D7, Dadd9, D/F#, ...). Selecting one re-renders below.
		const root = chordRoot(symbol) ?? symbol;
		const variations = chordVariations(root);
		// The tapped spelling stays selectable even when chords-db spells it
		// differently ("AM7" vs "Amaj7"); findChord resolves the alias.
		if (!variations.includes(symbol)) variations.unshift(symbol);
		const select = body.createEl("select", { cls: "dropdown cps-variation-select" });
		for (const variation of variations) {
			select.createEl("option", { text: variation, value: variation });
		}
		select.value = symbol;

		const notesEl = body.createDiv({ cls: "cps-detail-notes" });
		const diagramsEl = body.createDiv();
		const render = (current: string): void => {
			if (titleEl instanceof HTMLElement) titleEl.setText(current);
			notesEl.setText(`${describeChord(current)}: ${chordNotes(current).join(" ")}`);
			diagramsEl.empty();

			const dbChord = findChord(current);
			if (!dbChord || dbChord.positions.length === 0) {
				diagramsEl.createDiv({ cls: "cps-detail-empty", text: `No diagrams found for ${current}.` });
				return;
			}

			const row = diagramsEl.createDiv({ cls: "cps-diagram-row" });
			for (const position of dbChord.positions) {
				const cell = row.createDiv({ cls: "cps-diagram-cell" });
				const diagramEl = cell.createDiv({ cls: "cps-diagram" });
				// A diagram that fails to draw must not take the dock down with
				// it: report the failure in place and keep the panel usable.
				try {
					drawDiagram(diagramEl, positionToDiagram(current, position));
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					diagramEl.addClass("cps-detail-empty");
					diagramEl.setText(message);
					console.error("[ChordPro Studio] diagram render failed for", current, err);
				}

				const insertBtn = cell.createEl("button", { cls: "cps-diagram-insert", text: "Insert" });
				insertBtn.addEventListener("click", () => {
					this.plugin.insertText(`[${current}]`);
				});
			}
		};

		select.addEventListener("change", () => {
			// The back arrow should return to what was actually on screen,
			// so a picked variation becomes the current dock chord.
			this.dockSymbol = select.value;
			render(select.value);
		});
		render(symbol);
	}

	// --- Form editor (v0.3.0 roadmap) ---

	private buildFormSection(root: HTMLElement): void {
		const section = root.createDiv({ cls: "cps-section" });
		section.createDiv({
			cls: "cps-section-hint",
			text: "The form is the song's roadmap: the order you play sections such as Verse, Chorus, Bridge, then Chorus again."
		});
		this.formEl = section.createDiv({ cls: "cps-form-editor" });
	}

	/**
	 * Sync the form editor to a song file. When nothing relevant changed
	 * (same file, same form, same sections) the rebuild is skipped entirely,
	 * so background saves of the note do not wipe the selection or text the
	 * user is typing into the custom-cue input.
	 */
	async refreshForm(file: TFile | null): Promise<void> {
		this.syncCurrentChart(file);
		if (!this.formEl) return;
		if (!file) {
			if (this.formSignature === "empty") return;
			this.formSignature = "empty";
			this.formFile = null;
			this.formTokens = [];
			this.formSections = [];
			this.formClearArmed = false;
			this.renderForm(null);
			return;
		}

		const raw = await this.app.vault.cachedRead(file);
		const resolved = applyFrontmatter(raw);
		const formString = detectForm(resolved);
		const sections = parseSections(resolved).sections;

		const signature =
			file.path +
			" " +
			(formString ?? "") +
			" " +
			sections.map((s) => `${s.name}|${s.number ?? ""}|${s.content.length}`).join(";");
		if (signature === this.formSignature) return;

		const sameFile = this.formFile?.path === file.path;
		const sameForm = sameFile && (formString ?? "") === formToString(this.formTokens);
		this.formSignature = signature;
		this.formFile = file;
		this.formSections = sections;
		if (!sameForm) {
			this.formTokens = formString ? parseForm(formString) : [];
			this.formClearArmed = false;
		}
		this.renderForm(file);
	}

	private renderForm(file: TFile | null): void {
		const el = this.formEl;
		el.empty();

		if (!file) {
			el.createDiv({ cls: "cps-form-empty", text: "Open a song to build its form." });
			return;
		}

		el.createDiv({ cls: "cps-form-file", text: file.basename });
		el.createDiv({
			cls: "cps-form-hint",
			text: "Arrange the sections in performance order. Add a section again when it repeats."
		});

		if (this.formTokens.length === 0) {
			el.createDiv({ cls: "cps-form-empty", text: "No form yet." });
		} else {
			const list = el.createDiv({ cls: "cps-form-order" });
			this.formTokens.forEach((token, index) => {
				const row = list.createDiv({ cls: "cps-form-row" });
				row.createSpan({ cls: "cps-form-number", text: `${index + 1}.` });
				row.createSpan({ cls: "cps-form-label", text: fullLabel(token) });
				const up = row.createEl("button", { cls: "cps-form-row-btn", text: "↑" });
				up.setAttribute("aria-label", `Move ${fullLabel(token)} earlier`);
				up.disabled = index === 0;
				up.addEventListener("click", () => this.moveToken(index, -1));
				const down = row.createEl("button", { cls: "cps-form-row-btn", text: "↓" });
				down.setAttribute("aria-label", `Move ${fullLabel(token)} later`);
				down.disabled = index === this.formTokens.length - 1;
				down.addEventListener("click", () => this.moveToken(index, 1));
				const remove = row.createEl("button", { cls: "cps-form-row-btn cps-form-remove", text: "Remove" });
				remove.setAttribute("aria-label", `Remove ${fullLabel(token)} from form`);
				remove.addEventListener("click", () => {
					this.formTokens.splice(index, 1);
					this.formClearArmed = false;
					void this.commitForm();
				});
			});
			el.createDiv({ cls: "cps-form-status", text: "Saved automatically" });
		}

		if (this.formSections.length === 0) {
			// Nothing to tap yet: the note declares no sections. Offer the
			// section inserts right here instead of pointing at another tab.
			el.createDiv({
				cls: "cps-form-empty",
				text: "This song has no section headers yet. Add the sections you need to the note first."
			});
			const grid = el.createDiv({ cls: "cps-snippet-grid" });
			for (const name of this.sectionInsertNames()) {
				const label = fullLabel(canonicalToken(name));
				const btn = grid.createEl("button", { cls: "cps-snippet-btn", text: label });
				btn.addEventListener("click", () => {
					this.plugin.insertSection(`{comment: ${label}}`);
				});
			}
		} else {
			if (this.formTokens.length === 0) {
				const conflicts = this.fileOrderConflicts();
				const useOrder = el.createEl("button", { cls: "cps-action-btn mod-cta", text: "Use sections in file order" });
				useOrder.disabled = conflicts.length > 0;
				useOrder.addEventListener("click", () => {
					this.formTokens = this.formSections.map((section) => canonicalToken(section.label));
					void this.commitForm();
				});
				if (conflicts.length > 0) {
					el.createDiv({
						cls: "cps-form-warning",
						text: `Rename repeated sections with different lyrics before using file order: ${conflicts.join(", ")}.`
					});
				}
			}
			el.createDiv({ cls: "cps-form-hint", text: "Add to form:" });
			const addRow = el.createDiv({ cls: "cps-form-add" });
			for (const section of this.formSections) {
				const token = canonicalToken(section.label);
				const btn = addRow.createEl("button", { cls: "cps-snippet-btn", text: "Add " + section.label });
				btn.setAttribute("title", "Append " + fullLabel(token));
				btn.addEventListener("click", () => {
					this.formTokens.push(token);
					this.formClearArmed = false;
					void this.commitForm();
				});
			}
		}
		const advanced = el.createEl("details", { cls: "cps-form-advanced" });
		advanced.createEl("summary", { text: "Advanced: add a custom cue" });
		const cueWrap = advanced.createDiv({ cls: "cps-form-cue" });
		const cueInput = cueWrap.createEl("input", {
			type: "text",
			cls: "cps-form-cue-input",
			attr: { placeholder: "Custom cue (Ending, Prayer...)" }
		});
		const cueAdd = cueWrap.createEl("button", { cls: "cps-snippet-btn", text: "+" });
		const addCue = () => {
			const value = cueInput.value.trim();
			if (!value) return;
			this.formTokens.push(canonicalToken(value));
			cueInput.value = "";
			this.formClearArmed = false;
			void this.commitForm();
		};
		cueAdd.addEventListener("click", addCue);
		cueInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				addCue();
			}
		});
		if (this.formTokens.length > 0) {
			const clear = el.createEl("button", {
				cls: "cps-form-clear",
				text: this.formClearArmed ? "Confirm clear form" : "Clear form"
			});
			clear.addEventListener("click", () => {
				if (!this.formClearArmed) {
					this.formClearArmed = true;
					this.renderForm(file);
					return;
				}
				this.formTokens = [];
				this.formClearArmed = false;
				void this.commitForm();
			});
		}
	}

	private moveToken(i: number, delta: number): void {
		const j = i + delta;
		if (j < 0 || j >= this.formTokens.length) return;
		const [token] = this.formTokens.splice(i, 1);
		this.formTokens.splice(j, 0, token);
		this.formClearArmed = false;
		void this.commitForm();
	}

	private fileOrderConflicts(): string[] {
		const byLabel = new Map<string, { label: string; content: Set<string> }>();
		for (const section of this.formSections) {
			const key = section.label.trim().toLowerCase();
			const entry = byLabel.get(key) ?? { label: section.label, content: new Set<string>() };
			entry.content.add(section.content.trim());
			byLabel.set(key, entry);
		}
		return [...byLabel.values()].filter((entry) => entry.content.size > 1).map((entry) => entry.label);
	}

	private async commitForm(): Promise<void> {
		if (!this.formFile) return;
		const value = this.formTokens.length > 0 ? formToString(this.formTokens) : null;
		await this.plugin.writeForm(this.formFile, value);
		this.renderForm(this.formFile);
	}

	// --- 5c: section and header inserts ---

	/** Standard section inserts. Verse keeps its commonly used numbered pair. */
	private sectionInsertNames(): string[] {
		const candidates = SECTION_LABELS.flatMap((label) =>
			label === "Verse" ? ["verse 1", "verse 2"] : [label.toLowerCase()]
		);
		const labels = new Set<string>();
		return candidates.filter((name) => {
			const label = fullLabel(canonicalToken(name));
			if (labels.has(label)) return false;
			labels.add(label);
			return true;
		});
	}

	private buildSectionInserts(root: HTMLElement): void {
		const section = root.createDiv({ cls: "cps-section" });
		section.createDiv({ cls: "cps-section-title", text: "Sections" });
		const grid = section.createDiv({ cls: "cps-snippet-grid" });
		for (const name of this.sectionInsertNames()) {
			const label = fullLabel(canonicalToken(name));
			const directive = `{comment: ${label}}`;
			const btn = grid.createEl("button", { cls: "cps-snippet-btn", text: label });
			btn.addEventListener("click", () => {
				this.plugin.insertSection(directive);
			});
		}
	}

	private buildHeaderInserts(root: HTMLElement): void {
		const section = root.createDiv({ cls: "cps-section" });
		section.createDiv({ cls: "cps-section-title", text: "Song details" });
		const grid = section.createDiv({ cls: "cps-snippet-grid" });
		for (const name of HEADER_SNIPPETS) {
			const btn = grid.createEl("button", { cls: "cps-snippet-btn", text: name[0].toUpperCase() + name.slice(1) });
			btn.setAttribute("title", `Insert {${name}: }`);
			btn.addEventListener("click", () => {
				// Cursor lands between ": " and "}" so typing starts immediately.
				this.plugin.insertText(`{${name}: }`, 1);
			});
		}
	}

	// --- Reference: capo table + transpose map (roadmap 2026-07-09) ---

	private buildReferenceSection(root: HTMLElement): void {
		const section = root.createDiv({ cls: "cps-section" });
		const audioBtn = this.createActionButton(section, "audio-lines", "Reference audio", "Set reference audio");
		audioBtn.addEventListener("click", () => this.plugin.runSetAudioLink());
		section.createDiv({ cls: "cps-section-hint", text: "Link a recording or compare keys and capo positions." });
		this.referenceEl = section.createDiv();
	}

	private renderReference(): void {
		const { tonic, mode } = this.currentKey();
		const minor = mode === "minor";
		this.referenceEl.empty();

		// Capo table: standard capo key chart direction (roadmap 2026-07-14 bug
		// fix). Keep playing the current key's shapes; each fret raises the
		// sounding key one semitone: C shapes with capo 1 sound in C#/Db.
		const capoDetails = this.referenceEl.createEl("details", { cls: "cps-ref" });
		capoDetails.createEl("summary", { text: "Capo table" });
		const keyLabel = tonic + (minor ? "m" : "");
		capoDetails.createDiv({
			cls: "cps-ref-hint",
			text: `Playing ${keyLabel} shapes with a capo:`
		});
		const capoTable = capoDetails.createEl("table", { cls: "cps-ref-table" });
		const capoHead = capoTable.createEl("tr");
		capoHead.createEl("th", { text: "Capo" });
		capoHead.createEl("th", { text: "Sounds in" });
		for (let capo = 0; capo <= 12; capo++) {
			const sounding = transposeKeyName(tonic, minor, capo);
			const row = capoTable.createEl("tr");
			row.createEl("td", { text: capo === 0 ? "none" : String(capo) });
			row.createEl("td", { text: minor ? sounding : `${sounding} major` });
		}

		// The reverse question a worship guitarist actually asks: the song
		// sounds in the current key; where can the capo go so the fingered
		// shapes fall in an open-chord key?
		const shapeDetails = this.referenceEl.createEl("details", { cls: "cps-ref" });
		shapeDetails.createEl("summary", { text: "Easy shapes finder" });
		shapeDetails.createDiv({
			cls: "cps-ref-hint",
			text: `To sound in ${keyLabel}, play:`
		});
		const shapeTable = shapeDetails.createEl("table", { cls: "cps-ref-table" });
		const shapeHead = shapeTable.createEl("tr");
		shapeHead.createEl("th", { text: "Capo" });
		shapeHead.createEl("th", { text: "Shapes" });
		for (let capo = 0; capo <= 7; capo++) {
			const shape = transposeKeyName(tonic, minor, -capo);
			const row = shapeTable.createEl("tr");
			if (EASY_SHAPE_KEYS[mode].has(shape)) {
				row.addClass("cps-ref-easy");
				row.setAttribute("title", "Open-chord friendly");
			}
			row.createEl("td", { text: capo === 0 ? "none" : String(capo) });
			row.createEl("td", { text: minor ? shape : `${shape} major` });
		}

		// Transpose map: current key's diatonic chords next to a target key's.
		const mapDetails = this.referenceEl.createEl("details", { cls: "cps-ref" });
		mapDetails.createEl("summary", { text: "Transpose map" });
		const mapBody = mapDetails.createDiv();

		const targetSelect = mapBody.createEl("select", { cls: "dropdown cps-ref-target" });
		const sameMode = KEY_OPTIONS.filter((k) => k.mode === mode);
		for (const option of sameMode) {
			targetSelect.createEl("option", { text: `to ${option.label}`, value: option.id });
		}
		const validTarget = sameMode.some((k) => k.id === this.transposeTargetId);
		targetSelect.value = validTarget && this.transposeTargetId ? this.transposeTargetId : sameMode[0].id;

		const tableEl = mapBody.createDiv();
		const renderMap = () => {
			tableEl.empty();
			const target = KEY_OPTIONS.find((k) => k.id === targetSelect.value) ?? sameMode[0];
			const from = diatonicChords(tonic, mode);
			const to = diatonicChords(target.tonic, target.mode);
			const table = tableEl.createEl("table", { cls: "cps-ref-table" });
			const head = table.createEl("tr");
			head.createEl("th", { text: "" });
			head.createEl("th", { text: tonic + (minor ? "m" : "") });
			head.createEl("th", { text: target.tonic + (minor ? "m" : "") });
			from.forEach((chord, i) => {
				const row = table.createEl("tr");
				row.createEl("td", { cls: "cps-ref-numeral", text: chord.numeral });
				row.createEl("td", { text: chord.symbol });
				row.createEl("td", { text: to[i]?.symbol ?? "" });
			});
		};
		targetSelect.addEventListener("change", () => {
			this.transposeTargetId = targetSelect.value;
			renderMap();
		});
		renderMap();
	}

	// --- Output ---

	private buildOutput(root: HTMLElement): void {
		const section = root.createDiv({ cls: "cps-section" });
		section.createDiv({ cls: "cps-section-hint", text: "Prepare the current chart or service for another device." });
		const grid = section.createDiv({ cls: "cps-action-grid" });
		const actions: Array<[string, string, () => void, string]> = [
			["file-output", "Export chart", () => this.plugin.runExportChordpro(), ""],
			["folder-output", "Export set", () => this.plugin.runExportShareFolder(), ""]
		];
		for (const [icon, label, action, extra] of actions) {
			const button = this.createActionButton(grid, icon, label);
			if (extra) button.addClass(extra);
			button.addEventListener("click", action);
		}
	}
}
