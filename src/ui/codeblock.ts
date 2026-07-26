// Reading-mode renderer for ```chordpro fenced blocks in .md notes
// (BRIEF.md section 6a). Includes per-block transpose and Nashville-number
// controls; both are display-only and never touch the note. The host note's
// frontmatter properties (key, capo, tempo...) feed the render as directives.
import { setIcon } from "obsidian";
import type ChordProStudioPlugin from "../main";
import { detectKey, renderChart, transposeSource } from "../core/chordpro";
import { metaToDirectives } from "../core/frontmatter";
import { toNashvilleSource } from "../core/nashville";
import { appendDiagramStrip, attachChordClicks, setChartHtml } from "./render-song";

export function renderChordproBlock(
	plugin: ChordProStudioPlugin,
	source: string,
	el: HTMLElement,
	frontmatter?: Record<string, unknown> | null
): void {
	el.addClass("cps-codeblock");
	let offset = 0;
	let nashville = false;

	// Frontmatter is the canonical metadata for .md songs; translate it into
	// directives the block does not already declare.
	const directives = frontmatter ? metaToDirectives(frontmatter, source) : [];
	const resolved = directives.length > 0 ? directives.join("\n") + "\n\n" + source : source;
	const key = detectKey(resolved) ?? undefined;

	const controls = el.createDiv({ cls: "cps-chart-controls cps-codeblock-controls" });
	const body = el.createDiv({ cls: "cps-chart" });

	// Tapping a chord opens the Toolbox fingering dock. The listener is
	// delegated on `body`, which outlives each re-render, so it is attached
	// once here rather than inside render(). Settings changes re-run this
	// whole processor via plugin.rerenderReadingViews().
	if (plugin.settings.chordTapDock) {
		attachChordClicks(body, (symbol) => void plugin.openChordDock(symbol));
	}

	const down = controls.createEl("button", { cls: "cps-transpose-btn" });
	setIcon(down, "minus");
	down.setAttribute("aria-label", "Transpose down a semitone");

	const offsetEl = controls.createSpan({ cls: "cps-transpose-offset", text: "0" });

	const up = controls.createEl("button", { cls: "cps-transpose-btn" });
	setIcon(up, "plus");
	up.setAttribute("aria-label", "Transpose up a semitone");

	const reset = controls.createEl("button", { cls: "cps-chart-btn cps-hidden", text: "Reset" });
	reset.setAttribute("aria-label", "Reset transpose");

	let nashBtn: HTMLButtonElement | null = null;
	if (key) {
		nashBtn = controls.createEl("button", { cls: "cps-chart-btn cps-toggle-btn", text: "Nashville" });
		nashBtn.setAttribute("aria-label", "Toggle Nashville numbers");
	}

	const render = () => {
		offsetEl.setText(offset === 0 ? "0" : offset > 0 ? `+${offset}` : `${offset}`);
		reset.toggleClass("cps-hidden", offset === 0);
		nashBtn?.toggleClass("is-active", nashville);
		let displaySource = transposeSource(resolved, offset, key);
		if (nashville) displaySource = toNashvilleSource(displaySource);
		setChartHtml(body, renderChart(displaySource, 0).html);
		if (plugin.settings.diagramPlacement === "inline" && !nashville) {
			appendDiagramStrip(body, displaySource);
		}
	};

	reset.addEventListener("click", () => {
		offset = 0;
		render();
	});

	down.addEventListener("click", () => {
		offset = Math.max(-11, offset - 1);
		render();
	});
	up.addEventListener("click", () => {
		offset = Math.min(11, offset + 1);
		render();
	});
	nashBtn?.addEventListener("click", () => {
		nashville = !nashville;
		render();
	});

	render();
}
