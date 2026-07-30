// Stage Binder plugin entry point. Registers the Toolbox (right sidebar),
// the chart reading view, the setlist view, performance mode, the ```chordpro
// code block renderer, the hover tooltip editor extension, the importers, and
// the commands (formatter, transpose, autoscroll, setlist navigation).
import { Editor, MarkdownView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { Extension } from "@codemirror/state";
import { formatLyrics } from "./core/formatter";
import { applyFrontmatter, extractChordproBlocks, metaToDirectives, splitFrontmatter, yamlValue } from "./core/frontmatter";
import {
	AccidentalsPref,
	NOTE_CHROMA,
	SECTION_DIRECTIVE_RE,
	SECTION_LABELS,
	detectAudio,
	detectKey,
	setAccidentalsPref,
	transposeKeyName,
	transposeSource
} from "./core/chordpro";
import { KEY_OPTIONS, Mode, diatonicChords } from "./core/theory";
import { prepareSongText, shareFileName } from "./core/share";
import { songLibraryFolderForExtension } from "./core/import";
import { buildCcliReport, CcliReport, isLikelySong, parseServiceDate, ServiceUsage, songMetaFromText, SongUsage } from "./core/ccli";
import { ToolboxView, TOOLBOX_VIEW_TYPE } from "./ui/toolbox";
import { DiagramPanelView, DIAGRAM_PANEL_VIEW_TYPE } from "./ui/diagram-panel";
import { ChartView, CHART_VIEW_TYPE } from "./ui/chart-view";
import { SetlistView, SETLIST_VIEW_TYPE } from "./ui/setlist-view";
import { RunsheetView, RUNSHEET_VIEW_TYPE } from "./ui/runsheet-view";
import { PerformanceMode } from "./ui/performance";
import { AUDIO_EXTENSIONS, collectSetlistSongs, isSongFile, isStageFileEnabled, SetlistEntry } from "./ui/render-song";
import type { StageFileTypes } from "./ui/render-song";
import { renderChordproBlock } from "./ui/codeblock";
import { chordHoverExtension } from "./ui/hover";
import { chordHighlightExtension } from "./ui/chord-highlight";
import { ChordSuggest } from "./ui/suggest";
import { StageBinderSettingTab } from "./ui/settings";
import { ImportSongsModal, SmartPasteModal } from "./ui/import-modal";
import { AudioLinkModal, CcliReportModal, NewSongModal, TransposeKeyModal } from "./ui/modals";

/** Where the song's chord set renders (v0.5.0; replaces showDiagramStrip). */
export type DiagramPlacement = "off" | "chart-top" | "inline" | "sidebar";

export type PerfAdvance = "page" | "section" | "song";

/** Stage theme (roadmap 2026-07-14): light reads better under stage wash. */
export type PerfTheme = "light" | "dark";

/** Escape a value for a markdown table cell (pipes and line breaks). */
function escapeCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

interface StageBinderSettings {
	lastKeyId: string;
	diagramPlacement: DiagramPlacement;
	/** Tapping a chord in a rendered chart opens the fingering dock. */
	chordTapDock: boolean;
	chordAutocomplete: boolean;
	/** Appearance overrides; empty string = theme default. */
	chordColor: string;
	lyricsColor: string;
	sectionColor: string;
	titleColor: string;
	/** Sizes in percent; 100 = chart default. */
	chordScale: number;
	lyricsScale: number;
	/** v0.2.0 */
	accidentals: AccidentalsPref;
	chartFont: string;
	chordWeight: number;
	lineHeight: number;
	diagramScale: number;
	chartColumns: number;
	autoscrollSpeed: number;
	songsFolder: string;
	setlistsFolder: string;
	includeChordProInStage: boolean;
	includeMarkdownInStage: boolean;
	includePdfInStage: boolean;
	includeImagesInStage: boolean;
	/** v0.3.0 */
	followNoteKey: boolean;
	performanceZoom: number;
	setlistContinuous: boolean;
	/** v0.4.0 */
	midiPedal: boolean;
	midiPrevCodes: string;
	editorChordColors: boolean;
	editorChordColor: string;
	editorHoverDiagrams: boolean;
	formDefaultOn: boolean;
	formStripPreview: boolean;
	formStripPerformance: boolean;
	formHighlight: boolean;
	/** Per-view column overrides; 0 = inherit chartColumns (now 1-3). */
	previewColumns: number;
	performanceColumns: number;
	/** Vault folder the export commands write into; "" = next to the note. */
	exportFolder: string;
	perfShowHeader: boolean;
	perfAdvance: PerfAdvance;
	/** v0.7.0 */
	perfUpNext: boolean;
	perfTheme: PerfTheme;
	/** v0.7.1: folder the CCLI report scans for service notes; "" = whole vault. */
	serviceFolder: string;
	/** Expanded sections in the job-based Toolbox. Legacy song/tools ids migrate in the view. */
	toolboxOpenSections: string[];
}

const DEFAULT_SETTINGS: StageBinderSettings = {
	lastKeyId: "C-major",
	diagramPlacement: "chart-top",
	chordTapDock: true,
	chordAutocomplete: true,
	chordColor: "",
	lyricsColor: "",
	sectionColor: "",
	titleColor: "",
	chordScale: 100,
	lyricsScale: 100,
	accidentals: "auto",
	chartFont: "",
	chordWeight: 700,
	lineHeight: 135,
	diagramScale: 100,
	chartColumns: 1,
	autoscrollSpeed: 30,
	songsFolder: "Songs",
	setlistsFolder: "Setlists",
	includeChordProInStage: true,
	includeMarkdownInStage: true,
	includePdfInStage: true,
	includeImagesInStage: true,
	followNoteKey: true,
	performanceZoom: 130,
	setlistContinuous: false,
	midiPedal: true,
	midiPrevCodes: "note:59, cc:63, cc:62",
	editorChordColors: true,
	editorChordColor: "",
	editorHoverDiagrams: true,
	formDefaultOn: true,
	formStripPreview: true,
	formStripPerformance: true,
	formHighlight: true,
	previewColumns: 0,
	performanceColumns: 0,
	exportFolder: "",
	perfShowHeader: true,
	perfAdvance: "page",
	perfUpNext: true,
	perfTheme: "light",
	serviceFolder: "",
	toolboxOpenSections: ["chart"]
};

// CSS variables driven by the appearance settings (styles.css consumes them).
const APPEARANCE_VARS: Array<{ cssVar: string; get: (s: StageBinderSettings) => string }> = [
	{ cssVar: "--sb-chord-color", get: (s) => s.chordColor },
	{ cssVar: "--sb-lyrics-color", get: (s) => s.lyricsColor },
	{ cssVar: "--sb-section-color", get: (s) => s.sectionColor },
	{ cssVar: "--sb-title-color", get: (s) => s.titleColor },
	{ cssVar: "--sb-chord-scale", get: (s) => (s.chordScale === 100 ? "" : String(s.chordScale / 100)) },
	{ cssVar: "--sb-lyrics-scale", get: (s) => (s.lyricsScale === 100 ? "" : String(s.lyricsScale / 100)) },
	{ cssVar: "--sb-chart-font", get: (s) => s.chartFont || "" },
	{ cssVar: "--sb-chord-weight", get: (s) => (s.chordWeight === 700 ? "" : String(s.chordWeight)) },
	{ cssVar: "--sb-line-height", get: (s) => (s.lineHeight === 135 ? "" : String(s.lineHeight / 100)) },
	{ cssVar: "--sb-diagram-scale", get: (s) => (s.diagramScale === 100 ? "" : String(s.diagramScale / 100)) },
	{ cssVar: "--sb-editor-chord-color", get: (s) => s.editorChordColor }
];

/** The KEY_OPTIONS id whose tonic sounds like this key, or null. */
function keyOptionIdFor(tonic: string, minor: boolean): string | null {
	const chroma = NOTE_CHROMA[tonic];
	if (chroma === undefined) return null;
	const mode = minor ? "minor" : "major";
	const option = KEY_OPTIONS.find((k) => k.mode === mode && NOTE_CHROMA[k.tonic] === chroma);
	return option?.id ?? null;
}

export default class StageBinderPlugin extends Plugin {
	settings: StageBinderSettings = DEFAULT_SETTINGS;
	performance: PerformanceMode = new PerformanceMode(this);
	private lastMarkdownLeaf: WorkspaceLeaf | null = null;
	/** Mutable so the Editor tab toggles rebuild it and updateOptions applies it. */
	private editorExtensions: Extension[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		// .chordpro files are plain text; open them in the normal editor.
		this.registerExtensions(["chordpro"], "markdown");

		this.registerView(TOOLBOX_VIEW_TYPE, (leaf) => new ToolboxView(leaf, this));
		this.registerView(DIAGRAM_PANEL_VIEW_TYPE, (leaf) => new DiagramPanelView(leaf, this));
		this.registerView(CHART_VIEW_TYPE, (leaf) => new ChartView(leaf, this));
		this.registerView(SETLIST_VIEW_TYPE, (leaf) => new SetlistView(leaf, this));
		this.registerView(RUNSHEET_VIEW_TYPE, (leaf) => new RunsheetView(leaf, this));

		this.registerMarkdownCodeBlockProcessor("chordpro", (source, el, ctx) => {
			renderChordproBlock(this, source, el, ctx.frontmatter as Record<string, unknown> | null);
		});

		this.buildEditorExtensions();
		this.registerEditorExtension(this.editorExtensions);

		// Remember the last markdown editor so Toolbox clicks (which focus the
		// sidebar, not the editor) still know where to insert.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && leaf.view instanceof MarkdownView) {
					this.lastMarkdownLeaf = leaf;
				}
			})
		);

		// Auto-key follow + form editor tracking (v0.3.0).
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				void this.onFileOpen(file);
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const active = this.getActiveSongFile();
				if (active && file.path === active.path) {
					for (const toolbox of this.toolboxViews()) void toolbox.refreshForm(active);
				}
				if (file instanceof TFile) {
					for (const panel of this.diagramPanels()) void panel.refreshIf(file);
				}
			})
		);

		// The sidebar diagram panel normally restores with the workspace; create
		// it only when the setting asks for it and no leaf survived (first
		// enable, or the setting synced in from another device).
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.diagramPlacement === "sidebar") void this.ensureDiagramPanel(false);
		});

		this.addRibbonIcon("guitar", "Open Stage Binder toolbox", () => {
			void this.activateToolbox();
		});

		this.addCommand({
			id: "open-toolbox",
			name: "Open toolbox",
			callback: () => void this.activateToolbox()
		});

		this.addCommand({
			id: "format-lyrics",
			name: "Format pasted lyrics to ChordPro",
			editorCallback: (editor) => this.formatLyricsInEditor(editor)
		});

		this.addCommand({
			id: "open-chart-preview",
			name: "Preview chart (chords over lyrics)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const ok = !!file && (file.extension === "chordpro" || file.extension === "md");
				if (!checking && ok) void this.openChartPreview();
				return ok;
			}
		});

		this.addCommand({
			id: "export-chordpro",
			name: "Export as .chordpro file",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const ok = !!file && file.extension === "md";
				if (!checking && ok && file) void this.exportChordpro(file);
				return ok;
			}
		});

		this.addCommand({
			id: "transpose-in-place",
			name: "Transpose song to key (rewrites file)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const ok = !!file && (file.extension === "chordpro" || file.extension === "md");
				if (!checking && ok && file) void this.transposeInPlace(file);
				return ok;
			}
		});

		this.addCommand({
			id: "new-song",
			name: "New song",
			callback: () => this.runNewSong()
		});

		this.addCommand({
			id: "open-setlist",
			name: "Open setlist (play linked songs in order)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const ok = !!file && file.extension === "md";
				if (!checking && ok && file) void this.openSetlist(file);
				return ok;
			}
		});

		this.addCommand({
			id: "open-runsheet",
			name: "Open run sheet (order of service timeline)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const ok = !!file && file.extension === "md";
				if (!checking && ok && file) void this.openRunsheet(file);
				return ok;
			}
		});

		this.addCommand({
			id: "setlist-print-note",
			name: "Setlist: create print note (for Export to PDF)",
			callback: () => void this.createPrintNote()
		});

		this.addCommand({
			id: "setlist-share-export",
			name: "Setlist: export share folder (.chordpro files for the team)",
			callback: () => this.runExportShareFolder()
		});

		this.addCommand({
			id: "ccli-report",
			name: "CCLI usage report (songs used across dated services)",
			callback: () => this.promptCcliReport()
		});

		this.addCommand({
			id: "import-songs",
			name: "Import songs from files...",
			callback: () => {
				new ImportSongsModal(this).open();
			}
		});

		this.addCommand({
			id: "smart-paste",
			name: "Smart paste song from clipboard",
			callback: () => this.runSmartPaste()
		});

		this.addCommand({
			id: "set-reference-audio",
			name: "Set reference audio (link or vault recording)",
			checkCallback: (checking) => {
				const file = this.getActiveSongFile();
				if (!checking && file) void this.promptAudioLink(file);
				return !!file;
			}
		});

		this.addCommand({
			id: "performance-mode",
			name: "Enter performance mode",
			callback: () => void this.enterPerformanceMode()
		});

		this.addCommand({
			id: "toggle-autoscroll",
			name: "Toggle autoscroll (chart, setlist, or performance)",
			checkCallback: (checking) => {
				if (this.performance.isOpen()) {
					if (!checking) this.performance.toggleAutoscroll();
					return true;
				}
				const view = this.scrollableView();
				if (!checking && view) view.toggleAutoscroll();
				return !!view;
			}
		});

		this.addCommand({
			id: "autoscroll-faster",
			name: "Autoscroll faster",
			checkCallback: (checking) => this.nudgeAutoscrollCommand(checking, 5)
		});

		this.addCommand({
			id: "autoscroll-slower",
			name: "Autoscroll slower",
			checkCallback: (checking) => this.nudgeAutoscrollCommand(checking, -5)
		});

		this.addCommand({
			id: "setlist-next-song",
			name: "Setlist: next song",
			checkCallback: (checking) => {
				const view = this.setlistView();
				if (!checking && view) void view.go(1);
				return !!view;
			}
		});

		this.addCommand({
			id: "setlist-previous-song",
			name: "Setlist: previous song",
			checkCallback: (checking) => {
				const view = this.setlistView();
				if (!checking && view) void view.go(-1);
				return !!view;
			}
		});

		this.addCommand({
			id: "setlist-toggle-continuous",
			name: "Setlist: toggle continuous scroll",
			checkCallback: (checking) => {
				const view = this.setlistView();
				if (!checking && view) void view.toggleContinuous();
				return !!view;
			}
		});

		// Hotkey-bindable diatonic inserts: bind e.g. Cmd+Shift+1..7 in
		// Obsidian's Hotkeys settings; they follow the Toolbox's current key.
		for (let degree = 1; degree <= 7; degree++) {
			this.addCommand({
				id: `insert-diatonic-${degree}`,
				name: `Insert diatonic chord ${degree} of current key`,
				callback: () => this.insertDiatonic(degree)
			});
		}

		for (const label of SECTION_LABELS) {
			this.addCommand({
				id: `insert-section-${label.toLowerCase()}`,
				name: `Insert section: ${label}`,
				callback: () => this.insertSection(`{comment: ${label}}`)
			});
		}

		this.registerEditorSuggest(new ChordSuggest(this));
		this.addSettingTab(new StageBinderSettingTab(this));
		this.applyAppearance();
	}

	onunload(): void {
		this.performance.close();
		for (const { cssVar } of APPEARANCE_VARS) {
			document.body.style.removeProperty(cssVar);
		}
	}

	/** Push the global appearance settings onto the document. */
	applyAppearance(): void {
		setAccidentalsPref(this.settings.accidentals || "auto");
		for (const { cssVar, get } of APPEARANCE_VARS) {
			const value = get(this.settings);
			if (value) document.body.style.setProperty(cssVar, value);
			else document.body.style.removeProperty(cssVar);
		}
	}

	refreshChartViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CHART_VIEW_TYPE)) {
			if (leaf.view instanceof ChartView) void leaf.view.render();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(SETLIST_VIEW_TYPE)) {
			if (leaf.view instanceof SetlistView) void leaf.view.render();
		}
	}

	private toolboxViews(): ToolboxView[] {
		const out: ToolboxView[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(TOOLBOX_VIEW_TYPE)) {
			if (leaf.view instanceof ToolboxView) out.push(leaf.view);
		}
		return out;
	}

	/** Keep the Toolbox header and Form editor on the same source file. */
	syncToolboxFile(file: TFile | null): void {
		for (const toolbox of this.toolboxViews()) void toolbox.refreshForm(file);
	}

	private diagramPanels(): DiagramPanelView[] {
		const out: DiagramPanelView[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(DIAGRAM_PANEL_VIEW_TYPE)) {
			if (leaf.view instanceof DiagramPanelView) out.push(leaf.view);
		}
		return out;
	}

	/** Settings-tab entry point: applies a new placement everywhere at once. */
	async setDiagramPlacement(placement: DiagramPlacement): Promise<void> {
		this.settings.diagramPlacement = placement;
		await this.saveSettings();
		this.refreshChartViews();
		this.rerenderReadingViews();
		if (placement === "sidebar") await this.ensureDiagramPanel(true);
		else this.app.workspace.detachLeavesOfType(DIAGRAM_PANEL_VIEW_TYPE);
	}

	/** Open the sidebar diagram panel, or reveal it if it already exists. */
	async ensureDiagramPanel(reveal: boolean): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(DIAGRAM_PANEL_VIEW_TYPE);
		if (existing.length > 0) {
			if (reveal) await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: DIAGRAM_PANEL_VIEW_TYPE, active: false });
		if (reveal) await this.app.workspace.revealLeaf(leaf);
	}

	// --- editor extensions (v0.6.0) -------------------------------------------

	private buildEditorExtensions(): void {
		this.editorExtensions.length = 0;
		if (this.settings.editorHoverDiagrams) this.editorExtensions.push(chordHoverExtension());
		if (this.settings.editorChordColors) this.editorExtensions.push(chordHighlightExtension());
	}

	/** Settings-tab entry point: rebuild the editor extensions in place. */
	refreshEditorExtensions(): void {
		this.buildEditorExtensions();
		this.app.workspace.updateOptions();
	}

	/** Re-run reading-mode renderers so chordpro blocks pick up new settings. */
	rerenderReadingViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.getMode() === "preview") {
				leaf.view.previewMode.rerender(true);
			}
		}
	}

	/** The Toolbox's currently selected key. */
	currentKey(): { tonic: string; mode: Mode } {
		const option = KEY_OPTIONS.find((k) => k.id === this.settings.lastKeyId) ?? KEY_OPTIONS[0];
		return { tonic: option.tonic, mode: option.mode };
	}

	private insertDiatonic(degree: number): void {
		const { tonic, mode } = this.currentKey();
		const chords = diatonicChords(tonic, mode);
		const chord = chords[degree - 1];
		if (chord) this.insertText(`[${chord.symbol}]`);
	}

	// --- auto-key follow + form tracking (v0.3.0) ----------------------------

	/** The song file the toolbox should work against. */
	getActiveSongFile(): TFile | null {
		const chartFile = this.app.workspace.getActiveViewOfType(ChartView)?.getFile();
		if (chartFile) return chartFile;
		const active = this.app.workspace.getActiveFile();
		if (active && (active.extension === "md" || active.extension === "chordpro")) return active;
		const last = this.fileFromLastLeaf();
		if (last && (last.extension === "md" || last.extension === "chordpro")) return last;
		// Restored workspaces can focus the Toolbox before Obsidian restores a
		// Markdown leaf. The visible Chart still owns the right source file.
		for (const leaf of this.app.workspace.getLeavesOfType(CHART_VIEW_TYPE)) {
			if (leaf.view instanceof ChartView) {
				const file = leaf.view.getFile();
				if (file) return file;
			}
		}
		return null;
	}

	/**
	 * The file Performance should play when no setlist or chart claims the
	 * click. Wider than getActiveSongFile(): a PDF or image opened on its own
	 * is a legitimate stage item, gated on the same included-file-formats
	 * settings the setlist path already honours through isStageFileEnabled().
	 *
	 * Deliberately separate from getActiveSongFile() rather than widening it.
	 * The Toolbox and Chart Preview share that method and genuinely need an
	 * editable text file; handing either a PDF would be a worse bug than the
	 * one this fixes.
	 */
	getActivePerformableFile(): TFile | null {
		const active = this.app.workspace.getActiveFile();
		if (active) return isStageFileEnabled(active, this.getStageFileTypes()) ? active : null;
		const song = this.getActiveSongFile();
		return song && isStageFileEnabled(song, this.getStageFileTypes()) ? song : null;
	}

	private async onFileOpen(file: TFile | null): Promise<void> {
		if (!file || (file.extension !== "md" && file.extension !== "chordpro")) return;

		if (this.settings.followNoteKey) {
			try {
				const raw = await this.app.vault.cachedRead(file);
				const key = detectKey(applyFrontmatter(raw));
				if (key) {
					const id = keyOptionIdFor(key.tonic, key.minor);
					if (id && id !== this.settings.lastKeyId) {
						this.settings.lastKeyId = id;
						await this.saveSettings();
						for (const toolbox of this.toolboxViews()) toolbox.refreshKey();
					}
				}
			} catch (err) {
				console.error("Stage Binder: auto-key failed", err);
			}
		}

		this.syncToolboxFile(file);
		for (const panel of this.diagramPanels()) void panel.setSong(file);
	}

	/**
	 * Write (or clear) a song's form metadata. .md songs keep it in
	 * frontmatter unless the body already declares a {form: ...} directive;
	 * .chordpro songs keep it with the other header directives.
	 */
	async writeForm(file: TFile, value: string | null): Promise<void> {
		return this.writeSongProperty(file, "form", value);
	}

	/** Write or clear a form/audio property without duplicating file-format handling. */
	private async writeSongProperty(file: TFile, name: "form" | "audio", value: string | null): Promise<void> {
		const raw = await this.app.vault.read(file);
		const { body } = splitFrontmatter(raw);
		const lineRe = new RegExp(`^[ \\t]*\\{\\s*${name}\\s*:[^}]*\\}[ \\t]*$`, "im");
		const lineWithEolRe = new RegExp(`^[ \\t]*\\{\\s*${name}\\s*:[^}]*\\}[ \\t]*\\r?\\n?`, "im");
		const bodyHasDirective = lineRe.test(file.extension === "md" ? body : raw);

		if (bodyHasDirective) {
			await this.app.vault.process(file, (current) => value
				? current.replace(lineRe, `{${name}: ${value}}`)
				: current.replace(lineWithEolRe, ""));
			return;
		}

		if (file.extension === "md") {
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				if (value) fm[name] = value;
				else if (name === "form") fm[name] = "";
				else delete fm[name];
			});
			return;
		}

		if (!value) return;
		// .chordpro: insert after the leading header directives.
		await this.app.vault.process(file, (current) => {
			const lines = current.split("\n");
			let insertAt = 0;
			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();
				if (trimmed.length === 0) continue;
				if (/^\{[^}]*\}$/.test(trimmed) && !SECTION_DIRECTIVE_RE.test(trimmed)) {
					insertAt = i + 1;
					continue;
				}
				break;
			}
			lines.splice(insertAt, 0, `{${name}: ${value}}`);
			return lines.join("\n");
		});
	}

	// --- reference audio (roadmap 2026-07-14) -----------------------------------

	/** Toolbox entry point: prompt for the active song's reference audio. */
	runSetAudioLink(): void {
		const file = this.getActiveSongFile();
		if (!file) {
			new Notice("Open a song file first.");
			return;
		}
		void this.promptAudioLink(file);
	}

	/**
	 * The friendly path to an audio property: paste a streaming link or pick a
	 * recording already in the vault; no frontmatter editing needed.
	 */
	private async promptAudioLink(file: TFile): Promise<void> {
		const raw = await this.app.vault.cachedRead(file);
		const current = detectAudio(applyFrontmatter(raw));
		const audioFiles = this.app.vault
			.getFiles()
			.filter((f) => AUDIO_EXTENSIONS.has(f.extension.toLowerCase()))
			.sort((a, b) => a.basename.localeCompare(b.basename));
		new AudioLinkModal(this.app, current, audioFiles, (value) => {
			void this.writeAudio(file, value);
		}).open();
	}

	/**
	 * Write (or remove) a song's reference audio. Same placement rules as
	 * writeForm: .md songs keep it in frontmatter unless the body already
	 * declares {audio: ...}; .chordpro songs keep it with the header
	 * directives.
	 */
	async writeAudio(file: TFile, value: string | null): Promise<void> {
		return this.writeSongProperty(file, "audio", value);
	}

	// --- performance mode (v0.3.0) --------------------------------------------

	/**
	 * Enter performance mode from wherever the user is: the setlist view
	 * plays its set, a setlist note collects its links, a song plays alone.
	 * The ACTIVE view always wins; a setlist open in the background must not
	 * hijack a Perform click made on a chart of a different song.
	 */
	async enterPerformanceMode(): Promise<void> {
		const activeSetlist = this.app.workspace.getActiveViewOfType(SetlistView);
		if (activeSetlist?.getFile()) {
			await this.performance.open(
				activeSetlist.songs,
				activeSetlist.index,
				activeSetlist.getContinuous(),
				activeSetlist.getFile(),
				activeSetlist.songs[activeSetlist.index]?.line
			);
			return;
		}

		const chart = this.app.workspace.getActiveViewOfType(ChartView);
		if (chart?.getFile()) {
			await this.openPerformanceChart(chart);
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const file = this.getActivePerformableFile();
			if (!file) {
				new Notice("This file type is not enabled for performance.");
				return;
			}
			await this.openPerformanceFile(file);
			return;
		}

		const backgroundChart = this.chartView();
		if (backgroundChart?.getFile()) {
			await this.openPerformanceChart(backgroundChart);
			return;
		}

		const backgroundSetlist = this.setlistView();
		if (backgroundSetlist?.getFile()) {
			await this.performance.open(
				backgroundSetlist.songs,
				backgroundSetlist.index,
				backgroundSetlist.getContinuous(),
				backgroundSetlist.getFile(),
				backgroundSetlist.songs[backgroundSetlist.index]?.line
			);
			return;
		}

		const file = this.getActivePerformableFile();
		if (!file) {
			new Notice("Open a song or setlist first.");
			return;
		}
		await this.openPerformanceFile(file);
	}

	private async openPerformanceChart(chart: ChartView): Promise<void> {
		const file = chart.getFile();
		if (!file) return;
		const service = chart.getServiceFile();
		if (service) {
			const serviceSongs = await collectSetlistSongs(this.app, service, this.getStageFileTypes());
			if (serviceSongs.length > 0) {
				const at = serviceSongs.findIndex((entry) => entry.file.path === file.path);
				await this.performance.open(
					serviceSongs,
					at >= 0 ? at : 0,
					undefined,
					service,
					at >= 0 ? serviceSongs[at]?.line : undefined
				);
				return;
			}
		}
		await this.performance.open([{ file, key: null, label: null }]);
	}

	private async openPerformanceFile(file: TFile): Promise<void> {
		let songs: SetlistEntry[] = [];
		if (file.extension === "md") {
			songs = await collectSetlistSongs(this.app, file, this.getStageFileTypes());
		}
		const setlistsRoot = (this.settings.setlistsFolder || "Setlists").replace(/^\/+|\/+$/g, "");
		if (file.extension === "md" && (file.path === setlistsRoot || file.path.startsWith(setlistsRoot + "/"))) {
			await this.performance.open(songs, 0, undefined, file);
			return;
		}
		if (songs.length === 0) {
			await this.performance.open([{ file, key: null, label: null }]);
			return;
		}
		await this.performance.open(songs, 0, undefined, file);
	}

	// --- setlist print + team share (v0.4.0) -----------------------------------

	/**
	 * The setlist the print/share commands should work from: the active
	 * setlist view, the active markdown note, or a background setlist.
	 */
	private async setlistContext(): Promise<{ source: TFile; songs: SetlistEntry[] } | null> {
		const candidates: Array<TFile | null> = [
			this.app.workspace.getActiveViewOfType(SetlistView)?.getFile() ?? null,
			(() => {
				const f = this.app.workspace.getActiveFile();
				return f && f.extension === "md" ? f : null;
			})(),
			this.setlistView()?.getFile() ?? null
		];
		for (const source of candidates) {
			if (!source) continue;
			const songs = await collectSetlistSongs(this.app, source);
			if (songs.length > 0) return { source, songs };
		}
		return null;
	}

	/**
	 * Folder prefix ("path/" or "") plugin exports write into: the configured
	 * export folder (created on demand), or next to the source note (v0.6.0).
	 */
	private async exportFolderFor(file?: TFile): Promise<string> {
		const configured = (this.settings.exportFolder || "").trim().replace(/^\/+|\/+$/g, "");
		if (!configured) {
			return file?.parent && file.parent.path !== "/" ? file.parent.path + "/" : "";
		}
		if (!(this.app.vault.getAbstractFileByPath(configured) instanceof TFolder)) {
			await this.app.vault.createFolder(configured).catch(() => undefined);
		}
		return configured + "/";
	}

	/**
	 * Generate a print note next to the setlist: every song as a rendered
	 * ```chordpro block, form expanded and transposed into its performance
	 * key. File > Export to PDF on that note gives the band their paper set.
	 */
	private async createPrintNote(): Promise<void> {
		const ctx = await this.setlistContext();
		if (!ctx) {
			new Notice("Open a setlist note (or setlist view) with linked songs first.");
			return;
		}
		const { source } = ctx;
		// PDFs and images are stage assets; only songs go on paper.
		const songs = ctx.songs.filter((entry) => isSongFile(entry.file));

		const lines: string[] = [
			`# ${source.basename}`,
			"",
			`Generated from [[${source.basename}]] by Stage Binder. Rerun "Setlist: create print note" after changing the set, then use File > Export to PDF.`
		];
		for (const entry of songs) {
			try {
				const raw = await this.app.vault.read(entry.file);
				lines.push("", "---", "", "```chordpro", prepareSongText(raw, entry.key).trimEnd(), "```");
			} catch (err) {
				console.error("Stage Binder: print note failed for", entry.file.path, err);
				lines.push("", `> Could not read ${entry.file.basename}.`);
			}
		}

		const folder = await this.exportFolderFor(source);
		const path = `${folder}${source.basename} - Print.md`;
		const content = lines.join("\n") + "\n";
		const existing = this.app.vault.getAbstractFileByPath(path);
		const target = existing instanceof TFile ? existing : await this.app.vault.create(path, content);
		if (existing instanceof TFile) await this.app.vault.process(existing, () => content);
		await this.app.workspace.getLeaf(false).openFile(target);
		new Notice(`Print note ready: ${path}`);
	}

	/**
	 * Export the set as numbered .chordpro files in a share folder, each in
	 * its performance key with the form expanded: the hand-off for musicians
	 * who do not use Obsidian. A manifest (.chordpro-share.json) records what
	 * this command generated, so re-exporting a shortened set removes the old
	 * high-numbered files it left behind (a stale "06 ..." chart on stage is a
	 * real hazard). Only files WE recorded are ever removed; anything the user
	 * dropped in the folder is left untouched.
	 */
	private async exportShareFolder(): Promise<void> {
		const ctx = await this.setlistContext();
		if (!ctx) {
			new Notice("Open a setlist note (or setlist view) with linked songs first.");
			return;
		}
		const { source } = ctx;
		// Share folders are .chordpro hand-offs; skip PDFs and images.
		const songs = ctx.songs.filter((entry) => isSongFile(entry.file));

		const parent = await this.exportFolderFor(source);
		const folder = `${parent}${source.basename} - Share`;
		if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
			await this.app.vault.createFolder(folder).catch(() => undefined);
		}

		const manifestPath = `${folder}/.chordpro-share.json`;
		const previous = await this.readShareManifest(manifestPath);
		const generated: string[] = [];

		const order: string[] = [`# ${source.basename}`, ""];
		let written = 0;
		for (let i = 0; i < songs.length; i++) {
			const entry = songs[i];
			const name = shareFileName(i, entry.file.basename, entry.label);
			try {
				const raw = await this.app.vault.read(entry.file);
				const text = prepareSongText(raw, entry.key);
				const path = `${folder}/${name}`;
				const existing = this.app.vault.getAbstractFileByPath(path);
				if (existing instanceof TFile) await this.app.vault.process(existing, () => text);
				else await this.app.vault.create(path, text);
				generated.push(name);
				written++;
				order.push(`${i + 1}. ${entry.file.basename}${entry.label ? ` in ${entry.label}` : ""}`);
			} catch (err) {
				console.error("Stage Binder: share export failed for", entry.file.path, err);
				order.push(`${i + 1}. ${entry.file.basename} (export failed)`);
			}
		}

		const orderName = "00 Set order.md";
		const orderContent = order.join("\n") + "\n";
		const existingOrder = this.app.vault.getAbstractFileByPath(`${folder}/${orderName}`);
		if (existingOrder instanceof TFile) await this.app.vault.process(existingOrder, () => orderContent);
		else await this.app.vault.create(`${folder}/${orderName}`, orderContent);
		generated.push(orderName);

		// Trash files this exporter wrote on a previous, longer run but did not
		// regenerate now. Trash (not delete) keeps them recoverable.
		const keep = new Set(generated);
		let removed = 0;
		for (const name of previous) {
			if (keep.has(name)) continue;
			const stale = this.app.vault.getAbstractFileByPath(`${folder}/${name}`);
			if (stale instanceof TFile) {
				await this.app.fileManager.trashFile(stale).catch(() => undefined);
				removed++;
			}
		}

		await this.writeShareManifest(manifestPath, generated);

		const summary =
			`Exported ${written} of ${songs.length} songs to ${folder}.` +
			(removed > 0 ? ` Removed ${removed} obsolete file(s) from a previous export.` : " Share that folder with the team.");
		new Notice(summary);
	}

	runExportShareFolder(): void {
		void this.exportShareFolder();
	}

	/** Filenames the share exporter recorded generating last time, or []. */
	private async readShareManifest(path: string): Promise<string[]> {
		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return [];
			const parsed = JSON.parse(await this.app.vault.cachedRead(file)) as { files?: unknown };
			return Array.isArray(parsed.files) ? parsed.files.filter((f): f is string => typeof f === "string") : [];
		} catch (err) {
			// A corrupt or unreadable manifest just means no cleanup this run.
			console.error("Stage Binder: could not read share manifest", err);
			return [];
		}
	}

	private async writeShareManifest(path: string, files: string[]): Promise<void> {
		try {
			const content = JSON.stringify({ generator: this.manifest.id, files }, null, 2);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await this.app.vault.process(existing, () => content);
			else await this.app.vault.create(path, content);
		} catch (err) {
			console.error("Stage Binder: could not write share manifest", err);
		}
	}

	// --- CCLI usage report (v0.7.1) --------------------------------------------

	/** Prompt for the reporting period, defaulting to the current calendar year. */
	private promptCcliReport(): void {
		const now = new Date();
		const from = `${now.getFullYear()}-01-01`;
		const to = now.toISOString().slice(0, 10);
		new CcliReportModal(this.app, from, to, (range) => {
			void this.generateCcliReport(range.from, range.to);
		}).open();
	}

	/**
	 * Scan the vault (or the configured service folder) for dated notes that
	 * link songs, and write a CCLI usage report note: how many times each song
	 * was used in the period, with its CCLI number and author, plus a list of
	 * used songs still missing a CCLI number.
	 */
	private async generateCcliReport(from: string, to: string): Promise<void> {
		const notice = new Notice("Building CCLI report...", 0);
		try {
			const folder = (this.settings.serviceFolder || "").trim().replace(/^\/+|\/+$/g, "");
			const prefix = folder ? folder + "/" : "";
			// null memoizes "linked, but not actually a song" so a setlist,
			// contact, or generated print note is classified once, not re-read.
			const songMeta = new Map<string, SongUsage | null>();
			const services: ServiceUsage[] = [];

			for (const file of this.app.vault.getMarkdownFiles()) {
				if (prefix && !file.path.startsWith(prefix)) continue;
				const cache = this.app.metadataCache.getFileCache(file);
				// A service note links at least one song. Cheap pre-filter on the
				// cache before any file read; skip our own generated report notes.
				if (!cache?.links && !cache?.embeds) continue;
				if (typeof cache?.frontmatter?.generated === "string") continue;
				const fmDate: unknown = cache?.frontmatter?.date;
				const date = parseServiceDate(typeof fmDate === "string" ? fmDate : undefined, file.basename);
				if (!date || date < from || date > to) continue;

				const linked = (await collectSetlistSongs(this.app, file)).filter((e) => isSongFile(e.file));
				if (linked.length === 0) continue;

				const songs: SongUsage[] = [];
				for (const entry of linked) {
					let meta = songMeta.get(entry.file.path);
					if (meta === undefined) {
						const resolved = applyFrontmatter(await this.app.vault.cachedRead(entry.file));
						meta = isLikelySong(resolved, entry.file.extension)
							? songMetaFromText(resolved, entry.file.basename)
							: null;
						songMeta.set(entry.file.path, meta);
					}
					if (meta) songs.push(meta);
				}
				// A dated note that only links other non-songs (e.g. a print note
				// linking its setlist) is not a service.
				if (songs.length === 0) continue;
				services.push({ date, label: file.basename, songs });
			}

			const report = buildCcliReport(services, from, to);
			const path = await this.writeCcliReport(report);
			notice.hide();
			if (report.serviceCount === 0) {
				new Notice("No dated service notes found in that period. Add a date to your setlist notes (a date property or a date in the file name).");
				return;
			}
			const target = this.app.vault.getAbstractFileByPath(path);
			if (target instanceof TFile) await this.app.workspace.getLeaf(false).openFile(target);
			new Notice(`CCLI report: ${report.rows.length} songs across ${report.serviceCount} services.`);
		} catch (err) {
			notice.hide();
			console.error("Stage Binder: CCLI report failed", err);
			new Notice("CCLI report failed; see the console for details.");
		}
	}

	private async writeCcliReport(report: CcliReport): Promise<string> {
		const lines: string[] = [
			"---",
			"generated: stage-binder-ccli-report",
			`period: ${report.from} to ${report.to}`,
			"---",
			"",
			"# CCLI Usage Report",
			"",
			`**Period:** ${report.from} to ${report.to}`,
			`**Services counted:** ${report.serviceCount}`,
			`**Distinct songs:** ${report.rows.length}`,
			""
		];

		if (report.rows.length > 0) {
			lines.push("| Title | CCLI # | Author | Times used | Dates |", "|---|---|---|---:|---|");
			for (const row of report.rows) {
				const cells = [
					escapeCell(row.title),
					row.ccli ?? "—",
					row.artist ? escapeCell(row.artist) : "—",
					String(row.count),
					row.dates.join(", ")
				];
				lines.push(`| ${cells.join(" | ")} |`);
			}
			lines.push("");
		}

		if (report.missing.length > 0) {
			lines.push(
				"## Missing CCLI numbers",
				"",
				"These songs were used but have no `ccli` property. Add it to each so they appear with a number next time:",
				""
			);
			for (const row of report.missing) {
				lines.push(`- ${escapeCell(row.title)} (used ${row.count}x)`);
			}
			lines.push("");
		}

		lines.push("_Verify song numbers and authors against CCLI SongSelect before submitting your report._", "");

		const folder = await this.exportFolderFor();
		const path = `${folder}CCLI Report ${report.from} to ${report.to}.md`;
		const content = lines.join("\n");
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.process(existing, () => content);
		else await this.app.vault.create(path, content);
		return path;
	}

	// --- roadmap commands ----------------------------------------------------

	runExportChordpro(): void {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a Markdown song note first.");
			return;
		}
		void this.exportChordpro(file);
	}

	/**
	 * Write the song as a clean .chordpro file next to the note: frontmatter
	 * properties become directives, and when the note keeps its song in a
	 * ```chordpro block only the block content is exported.
	 */
	private async exportChordpro(file: TFile): Promise<void> {
		const raw = await this.app.vault.read(file);
		const { meta, body } = splitFrontmatter(raw);
		const song = (extractChordproBlocks(body) ?? body).replace(/^\s*\n/, "").replace(/\s+$/, "");
		const directives = metaToDirectives(meta, song);
		const content = (directives.length > 0 ? directives.join("\n") + "\n\n" : "") + song + "\n";

		const folder = await this.exportFolderFor(file);
		const target = `${folder}${file.basename}.chordpro`;
		const existing = this.app.vault.getAbstractFileByPath(target);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, () => content);
		} else {
			await this.app.vault.create(target, content);
		}
		new Notice(`Exported ${target}`);
	}

	/** Rewrite the file's chords into a chosen key (roadmap: transpose-in-place). */
	private async transposeInPlace(file: TFile): Promise<void> {
		const raw = await this.app.vault.read(file);
		const key = detectKey(applyFrontmatter(raw));
		if (!key) {
			new Notice("Add a {key: X} directive or a key property first.");
			return;
		}
		new TransposeKeyModal(this.app, key, (semitones) => {
			void (async () => {
				await this.app.vault.process(file, (current) =>
					transposeSource(current, semitones, detectKey(applyFrontmatter(current)) ?? key));
				if (file.extension === "md") {
					// The canonical key for .md songs may live in frontmatter.
					await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
						if (typeof fm.key === "string") {
							const m = fm.key.trim().match(/^([A-G][#b]?)(m?)$/);
							if (m) fm.key = transposeKeyName(m[1], m[2] === "m", semitones);
						}
					});
				}
				const label = transposeKeyName(key.tonic, key.minor, semitones);
				new Notice(`Transposed to ${label}.`);
			})();
		}).open();
	}

	/** Create a pre-scaffolded song note and open it (roadmap: "New song"). */
	runNewSong(): void {
		new NewSongModal(this.app, this.settings.lastKeyId, (result) => {
			void this.createSong(result.title, result.keyId);
		}).open();
	}

	runSmartPaste(): void {
		new SmartPasteModal(this).open();
	}

	private async createSong(title: string, keyId: string): Promise<void> {
		const option = KEY_OPTIONS.find((k) => k.id === keyId) ?? KEY_OPTIONS[0];
		const keyName = option.mode === "minor" ? `${option.tonic}m` : option.tonic;

		// New songs are Markdown, so they always land in the Text branch of
		// the configured library root instead of whichever chart is active.
		const folder = songLibraryFolderForExtension(this.settings.songsFolder, "md");
		let currentFolder = "";
		for (const segment of folder.split("/")) {
			currentFolder = currentFolder ? `${currentFolder}/${segment}` : segment;
			const existingFolder = this.app.vault.getAbstractFileByPath(currentFolder);
			if (existingFolder instanceof TFile) throw new Error(`Song folder path is a file: ${currentFolder}`);
			if (!(existingFolder instanceof TFolder)) await this.app.vault.createFolder(currentFolder);
		}

		const safeTitle = title.replace(/[\\/:#^[\]|?*]/g, "").trim() || "Untitled song";
		let path = `${folder ? folder + "/" : ""}${safeTitle}.md`;
		let n = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			n++;
			path = `${folder ? folder + "/" : ""}${safeTitle} ${n}.md`;
		}

		const content = [
			"---",
			`title: ${yamlValue(title)}`,
			"artist: ",
			`key: ${keyName}`,
			"tempo: ",
			"time: 4/4",
			"form: ",
			"---",
			"",
			"{comment: Intro}",
			"",
			"{comment: Verse 1}",
			"",
			"{comment: Chorus}",
			"",
			"{comment: Verse 2}",
			"",
			"{comment: Bridge}",
			""
		].join("\n");

		const created = await this.app.vault.create(path, content);
		await this.app.workspace.getLeaf(false).openFile(created);
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		// v0.5.0: the showDiagramStrip boolean became the diagramPlacement enum.
		if (data.diagramPlacement === undefined && typeof data.showDiagramStrip === "boolean") {
			data.diagramPlacement = data.showDiagramStrip ? "chart-top" : "off";
		}
		delete data.showDiagramStrip;
		delete data.viewStyles;
		delete data.sections;
		delete data.stylePresets;
		for (const key of [
			"includeChordProInStage",
			"includeMarkdownInStage",
			"includePdfInStage",
			"includeImagesInStage"
		]) {
			if (typeof data[key] !== "boolean") delete data[key];
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	getStageFileTypes(): StageFileTypes {
		return {
			chordpro: this.settings.includeChordProInStage,
			markdown: this.settings.includeMarkdownInStage,
			pdf: this.settings.includePdfInStage,
			images: this.settings.includeImagesInStage
		};
	}

	// --- editor targeting -----------------------------------------------

	/**
	 * The editor Toolbox actions should type into: the active markdown view,
	 * or the most recently active one when focus sits in the sidebar.
	 */
	private getTargetEditor(): Editor | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active.editor;

		if (this.lastMarkdownLeaf) {
			const stillOpen = this.app.workspace
				.getLeavesOfType("markdown")
				.some((leaf) => leaf === this.lastMarkdownLeaf);
			if (stillOpen && this.lastMarkdownLeaf.view instanceof MarkdownView) {
				return this.lastMarkdownLeaf.view.editor;
			}
		}

		const leaves = this.app.workspace.getLeavesOfType("markdown");
		if (leaves.length > 0 && leaves[0].view instanceof MarkdownView) {
			return leaves[0].view.editor;
		}
		return null;
	}

	/**
	 * Insert text at the cursor of the target editor.
	 * cursorBack moves the cursor left afterwards (used by header snippets to
	 * land between ": " and "}").
	 */
	insertText(text: string, cursorBack = 0): void {
		const editor = this.getTargetEditor();
		if (!editor) {
			new Notice("Open a song file first.");
			return;
		}
		editor.focus();
		editor.replaceSelection(text);
		if (cursorBack > 0) {
			const cursor = editor.getCursor();
			editor.setCursor({ line: cursor.line, ch: Math.max(0, cursor.ch - cursorBack) });
		}
	}

	/**
	 * Insert a section directive on its own line, with a blank line before it
	 * when the previous line has content (matches the BRIEF.md 8 file style).
	 * The cursor ends up on a fresh line below the directive.
	 */
	insertSection(directive: string): void {
		const editor = this.getTargetEditor();
		if (!editor) {
			new Notice("Open a song file first.");
			return;
		}
		editor.focus();

		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		let text: string;

		if (currentLine.trim().length > 0) {
			// Cursor sits on a content line: drop below it, blank line between.
			editor.setCursor({ line: cursor.line, ch: currentLine.length });
			text = `\n\n${directive}\n`;
		} else {
			const prevLine = cursor.line > 0 ? editor.getLine(cursor.line - 1) : "";
			text = prevLine.trim().length > 0 ? `\n${directive}\n` : `${directive}\n`;
		}
		editor.replaceSelection(text);
	}

	// --- lyrics formatter --------------------------------------------------

	runFormatLyrics(): void {
		const editor = this.getTargetEditor();
		if (!editor) {
			new Notice("Open a song file first.");
			return;
		}
		this.formatLyricsInEditor(editor);
	}

	private formatLyricsInEditor(editor: Editor): void {
		const selection = editor.getSelection();
		if (selection.length > 0) {
			editor.replaceSelection(formatLyrics(selection));
		} else {
			const formatted = formatLyrics(editor.getValue());
			editor.setValue(formatted);
		}
		new Notice("Lyrics formatted to ChordPro.");
	}

	// --- views -------------------------------------------------------------

	async activateToolbox(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TOOLBOX_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: TOOLBOX_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Open the toolbox's fingering dock on a chord (chart chords are tappable). */
	async openChordDock(symbol: string): Promise<void> {
		await this.activateToolbox();
		for (const toolbox of this.toolboxViews()) {
			toolbox.showChordDock(symbol);
		}
	}

	async openChartPreview(fileArg?: TFile, service: TFile | null = null): Promise<void> {
		const file = fileArg ?? this.getActiveSongFile();
		if (!file) {
			new Notice("Open a song file first.");
			return;
		}

		const existing = this.app.workspace.getLeavesOfType(CHART_VIEW_TYPE);
		const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("split", "vertical");
		await leaf.setViewState({ type: CHART_VIEW_TYPE, active: true });
		if (leaf.view instanceof ChartView) {
			await leaf.view.setFile(file, service);
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	async openSetlist(file: TFile): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(SETLIST_VIEW_TYPE);
		const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("split", "vertical");
		await leaf.setViewState({ type: SETLIST_VIEW_TYPE, active: true });
		if (leaf.view instanceof SetlistView) {
			await leaf.view.setFile(file);
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	async openRunsheet(file: TFile): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(RUNSHEET_VIEW_TYPE);
		const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("split", "vertical");
		await leaf.setViewState({ type: RUNSHEET_VIEW_TYPE, active: true });
		if (leaf.view instanceof RunsheetView) {
			await leaf.view.setFile(file);
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Speed-nudge routing shared by "Autoscroll faster/slower". Performance
	 * mode wins when it is open, so a pedal bound to these reaches the stage
	 * (its nudge method used to be private, stranding the commands on stage).
	 */
	private nudgeAutoscrollCommand(checking: boolean, delta: number): boolean {
		if (this.performance.isOpen()) {
			if (!checking) this.performance.nudgeAutoscroll(delta);
			return true;
		}
		const view = this.scrollableView();
		if (!checking && view) view.nudgeAutoscroll(delta);
		return !!view;
	}

	/** The chart or setlist view autoscroll commands should target. */
	private scrollableView(): ChartView | SetlistView | null {
		const chart = this.app.workspace.getActiveViewOfType(ChartView);
		if (chart) return chart;
		const setlist = this.app.workspace.getActiveViewOfType(SetlistView);
		if (setlist) return setlist;
		for (const leaf of this.app.workspace.getLeavesOfType(CHART_VIEW_TYPE)) {
			if (leaf.view instanceof ChartView) return leaf.view;
		}
		for (const leaf of this.app.workspace.getLeavesOfType(SETLIST_VIEW_TYPE)) {
			if (leaf.view instanceof SetlistView) return leaf.view;
		}
		return null;
	}

	private setlistView(): SetlistView | null {
		const active = this.app.workspace.getActiveViewOfType(SetlistView);
		if (active) return active;
		for (const leaf of this.app.workspace.getLeavesOfType(SETLIST_VIEW_TYPE)) {
			if (leaf.view instanceof SetlistView) return leaf.view;
		}
		return null;
	}

	private chartView(): ChartView | null {
		const active = this.app.workspace.getActiveViewOfType(ChartView);
		if (active) return active;
		for (const leaf of this.app.workspace.getLeavesOfType(CHART_VIEW_TYPE)) {
			if (leaf.view instanceof ChartView) return leaf.view;
		}
		return null;
	}

	private fileFromLastLeaf(): TFile | null {
		if (this.lastMarkdownLeaf && this.lastMarkdownLeaf.view instanceof MarkdownView) {
			return this.lastMarkdownLeaf.view.file;
		}
		return null;
	}
}
