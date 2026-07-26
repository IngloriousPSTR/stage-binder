// Nashville number rendering (roadmap: "Nashville numbers toggle").
// Rewrites every [Chord] token in a ChordPro source into its Nashville number
// relative to the song's key, so a chart can render as numbers for band
// handouts. Display-only; callers pass the transposed display source.
// No Obsidian imports.
import { isChordSymbol } from "./chords";
import { detectKey } from "./chordpro";
import { chordToNashville } from "./music";

export { chordToNashville };

/**
 * Rewrite every chord token in the source as its Nashville number.
 * Minor songs number from their own tonic (i is 1m). Returns the source
 * unchanged when it declares no key.
 */
export function toNashvilleSource(source: string): string {
	const key = detectKey(source);
	if (!key) return source;
	return source.replace(/\[([^[\]]+)\]/g, (whole, token: string) => {
		if (!isChordSymbol(token)) return whole;
		return "[" + chordToNashville(token.trim(), key.tonic) + "]";
	});
}
