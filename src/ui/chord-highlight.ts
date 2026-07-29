// Colorize [Chord] tokens in the source editor (v0.6.0, Editor settings tab).
// A CM6 ViewPlugin decorating visible ranges only; the token filter matches
// hover.ts so the two features always agree on what a chord is. Color comes
// from the --sb-editor-chord-color variable (falls back to the chord color).
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { isChordSymbol } from "../core/chords";

const CHORD_MARK = Decoration.mark({ class: "sb-editor-chord" });

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		const re = /\[([^[\]\n]+)\]/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			// Skip markdown links [text](url) and wikilinks [[target]].
			const before = m.index > 0 ? text[m.index - 1] : "";
			const after = re.lastIndex < text.length ? text[re.lastIndex] : "";
			if (before === "[" || before === "!" || after === "(") continue;
			if (!isChordSymbol(m[1].trim())) continue;
			builder.add(from + m.index, from + re.lastIndex, CHORD_MARK);
		}
	}
	return builder.finish();
}

export function chordHighlightExtension() {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(update.view);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}
