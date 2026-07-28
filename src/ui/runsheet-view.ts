// Run sheet view (v0.4.0): the order-of-service note as a stage-ready
// timeline. The note stays a plain outline (headings, list items, wikilinks);
// this view lays it out as clock time | item | who | length, resolves song
// links to their performance keys, and jumps straight into the chart or
// performance mode. The roadmap's service-workflow vision, first cut.
import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type StageBinderPlugin from "../main";
import { displayText, formatClock, formatDuration, parseRunsheet } from "../core/runsheet";
import { collectSetlistSongs, SetlistEntry } from "./render-song";

export const RUNSHEET_VIEW_TYPE = "chordpro-studio-runsheet";

export class RunsheetView extends ItemView {
	private plugin: StageBinderPlugin;
	private file: TFile | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StageBinderPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.file && file.path === this.file.path) void this.render();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.file && file.path === this.file.path) {
					this.file = null;
					void this.render();
				}
			})
		);
	}

	getViewType(): string {
		return RUNSHEET_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file ? `Run sheet: ${this.file.basename}` : "Run sheet";
	}

	getIcon(): string {
		return "clipboard-list";
	}

	getFile(): TFile | null {
		return this.file;
	}

	getState(): Record<string, unknown> {
		return { file: this.file?.path ?? null };
	}

	async setState(state: { file?: string }, result: never): Promise<void> {
		if (state?.file) {
			const file = this.app.vault.getAbstractFileByPath(state.file);
			if (file instanceof TFile) {
				this.file = file;
				await this.render();
			}
		}
	}

	async setFile(file: TFile): Promise<void> {
		this.file = file;
		await this.render();
	}

	async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("cps-runsheet-view");

		if (!this.file) {
			root.createDiv({
				cls: "cps-setlist-empty",
				text: "No note selected. Open your order-of-service note and run “Open run sheet”."
			});
			return;
		}

		const source = await this.app.vault.cachedRead(this.file);
		const runsheet = parseRunsheet(source);
		const songs = await collectSetlistSongs(this.app, this.file);
		const songByLine = new Map<number, { entry: SetlistEntry; index: number }>();
		songs.forEach((entry, index) => {
			if (entry.line !== undefined) songByLine.set(entry.line, { entry, index });
		});

		const bar = root.createDiv({ cls: "cps-chart-controls cps-runsheet-bar" });
		bar.createSpan({ cls: "cps-runsheet-title", text: this.file.basename });
		if (runsheet.totalSeconds > 0) {
			bar.createSpan({
				cls: "cps-runsheet-total",
				text: `${formatDuration(runsheet.totalSeconds)} planned`
			});
		}
		if (runsheet.items.some((item) => item.kind === "item")) {
			const perfBtn = bar.createEl("button", { cls: "cps-chart-btn cps-perform-btn", text: "Perform" });
			perfBtn.setAttribute("aria-label", "Enter performance mode with this service");
			perfBtn.addEventListener("click", () => void this.plugin.performance.open(songs, 0, undefined, this.file));
		}

		if (runsheet.items.length === 0) {
			root.createDiv({
				cls: "cps-setlist-empty",
				text: "Nothing to schedule yet. Add list items like “- Welcome @Chris (2 min)”; headings become section breaks, and a start property (start: 9:30 AM) turns durations into clock times."
			});
			return;
		}

		const table = root.createDiv({ cls: "cps-runsheet" });
		for (const item of runsheet.items) {
			if (item.kind === "divider") {
				const divider = table.createDiv({ cls: "cps-runsheet-divider" });
				divider.createSpan({ cls: "cps-runsheet-time", text: formatClock(runsheet, item.offsetSeconds) });
				divider.createSpan({ cls: "cps-runsheet-heading", text: displayText(item.text) });
				continue;
			}

			const row = table.createDiv({ cls: "cps-runsheet-row" });
			row.createSpan({ cls: "cps-runsheet-time", text: formatClock(runsheet, item.offsetSeconds) });

			const main = row.createDiv({ cls: "cps-runsheet-main" });
			const song = songByLine.get(item.line);
			if (song) {
				row.addClass("cps-runsheet-song");
				let label = displayText(item.text);
				if (song.entry.label) {
					// The key shows as a chip; drop the raw "in G" remnant.
					label = label.replace(new RegExp("\\bin\\s+" + song.entry.label + "\\b"), "").replace(/\s{2,}/g, " ").trim();
				}
				const title = main.createSpan({ cls: "cps-runsheet-song-title", text: label || song.entry.file.basename });
				title.addEventListener("click", () => void this.plugin.openChartPreview(song.entry.file, this.file));
				if (song.entry.label) {
					main.createSpan({ cls: "cps-form-chip cps-runsheet-key", text: song.entry.label });
				}
				const play = main.createEl("button", { cls: "cps-chart-btn cps-runsheet-play" });
				setIcon(play, "play");
				play.setAttribute("aria-label", "Perform from this song");
				play.addEventListener("click", () => void this.plugin.performance.open(songs, song.index, undefined, this.file, song.entry.line));
			} else {
				main.createSpan({ text: displayText(item.text) });
			}

			row.createSpan({
				cls: "cps-runsheet-people",
				text: item.people.join(", ")
			});
			row.createSpan({
				cls: "cps-runsheet-length",
				text: item.seconds !== null ? formatDuration(item.seconds) : ""
			});
		}
	}
}
