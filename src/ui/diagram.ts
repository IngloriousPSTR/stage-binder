// Thin wrapper around svguitar. DOM only, no Obsidian imports, so it can move
// to a standalone app together with src/core.
import { SVGuitarChord } from "svguitar";
import { DiagramData } from "../core/chords";

export function drawDiagram(el: HTMLElement, data: DiagramData, showTitle = false): void {
	el.replaceChildren();
	new SVGuitarChord(el)
		.configure({
			strings: 6,
			frets: data.frets,
			position: data.position,
			title: showTitle ? data.title : undefined,
			// currentColor makes the SVG inherit the surrounding CSS text color,
			// so diagrams adapt to light and dark themes automatically.
			color: "currentColor",
			backgroundColor: "none",
			fretSize: 1.4,
			fingerTextSize: 26,
			nutWidth: 8
		})
		.chord({
			// svguitar's Finger tuple type is stricter than the data shape;
			// the values match its documented [string, fret, text] form.
			fingers: data.fingers,
			barres: data.barres
		})
		.draw();
}
