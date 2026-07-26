// Stage-ready song text for print notes and team share exports (v0.4.0).
// One resolver: frontmatter properties become directives, the form/roadmap
// expands into performance order, and the chart transposes into the setlist's
// performance key. What the band reads on paper matches what the setlist
// plays. No Obsidian imports.
import { detectKey, semitonesBetween, transposeSource } from "./chordpro";
import { applyFrontmatter } from "./frontmatter";
import { expandForm } from "./form";

/**
 * Resolve a raw .md/.chordpro source into a self-contained ChordPro text:
 * directives up top, sections in form order, chords in targetKey (a tonic
 * like "G"; null keeps the song's own key).
 */
export function prepareSongText(raw: string, targetKey: string | null = null): string {
	const resolved = applyFrontmatter(raw);
	let text = expandForm(resolved);
	if (targetKey) {
		const key = detectKey(text);
		if (key) {
			const semitones = semitonesBetween(key.tonic, targetKey);
			if (semitones !== 0) text = transposeSource(text, semitones, key);
		}
	}
	return text.replace(/\s+$/, "") + "\n";
}

/**
 * File name for one exported song: "03 Amazing Grace (G).chordpro".
 * The order prefix keeps any file browser showing the set in set order.
 */
export function shareFileName(index: number, title: string, keyLabel: string | null): string {
	const safe = title.replace(/[\\/:#^[\]|?*]/g, "").trim() || "Untitled song";
	const num = String(index + 1).padStart(2, "0");
	return `${num} ${safe}${keyLabel ? ` (${keyLabel})` : ""}.chordpro`;
}
