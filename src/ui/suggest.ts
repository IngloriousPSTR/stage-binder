// Chord autocomplete (roadmap: "typing [ suggests chords in the current
// key"). An EditorSuggest that opens after "[" in song files: diatonic chords
// of the Toolbox's current key first, then every chords-db voicing for the
// root the user has typed.
import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import type ChordProStudioPlugin from "../main";
import { diatonicChords } from "../core/theory";
import { chordVariations } from "../core/chords";

interface ChordSuggestion {
	symbol: string;
	/** Roman numeral when the chord is diatonic to the current key. */
	numeral: string | null;
}

export class ChordSuggest extends EditorSuggest<ChordSuggestion> {
	private plugin: ChordProStudioPlugin;

	constructor(plugin: ChordProStudioPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.chordAutocomplete) return null;
		if (file && file.extension !== "md" && file.extension !== "chordpro") return null;

		const upto = editor.getLine(cursor.line).slice(0, cursor.ch);
		const open = upto.lastIndexOf("[");
		if (open < 0 || upto.indexOf("]", open) >= 0) return null;
		// Skip wikilinks [[...]] and embeds ![...].
		if (open > 0 && (upto[open - 1] === "[" || upto[open - 1] === "!")) return null;

		const query = upto.slice(open + 1);
		// Only complete things that could become a chord: empty, or a note
		// letter followed by chord vocabulary (no spaces).
		if (query.length > 0 && !/^[A-Ga-g][^\s[\]]*$/.test(query)) return null;

		return {
			start: { line: cursor.line, ch: open + 1 },
			end: cursor,
			query
		};
	}

	getSuggestions(context: EditorSuggestContext): ChordSuggestion[] {
		const query = context.query;
		const { tonic, mode } = this.plugin.currentKey();

		const out: ChordSuggestion[] = [];
		const seen = new Set<string>();
		const push = (symbol: string, numeral: string | null) => {
			if (seen.has(symbol)) return;
			seen.add(symbol);
			out.push({ symbol, numeral });
		};

		for (const chord of diatonicChords(tonic, mode)) {
			push(chord.symbol, chord.numeral);
		}

		// Everything chords-db knows for the typed root ("D" -> Dm7, Dsus4...).
		const rootMatch = query.match(/^([A-Ga-g])([#b]?)/);
		if (rootMatch) {
			const root = rootMatch[1].toUpperCase() + rootMatch[2];
			for (const symbol of chordVariations(root)) {
				push(symbol, null);
			}
		}

		const lower = query.toLowerCase();
		return out.filter((s) => s.symbol.toLowerCase().startsWith(lower)).slice(0, 24);
	}

	renderSuggestion(suggestion: ChordSuggestion, el: HTMLElement): void {
		el.addClass("cps-suggest-item");
		el.createSpan({ cls: "cps-suggest-symbol", text: suggestion.symbol });
		if (suggestion.numeral) {
			el.createSpan({ cls: "cps-suggest-numeral", text: suggestion.numeral });
		}
	}

	selectSuggestion(suggestion: ChordSuggestion): void {
		const context = this.context;
		if (!context) return;
		const editor = context.editor;
		// Consume a "]" the user may already have typed after the cursor.
		const lineAfter = editor.getLine(context.end.line).slice(context.end.ch);
		const end = lineAfter.startsWith("]")
			? { line: context.end.line, ch: context.end.ch + 1 }
			: context.end;
		editor.replaceRange(suggestion.symbol + "]", context.start, end);
		editor.setCursor({
			line: context.start.line,
			ch: context.start.ch + suggestion.symbol.length + 1
		});
	}
}
