// Setlist view (v0.2.0): play the songs a note links to, in order, each in
// its performance key ("in G" / "(G)" after the wikilink). v0.3.0 adds the
// continuous mode: the whole set stacked in one scrolling pane so a Bluetooth
// pedal can scroll straight through, plus form/roadmap expansion and the
// performance mode entry.
import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type StageBinderPlugin from "../main";
import { detectKey } from "../core/chordpro";
import { applyFrontmatter } from "../core/frontmatter";
import {
	Autoscroller,
	blockIndexAtTop,
	collectSetlistSongs,
	formHighlighter,
	KEY_OVERRIDE_RE,
	renderSongInto,
	scrollToBlock,
	SetlistEntry
} from "./render-song";

/** Picker tonics, conventional spellings. Odd spellings join on the fly. */
const KEY_PICKER_TONICS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export const SETLIST_VIEW_TYPE = "stage-binder-setlist";

export class SetlistView extends ItemView {
	private plugin: StageBinderPlugin;
	private file: TFile | null = null;
	songs: SetlistEntry[] = [];
	index = 0;
	private zoom = 100;
	private continuous: boolean;
	private scroller: Autoscroller;
	private scrollBound = false;
	private scrollBtnEl: HTMLElement | null = null;
	private speedEl: HTMLElement | null = null;
	private posEl: HTMLElement | null = null;
	private keySelectEl: HTMLSelectElement | null = null;
	/** Per-song {autoscroll: N} speeds and the live +/- adjustment on top. */
	private songSpeeds: Array<number | null> = [];
	private speedOverride: number | null = null;
	private formUpdaters: Array<() => void> = [];
	/** Keep slower vault reads from overwriting a newer setlist or render. */
	private reloadGeneration = 0;
	private renderGeneration = 0;

