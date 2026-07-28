// Reading view (BRIEF.md section 6b): a rendered chords-over-lyrics chart of a
// .chordpro (or .md) file with transpose controls, Nashville toggle, capo
// shapes, diagram strip (v0.1), zoom, two columns, autoscroll (v0.2), and the
// form/roadmap toggle plus performance mode entry (v0.3).
import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type StageBinderPlugin from "../main";
import {
	detectAudio,
	detectAutoscroll,
	detectCapo,
	detectKey,
	renderChart,
	transposeKeyName,
	transposeSource
} from "../core/chordpro";
import { applyFrontmatter } from "../core/frontmatter";
import { detectForm, expandForm } from "../core/form";
import { toNashvilleSource } from "../core/nashville";
import {
	appendAudioLine,
	appendDiagramStrip,
	appendFormStrip,
	appendMetaLine,
	attachChordClicks,
	Autoscroller,
	formHighlighter,
	setChartHtml
} from "./render-song";
import { buildServiceContext, listSetlistFiles, ServiceContext, ServiceEntry } from "./service-context";
import { StageChrome } from "./stage-chrome";

export const CHART_VIEW_TYPE = "stage-binder-chart";

export class ChartView extends ItemView {
	private plugin: StageBinderPlugin;
	private file: TFile | null = null;
	private offset = 0;
	private nashville = false;
	private lyricsOnly = false;
	/** With a capo set: show the shapes you finger instead of sounding chords. */
	private shapes = false;
	private zoom = 100;
	/** 0 = follow the default-layout setting on next render. */
	private cols = 0;
	/** Render the declared form/roadmap order instead of the file order. */
	private formOn = true;
	private scroller: Autoscroller;
	private chartScrollEl: HTMLElement | null = null;
	private scrollBtnEl: HTMLElement | null = null;
	private speedEl: HTMLElement | null = null;
	/** The song's {autoscroll: N} speed, and any live +/- adjustment on top. */
	private songSpeed: number | null = null;
	private speedOverride: number | null = null;
	private formUpdater: (() => void) | null = null;
	private serviceFile: TFile | null = null;
	private serviceContext: ServiceContext | null = null;
	private chrome: StageChrome | null = null;
	/** Invalidates a cachedRead when a newer render starts. */
	private renderGeneration = 0;

