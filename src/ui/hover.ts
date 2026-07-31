// Hover-to-reveal fingering (BRIEF.md 5e): a CodeMirror 6 extension that shows
// the primary guitar diagram when the pointer rests on a [Chord] token in the
// editor. Uses CM6's hoverTooltip, which handles positioning and lifecycles;
// the approach follows olvidalo/obsidian-chord-sheets (MIT), simplified.
import { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import { findChord, isChordSymbol, positionToDiagram } from "../core/chords";
import { drawDiagram } from "./diagram";

export function chordHoverExtension(): Extension {
	return hoverTooltip(
		(view, pos) => {
			const line = view.state.doc.lineAt(pos);
			const text = line.text;
			const re = /\[([^[\]]+)\]/g;
			let m: RegExpExecArray | null;

			while ((m = re.exec(text)) !== null) {
				const from = line.from + m.index;
				const to = from + m[0].length;
				if (pos < from || pos > to) continue;

				// Skip markdown links [text](url) and wikilinks [[target]].
				const before = m.index > 0 ? text[m.index - 1] : "";
				const after = m.index + m[0].length < text.length ? text[m.index + m[0].length] : "";
				if (before === "[" || before === "!" || after === "(") return null;

				const symbol = m[1].trim();
				if (!isChordSymbol(symbol)) return null;
				const dbChord = findChord(symbol);
				if (!dbChord || dbChord.positions.length === 0) return null;

				return {
					pos: from,
					end: to,
					above: true,
					create: () => {
						const dom = createDiv();
						dom.classList.add("sb-hover-tooltip");
						const name = createDiv();
						name.classList.add("sb-hover-name");
						name.textContent = symbol;
						dom.appendChild(name);
						const diagramEl = createDiv();
						diagramEl.classList.add("sb-diagram");
						dom.appendChild(diagramEl);
						drawDiagram(diagramEl, positionToDiagram(symbol, dbChord.positions[0]));
						return {
							dom,
							mount: () => dom.parentElement?.classList.add("sb-hover-tooltip-host"),
							destroy: () => dom.parentElement?.classList.remove("sb-hover-tooltip-host")
						};
					}
				};
			}
			return null;
		},
		{ hoverTime: 250 }
	);
}
