// Persistent chord-diagram panel (diagramPlacement: "sidebar"): a right-sidebar
// ItemView showing the active song's chord set as fingering diagrams in
// first-use order. Follows file-open and live edits; tapping a diagram opens
// the Toolbox fingering dock with that chord's voicings.
import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type StageBinderPlugin from "../main";
import { usedChords } from "../core/chordpro";
import { applyFrontmatter } from "../core/frontmatter";
import { findChord, positionToDiagram } from "../core/chords";
import { drawDiagram } from "./diagram";

export const DIAGRAM_PANEL_VIEW_TYPE = "stage-binder-diagram-panel";

export class DiagramPanelView extends ItemView {
	private plugin: StageBinderPlugin;
	private file: TFile | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StageBinderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DIAGRAM_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Chord diagrams";
	}

	getIcon(): string {
		return "guitar";
	}

	async onOpen(): Promise<void> {
		await this.setSong(this.plugin.getActiveSongFile());
	}

	/** Point the panel at a song (or null) and re-render. */
	async setSong(file: TFile | null): Promise<void> {
		this.file = file;
		await this.render();
	}

	/** Re-render when the file this panel is showing changes on disk. */
	async refreshIf(file: TFile): Promise<void> {
		if (this.file && this.file.path === file.path) await this.render();
	}

	async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("sb-diagram-panel");

		if (!this.file) {
			root.createDiv({ cls: "sb-panel-empty", text: "Open a song to see its chords." });
			return;
		}

		let source: string;
		try {
			source = applyFrontmatter(await this.app.vault.cachedRead(this.file));
		} catch (err) {
			console.error("Stage Binder: diagram panel read failed", err);
			root.createDiv({ cls: "sb-panel-empty", text: "Could not read the song." });
			return;
		}

		root.createDiv({ cls: "sb-panel-title", text: this.file.basename });

		const symbols = usedChords(source);
		if (symbols.length === 0) {
			root.createDiv({ cls: "sb-panel-empty", text: "No chords in this note yet." });
			return;
		}

		const grid = root.createDiv({ cls: "sb-chart-diagrams" });
		for (const symbol of symbols) {
			const dbChord = findChord(symbol);
			if (!dbChord || dbChord.positions.length === 0) continue;
			const cell = grid.createDiv({ cls: "sb-strip-cell sb-panel-cell" });
			cell.setAttribute("aria-label", `Open ${symbol} voicings`);
			cell.createDiv({ cls: "sb-strip-name", text: symbol });
			const diagramEl = cell.createDiv({ cls: "sb-diagram sb-strip-diagram" });
			drawDiagram(diagramEl, positionToDiagram(symbol, dbChord.positions[0]));
			cell.addEventListener("click", () => void this.plugin.openChordDock(symbol));
		}
		if (grid.childElementCount === 0) {
			grid.remove();
			root.createDiv({ cls: "sb-panel-empty", text: "No fingerings found for this song's chords." });
		}
	}
}