	constructor(leaf: WorkspaceLeaf, plugin: StageBinderPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.scroller = new Autoscroller(
			() => this.chartScrollEl ?? this.contentEl,
			() => this.effectiveSpeed() * (this.zoom / 100),
			() => this.syncScrollUi()
		);
		// Re-render when the source file changes on disk (live editing).
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.file && file.path === this.file.path) void this.render();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.file && file.path === this.file.path) {
					this.file = null;
					this.plugin.syncToolboxFile(null);
					this.scroller.stop();
					void this.render();
				}
			})
		);
	}

	async onClose(): Promise<void> {
		this.renderGeneration++;
		this.scroller.stop();
	}

	toggleAutoscroll(): void {
		this.scroller.toggle();
	}

	/** Song directive beats the global setting; live +/- beats both. */
	private effectiveSpeed(): number {
		return this.speedOverride ?? this.songSpeed ?? this.plugin.settings.autoscrollSpeed;
	}

	nudgeAutoscroll(delta: number): void {
		const next = Math.max(5, Math.min(300, this.effectiveSpeed() + delta));
		if (this.songSpeed !== null) {
			// The song declares its own speed; adjust it for this session
			// without rewriting the note or the global setting.
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
			this.scrollBtnEl.setText(this.scroller.active ? "Pause" : "Auto");
		}
		this.speedEl?.setText(String(this.effectiveSpeed()));
	}

	getViewType(): string {
		return CHART_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file ? `Chart: ${this.file.basename}` : "ChordPro chart";
	}

	getIcon(): string {
		return "music";
	}

	getFile(): TFile | null {
		return this.file;
	}

	getServiceFile(): TFile | null {
		return this.serviceFile;
	}

	async setFile(file: TFile, service: TFile | null = null): Promise<void> {
		this.file = file;
		this.serviceFile = service;
		this.serviceContext = service ? await this.loadServiceContext(service) : null;
		this.plugin.syncToolboxFile(file);
		this.offset = 0;
		this.nashville = false;
		this.lyricsOnly = false;
		this.shapes = false;
		this.formOn = this.plugin.settings.formDefaultOn;
		// A new song should not inherit the previous song's scrolling.
		this.scroller.stop();
		this.songSpeed = null;
		this.speedOverride = null;
		await this.render();
	}

	getState(): Record<string, unknown> {
		return {
			file: this.file?.path ?? null,
			servicePath: this.serviceFile?.path ?? null,
			offset: this.offset,
			nashville: this.nashville,
			lyricsOnly: this.lyricsOnly,
			shapes: this.shapes,
			zoom: this.zoom,
			cols: this.cols,
			formOn: this.formOn
		};
	}

	async setState(
		state: {
			file?: string;
			servicePath?: string;
			offset?: number;
			nashville?: boolean;
			lyricsOnly?: boolean;
			shapes?: boolean;
			zoom?: number;
			cols?: number;
			formOn?: boolean;
		},
		result: never
	): Promise<void> {
		if (state?.file) {
			const file = this.app.vault.getAbstractFileByPath(state.file);
			if (file instanceof TFile) {
				this.file = file;
				const service = state.servicePath ? this.app.vault.getAbstractFileByPath(state.servicePath) : null;
				this.serviceFile = service instanceof TFile ? service : null;
				this.serviceContext = this.serviceFile ? await this.loadServiceContext(this.serviceFile) : null;
				this.plugin.syncToolboxFile(file);
				this.offset = state.offset ?? 0;
				this.nashville = state.nashville ?? false;
				this.lyricsOnly = state.lyricsOnly ?? false;
				this.shapes = state.shapes ?? false;
				this.zoom = state.zoom ?? 100;
				this.cols = state.cols ?? 0;
				this.formOn = state.formOn ?? true;
				await this.render();
			}
		}
	}

	async render(): Promise<void> {
		const generation = ++this.renderGeneration;
		const scrollTop = this.chartScrollEl?.scrollTop ?? 0;
		const reopenTools = this.chrome?.isToolsOpen() ?? false;
		if (!this.cols) {
			this.cols = this.plugin.settings.previewColumns || this.plugin.settings.chartColumns || 1;
		}
		const root = this.contentEl;
		root.empty();
		root.addClass("cps-chart-view", "cps-preview-view");

		if (!this.file) {
			root.createDiv({ text: "No song file selected." });
			return;
		}

		const file = this.file;
		const raw = await this.app.vault.cachedRead(file);
		if (generation !== this.renderGeneration || this.file !== file) return;
		// Frontmatter properties are the canonical metadata for .md songs;
		// resolve them into directives before anything else looks at the song.
		const resolved = applyFrontmatter(raw);
		this.songSpeed = detectAutoscroll(resolved);
		const form = detectForm(resolved);
		const source = form && this.formOn ? expandForm(resolved) : resolved;
		const capo = detectCapo(source);
		const key = detectKey(source) ?? undefined;

		const displayOffset = this.offset - (this.shapes && capo > 0 ? capo : 0);
		let displaySource = transposeSource(source, displayOffset, key);
		if (this.nashville) displaySource = toNashvilleSource(displaySource);
		const chart = renderChart(displaySource, 0);

		const main = root.createEl("main", { cls: "cps-stage-main cps-preview-main" });
		this.chartScrollEl = main;
		const currentIndex = this.serviceContext?.entries.findIndex((entry) => entry.file?.path === file.path) ?? -1;
		this.chrome = new StageChrome({
			host: root,
			main,
			surface: "preview",
			services: listSetlistFiles(this.app, this.plugin.settings.setlistsFolder),
			context: this.serviceContext,
			currentIndex,
			title: file.basename,
			position: this.serviceContext && currentIndex >= 0 ? `${currentIndex + 1} / ${this.serviceContext.entries.length}` : "",
			cardsSelectable: false,
			onChooseService: (service) => void this.attachService(service),
			onSelectEntry: (entry) => void this.selectServiceEntry(entry)
		});
		root.prepend(this.chrome.topbar);
		this.chrome.setTools((panel) => this.renderTools(panel, chart.meta.key, key !== undefined, capo, form !== null));
		if (reopenTools) this.chrome.openTools();
		root.onkeydown = (evt) => {
			if (evt.key === "Escape" && this.chrome?.closeTopLayer()) evt.stopPropagation();
		};

		const body = main.createDiv({ cls: "cps-chart" });
		setChartHtml(body, chart.html);
		body.toggleClass("cps-lyrics-only", this.lyricsOnly);
		if (this.plugin.settings.chordTapDock) {
			attachChordClicks(body, (symbol) => void this.plugin.openChordDock(symbol));
		}
		appendMetaLine(body, chart, capo, this.shapes && capo > 0 ? " (shape chords)" : "");
		const audio = detectAudio(resolved);
		if (audio) appendAudioLine(body, this.app, this.file.path, audio);
		if (form && this.formOn && this.plugin.settings.formStripPreview) appendFormStrip(body, form);

		body.toggleClass("cps-cols-2", this.cols === 2);
		body.toggleClass("cps-cols-3", this.cols === 3);
		body.style.fontSize = this.zoom === 100 ? "" : this.zoom / 100 + "em";

		if (this.plugin.settings.diagramPlacement === "chart-top" && !this.nashville) {
			appendDiagramStrip(body, displaySource);
		}

		this.formUpdater =
			form && this.formOn && this.plugin.settings.formHighlight
				? formHighlighter(main, { el: body, form })
				: null;
		main.addEventListener("wheel", () => this.scroller.stop(), { passive: true });
		main.addEventListener("touchmove", () => this.scroller.stop(), { passive: true });
		main.addEventListener("scroll", () => this.formUpdater?.(), { passive: true });
		main.scrollTop = scrollTop;
		this.app.workspace.requestSaveLayout();
	}

	private renderTools(panel: HTMLElement, currentKey: string | null, hasKey: boolean, capo: number, hasForm: boolean): void {
		const row = (label: string) => {
			const el = panel.createDiv({ cls: "cps-stage-tool-row" });
			el.createSpan({ cls: "cps-stage-tool-label", text: label });
			return el.createDiv({ cls: "cps-stage-tool-actions" });
		};
		const button = (parent: HTMLElement, text: string, label: string, action: () => void, active?: boolean) => {
			const el = parent.createEl("button", { cls: "cps-stage-choice" + (active === true ? " is-active" : ""), text });
			el.setAttribute("aria-label", label);
			if (active !== undefined) el.setAttribute("aria-pressed", String(active));
			el.addEventListener("click", action);
			return el;
		};

		const chart = row("Chart");
		button(chart, "−", "Transpose down a semitone", () => void this.setOffset(this.offset - 1));
		chart.createSpan({ cls: "cps-stage-key", text: `Key: ${currentKey ?? "—"}` });
		button(chart, "+", "Transpose up a semitone", () => void this.setOffset(this.offset + 1));
		if (hasKey) button(chart, "145", "Toggle Nashville numbers", () => { this.nashville = !this.nashville; void this.render(); }, this.nashville);
		button(chart, "Lyrics", "Toggle lyrics-only view", () => { this.lyricsOnly = !this.lyricsOnly; void this.render(); }, this.lyricsOnly);

		if (capo > 0 || hasForm || this.offset !== 0) {
			const song = row("Song");
			if (capo > 0) button(song, `Shapes ${capo}`, `Toggle capo ${capo} shapes`, () => { this.shapes = !this.shapes; void this.render(); }, this.shapes);
			if (hasForm) button(song, "Form", "Toggle declared song form", () => { this.formOn = !this.formOn; void this.render(); }, this.formOn);
			if (this.offset !== 0) {
				button(song, "Reset", "Reset live transpose", () => void this.setOffset(0));
				button(song, "Write to file", "Write transpose to song file", () => void this.writeTranspose());
			}
		}

		const text = row("Text");
		button(text, "A−", "Smaller text", () => { this.zoom = Math.max(50, this.zoom - 10); void this.render(); });
		text.createSpan({ cls: "cps-stage-value", text: `${this.zoom}%` });
		button(text, "A+", "Larger text", () => { this.zoom = Math.min(250, this.zoom + 10); void this.render(); });

		const columns = row("Columns");
		for (const count of [1, 2, 3]) button(columns, String(count), `${count} column${count === 1 ? "" : "s"}`, () => { this.cols = count; void this.render(); }, this.cols === count);

		const playback = row("Autoscroll");
		this.scrollBtnEl = button(playback, "Auto", "Toggle autoscroll", () => this.toggleAutoscroll(), this.scroller.active);
		button(playback, "−", "Autoscroll slower", () => this.nudgeAutoscroll(-5));
		this.speedEl = playback.createSpan({ cls: "cps-stage-value", text: String(this.effectiveSpeed()) });
		button(playback, "+", "Autoscroll faster", () => this.nudgeAutoscroll(5));

		const view = row("View");
		button(view, "Performance", "Enter performance mode", () => void this.plugin.enterPerformanceMode());
		this.syncScrollUi();
	}

	private async attachService(service: TFile): Promise<void> {
		try {
			const context = await buildServiceContext(this.app, service, this.plugin.getStageFileTypes());
			this.serviceFile = service;
			this.serviceContext = context;
			await this.render();
		} catch (err) {
			new Notice(`Could not read service: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async loadServiceContext(service: TFile): Promise<ServiceContext | null> {
		try {
			return await buildServiceContext(this.app, service, this.plugin.getStageFileTypes());
		} catch (err) {
			new Notice(`Could not read service: ${err instanceof Error ? err.message : String(err)}`);
			return null;
		}
	}

	private async selectServiceEntry(entry: ServiceEntry): Promise<void> {
		if (!entry.file) return;
		if (entry.fileKind === "song") {
			await this.setFile(entry.file, this.serviceFile);
			return;
		}
		await this.app.workspace.getLeaf("tab").openFile(entry.file);
	}

	private async setOffset(offset: number): Promise<void> {
		this.offset = ((offset % 12) + 12) % 12 === 0 && offset !== 0 ? 0 : Math.max(-11, Math.min(11, offset));
		await this.render();
	}

	private async writeTranspose(): Promise<void> {
		if (!this.file || this.offset === 0) return;
		const source = await this.app.vault.read(this.file);
		const key = detectKey(applyFrontmatter(source)) ?? undefined;
		const semitones = this.offset;
		await this.app.vault.process(this.file, (current) =>
			transposeSource(current, semitones, detectKey(applyFrontmatter(current)) ?? key));
		if (this.file.extension === "md") {
			// The canonical key for .md songs may live in frontmatter.
			await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
				if (typeof fm.key === "string") {
					const m = fm.key.trim().match(/^([A-G][#b]?)(m?)$/);
					if (m) fm.key = transposeKeyName(m[1], m[2] === "m", semitones);
				}
			});
		}
		this.offset = 0;
		new Notice("Transposed chords written to file.");
		await this.render();
	}
}