	constructor(leaf: WorkspaceLeaf, plugin: StageBinderPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.continuous = plugin.settings.setlistContinuous;
		this.scroller = new Autoscroller(
			() => this.contentEl,
			() => this.effectiveSpeed() * (this.zoom / 100),
			() => this.syncScrollUi()
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!this.file) return;
				if (file.path === this.file.path) void this.reload();
				else if (this.songs.some((s) => s.file.path === file.path)) void this.render();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.file && file.path === this.file.path) {
					this.file = null;
					this.songs = [];
					void this.render();
				}
			})
		);
	}

	getViewType(): string {
		return SETLIST_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file ? `Setlist: ${this.file.basename}` : "Setlist";
	}

	getIcon(): string {
		return "list-music";
	}

	getFile(): TFile | null {
		return this.file;
	}

	getContinuous(): boolean {
		return this.continuous;
	}

	getState(): Record<string, unknown> {
		return { file: this.file?.path ?? null, index: this.index, zoom: this.zoom, continuous: this.continuous };
	}

	async setState(
		state: { file?: string; index?: number; zoom?: number; continuous?: boolean },
		result: never
	): Promise<void> {
		if (state?.file) {
			const file = this.app.vault.getAbstractFileByPath(state.file);
			if (file instanceof TFile) {
				this.file = file;
				this.index = state.index ?? 0;
				this.zoom = state.zoom ?? 100;
				this.continuous = state.continuous ?? this.plugin.settings.setlistContinuous;
				await this.reload();
			}
		}
	}

	async onClose(): Promise<void> {
		this.reloadGeneration++;
		this.renderGeneration++;
		this.scroller.stop();
	}

	async setFile(file: TFile): Promise<void> {
		this.file = file;
		this.index = 0;
		this.scroller.stop();
		this.speedOverride = null;
		await this.reload();
	}

	async reload(): Promise<void> {
		const generation = ++this.reloadGeneration;
		// Stop an in-flight render from appending while this reload waits.
		this.renderGeneration++;
		const file = this.file;
		const songs = file ? await collectSetlistSongs(this.app, file, this.plugin.getStageFileTypes()) : [];
		if (generation !== this.reloadGeneration || this.file !== file) return;
		this.songs = songs;
		this.songSpeeds = [];
		this.index = Math.max(0, Math.min(this.index, Math.max(0, this.songs.length - 1)));
		await this.render();
	}

	toggleAutoscroll(): void {
		this.scroller.toggle();
	}

	/** Current song's {autoscroll: N} beats the setting; live +/- beats both. */
	private effectiveSpeed(): number {
		return this.speedOverride ?? this.songSpeeds[this.index] ?? this.plugin.settings.autoscrollSpeed;
	}

	nudgeAutoscroll(delta: number): void {
		const next = Math.max(5, Math.min(300, this.effectiveSpeed() + delta));
		if (this.songSpeeds[this.index] != null) {
			this.speedOverride = next;
		} else {
			this.plugin.settings.autoscrollSpeed = next;
			void this.plugin.saveSettings();
		}
		this.syncScrollUi();
	}

	private syncScrollUi(): void {
		if (this.scrollBtnEl) {
			this.scrollBtnEl.toggleClass("is-active", this.scroller.active);
			setIcon(this.scrollBtnEl, this.scroller.active ? "pause" : "play");
		}
		this.speedEl?.setText(String(this.effectiveSpeed()));
	}

	private syncPos(): void {
		this.posEl?.setText(this.songs.length > 0 ? `${this.index + 1} / ${this.songs.length}` : "0 / 0");
		this.syncKeyPicker();
	}

	/** Point the key picker at the current song's override (or its own key). */
	private syncKeyPicker(): void {
		const select = this.keySelectEl;
		const entry = this.songs[this.index];
		if (!select || !entry) return;
		const value = entry.key ?? "";
		if (value && !Array.from(select.options).some((o) => o.value === value)) {
			select.createEl("option", { text: "in " + (entry.label ?? value), value });
		}
		select.value = value;
	}

	/**
	 * Rewrite the current song's "in G" override on its setlist line. The
	 * vault modify event then reloads the view, so the chart re-transposes
	 * without any manual refresh.
	 */
	private async setKeyOverride(index: number, tonic: string | null): Promise<void> {
		const entry = this.songs[index];
		if (!entry || !this.file || entry.line === undefined || entry.endCol === undefined) return;
		const lineNo = entry.line;
		const endCol = entry.endCol;
		// Minor songs get a minor label ("in Em"); transposition follows the
		// tonic either way.
		let minor = false;
		try {
			const raw = await this.app.vault.cachedRead(entry.file);
			minor = detectKey(applyFrontmatter(raw))?.minor ?? false;
		} catch {
			// Unreadable song: keep the major label.
		}
		await this.app.vault.process(this.file, (content) => {
			const lines = content.split("\n");
			const line = lines[lineNo];
			if (line === undefined) return content;
			const before = line.slice(0, endCol);
			// Stale positions (the note changed since the last reload) must
			// not corrupt the line; the link must end exactly at endCol.
			if (!/(?:\]\]|\))$/.test(before)) return content;
			let after = line.slice(endCol);
			const m = after.match(KEY_OVERRIDE_RE);
			if (m) after = after.slice(m[0].length);
			lines[lineNo] = before + (tonic ? ` in ${tonic}${minor ? "m" : ""}` : "") + after;
			return lines.join("\n");
		});
	}

	async toggleContinuous(): Promise<void> {
		this.continuous = !this.continuous;
		this.scroller.stop();
		await this.render();
	}

	/** Next/previous song. Continuous mode scrolls; paged mode re-renders. */
	async go(delta: number): Promise<void> {
		const next = this.index + delta;
		if (next < 0 || next >= this.songs.length) return;
		this.index = next;
		this.speedOverride = null;
		if (this.continuous) {
			const block = this.contentEl.querySelector(`[data-sb-song="${next}"]`);
			if (block instanceof HTMLElement) scrollToBlock(this.contentEl, block);
			this.syncPos();
			return;
		}
		this.scroller.stop();
		await this.render();
	}

	async render(): Promise<void> {
		const generation = ++this.renderGeneration;
		const isCurrent = () => generation === this.renderGeneration;
		const root = this.contentEl;
		root.empty();
		root.addClass("sb-chart-view");
		root.addClass("sb-setlist-view");

		if (!this.file) {
			root.createDiv({
				cls: "sb-setlist-empty",
				text: "No setlist note selected. Open a note that links to songs and run “Open setlist”."
			});
			return;
		}

		const bar = root.createDiv({ cls: "sb-chart-controls sb-setlist-bar" });

		const prev = bar.createEl("button", { cls: "sb-chart-btn" });
		setIcon(prev, "chevron-left");
		prev.setAttribute("aria-label", "Previous song");
		prev.addEventListener("click", () => void this.go(-1));

		const select = bar.createEl("select", { cls: "dropdown sb-setlist-select" });
		this.songs.forEach((song, idx) => {
			select.createEl("option", {
				text: `${idx + 1}. ${song.file.basename}${song.label ? " (" + song.label + ")" : ""}`,
				value: String(idx)
			});
		});
		select.value = String(this.index);
		select.addEventListener("change", () => {
			const idx = parseInt(select.value, 10) || 0;
			if (this.continuous) {
				void this.go(idx - this.index);
			} else {
				this.index = idx;
				this.scroller.stop();
				void this.render();
			}
		});

		const next = bar.createEl("button", { cls: "sb-chart-btn" });
		setIcon(next, "chevron-right");
		next.setAttribute("aria-label", "Next song");
		next.addEventListener("click", () => void this.go(1));

		// Performance key picker for the current song: writes the "in G"
		// override on the setlist line instead of making you edit text.
		this.keySelectEl = bar.createEl("select", { cls: "dropdown sb-setlist-key" });
		this.keySelectEl.setAttribute("aria-label", "Performance key for the current song");
		this.keySelectEl.createEl("option", { text: "Song key", value: "" });
		for (const tonic of KEY_PICKER_TONICS) {
			this.keySelectEl.createEl("option", { text: "in " + tonic, value: tonic });
		}
		this.keySelectEl.addEventListener("change", () => {
			void this.setKeyOverride(this.index, this.keySelectEl?.value || null);
		});

		this.posEl = bar.createSpan({ cls: "sb-setlist-pos" });
		this.syncPos();

		const contBtn = bar.createEl("button", {
			cls: "sb-chart-btn sb-toggle-btn" + (this.continuous ? " is-active" : ""),
			text: "All songs"
		});
		contBtn.setAttribute("aria-label", "Toggle continuous scroll (all songs in one pane)");
		contBtn.addEventListener("click", () => void this.toggleContinuous());

		const zoomGroup = bar.createDiv({ cls: "sb-ctrl-group" });
		const zoomOut = zoomGroup.createEl("button", { cls: "sb-chart-btn", text: "A−" });
		zoomOut.setAttribute("aria-label", "Smaller text");
		zoomGroup.createSpan({ cls: "sb-zoom-label", text: this.zoom + "%" });
		const zoomIn = zoomGroup.createEl("button", { cls: "sb-chart-btn", text: "A+" });
		zoomIn.setAttribute("aria-label", "Larger text");
		zoomOut.addEventListener("click", () => {
			this.zoom = Math.max(50, this.zoom - 10);
			void this.render();
		});
		zoomIn.addEventListener("click", () => {
			this.zoom = Math.min(250, this.zoom + 10);
			void this.render();
		});

		const scrollGroup = bar.createDiv({ cls: "sb-ctrl-group" });
		this.scrollBtnEl = scrollGroup.createEl("button", { cls: "sb-chart-btn sb-scroll-btn" });
		this.scrollBtnEl.setAttribute("aria-label", "Toggle autoscroll");
		this.scrollBtnEl.addEventListener("click", () => this.toggleAutoscroll());
		const slower = scrollGroup.createEl("button", { cls: "sb-chart-btn", text: "−" });
		slower.setAttribute("aria-label", "Autoscroll slower");
		slower.addEventListener("click", () => this.nudgeAutoscroll(-5));
		this.speedEl = scrollGroup.createSpan({ cls: "sb-zoom-label" });
		const faster = scrollGroup.createEl("button", { cls: "sb-chart-btn", text: "+" });
		faster.setAttribute("aria-label", "Autoscroll faster");
		faster.addEventListener("click", () => this.nudgeAutoscroll(5));
		this.syncScrollUi();

		const perfBtn = bar.createEl("button", { cls: "sb-chart-btn sb-perform-btn", text: "Perform" });
		perfBtn.setAttribute("aria-label", "Enter performance mode");
		perfBtn.addEventListener("click", () => void this.plugin.enterPerformanceMode());

		if (this.songs.length === 0) {
			root.createDiv({
				cls: "sb-setlist-empty",
				text: "No songs found. Link songs with [[wikilinks]]. Add “in G” or “(G)” after a link to set a performance key."
			});
			return;
		}

		const opts = {
			zoom: this.zoom,
			showDiagrams: this.plugin.settings.diagramPlacement === "chart-top",
			useForm: this.plugin.settings.formDefaultOn,
			showFormStrip: this.plugin.settings.formStripPreview,
			onChordClick: this.plugin.settings.chordTapDock
				? (symbol: string) => void this.plugin.openChordDock(symbol)
				: undefined
		};

		this.formUpdaters = [];
		if (!this.scrollBound) {
			this.scrollBound = true;
			this.registerDomEvent(this.contentEl, "wheel", () => this.scroller.stop());
			this.registerDomEvent(this.contentEl, "touchmove", () => this.scroller.stop());
			this.registerDomEvent(this.contentEl, "scroll", () => {
				this.trackVisibleSong();
				for (const update of this.formUpdaters) update();
			});
		}

		if (this.continuous) {
			for (let i = 0; i < this.songs.length; i++) {
				const entry = this.songs[i];
				const block = root.createDiv({ cls: "sb-setlist-song" });
				block.setAttribute("data-sb-song", String(i));
				const rendered = await renderSongInto(block, this.app, this, entry.file, {
					...opts,
					targetKey: entry.key,
					isCurrent
				});
				if (!rendered || !isCurrent()) return;
				this.songSpeeds[i] = rendered.autoscroll;
				const updater = this.plugin.settings.formHighlight ? formHighlighter(this.contentEl, rendered) : null;
				if (updater) this.formUpdaters.push(updater);
			}
			this.syncScrollUi();
			const target = this.contentEl.querySelector(`[data-sb-song="${this.index}"]`);
			if (target instanceof HTMLElement && this.index > 0) scrollToBlock(this.contentEl, target);
			return;
		}

		const entry = this.songs[this.index];
		const rendered = await renderSongInto(root, this.app, this, entry.file, {
			...opts,
			targetKey: entry.key,
			isCurrent
		});
		if (!rendered || !isCurrent()) return;
		this.songSpeeds[this.index] = rendered.autoscroll;
		const updater = this.plugin.settings.formHighlight ? formHighlighter(this.contentEl, rendered) : null;
		if (updater) this.formUpdaters.push(updater);
		this.syncScrollUi();
		this.contentEl.scrollTop = 0;
	}

	/** In continuous mode: which song block currently tops the viewport. */
	private trackVisibleSong(): void {
		if (!this.continuous) return;
		const current = blockIndexAtTop(this.contentEl, "[data-sb-song]");
		if (current !== this.index) {
			this.index = current;
			// Speed follows the song under the needle; a live +/- adjustment
			// was for the previous song.
			this.speedOverride = null;
			this.syncPos();
			this.syncScrollUi();
		}
	}
}
