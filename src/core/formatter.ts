// "Format pasted lyrics to ChordPro" (BRIEF.md 5d).
// Turns lyrics pasted from Genius, SongSelect, and similar sites into a
// ChordPro skeleton using the plugin's section conventions.
// The transform is deliberately conservative: when a line is ambiguous it is
// left alone rather than guessed at.
import { isChordSymbol } from "./chords";

// Section names from the fixed set in BRIEF.md section 8. "pre chorus" and
// "prechorus" normalize to "pre-chorus". Names outside this set are left alone.
const SECTION_WORD = "intro|outro|verse|chorus|pre[\\s-]?chorus|bridge|instrumental|tag";

// Matches a whole line that is only a section marker:
//   Verse 1   Verse 1:   [Verse 1]   [Chorus: Artist]   (Bridge)   CHORUS
const SECTION_LINE_RE = new RegExp(
	"^\\s*(?:\\[\\s*(" + SECTION_WORD + ")\\s*(\\d+)?(?:\\s*[:\\-][^\\]]*)?\\s*\\]" +
	"|\\(\\s*(" + SECTION_WORD + ")\\s*(\\d+)?\\s*\\)" +
	"|(" + SECTION_WORD + ")\\s*(\\d+)?\\s*:?)\\s*$",
	"i"
);

const HEADER_LINE_RE = /^\s*(title|artist|key|tempo|time|bpm)\s*[:–-]\s*(.+?)\s*$/i;

// Site cruft that should never survive into a chart.
const CRUFT_RES = [
	/^\d+\s+contributors?.*$/i,
	/^\d*\s*embed\s*$/i,
	/^you might also like\s*$/i,
	/^see .+ live\s*$/i,
	/^get tickets as low as .*$/i,
	/^\d+$/, // stray line numbers / vote counts
	/^translations\s*$/i
];

interface ParsedSection {
	name: string;
	number: string | null;
}

function matchSection(line: string): ParsedSection | null {
	const m = line.match(SECTION_LINE_RE);
	if (!m) return null;
	const name = (m[1] ?? m[3] ?? m[5] ?? "").toLowerCase().replace(/pre[\s-]?chorus/, "pre-chorus");
	const number = m[2] ?? m[4] ?? m[6] ?? null;
	return { name, number };
}

function isCruft(line: string): boolean {
	const trimmed = line.trim();
	if (CRUFT_RES.some((re) => re.test(trimmed))) return true;
	// Bracketed annotation lines like "[Produced by X]" that are neither a
	// section marker nor a chord line get dropped.
	const bracketOnly = trimmed.match(/^\[([^\]]+)\]$/);
	if (bracketOnly && !matchSection(trimmed) && !isChordLine(trimmed)) return true;
	return false;
}

/** True for lines that are only bracketed chords: "[A] [F#m]". */
function isChordLine(line: string): boolean {
	const tokens = line.trim().match(/\[[^\]]+\]/g);
	if (!tokens) return false;
	const rest = line.replace(/\[[^\]]+\]/g, "").trim();
	if (rest.length > 0) return false;
	return tokens.every((t) => isChordSymbol(t.slice(1, -1)));
}

/**
 * Transform pasted lyrics into a ChordPro skeleton.
 * Lyric lines are left untouched; only section markers, headers, and cruft
 * are rewritten or removed.
 */
export function formatLyrics(input: string): string {
	const lines = input.split(/\r?\n/);
	const headers = new Map<string, string>();
	const body: string[] = [];

	let firstContentSeen = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].replace(/\s+$/, "");
		const trimmed = line.trim();

		if (trimmed.length === 0) {
			body.push("");
			continue;
		}

		if (isCruft(trimmed)) continue;

		// Existing ChordPro directives pass through untouched.
		if (/^\{[^}]*\}$/.test(trimmed)) {
			body.push(trimmed);
			firstContentSeen = true;
			continue;
		}

		// Header lines like "Key: A" anywhere near the top of the paste.
		const header = trimmed.match(HEADER_LINE_RE);
		if (header && !firstContentSeen) {
			const name = header[1].toLowerCase() === "bpm" ? "tempo" : header[1].toLowerCase();
			if (!headers.has(name)) headers.set(name, header[2]);
			continue;
		}

		const section = matchSection(trimmed);
		if (section) {
			const label = section.name
				.split("-")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join("-") + (section.number ? ` ${section.number}` : "");
			const directive = `{comment: ${label}}`;
			// Blank line before each section, per the section 8 file style.
			if (body.length > 0 && body[body.length - 1] !== "") body.push("");
			body.push(directive);
			firstContentSeen = true;
			continue;
		}

		// First-line title heuristic, only when nothing else claimed a title:
		// a short first line immediately followed by a section marker or a
		// blank line then a section marker.
		if (!firstContentSeen && !headers.has("title") && trimmed.length <= 60 && !/[.,;:!?]$/.test(trimmed)) {
			let j = i + 1;
			while (
				j < lines.length &&
				(lines[j].trim().length === 0 || isCruft(lines[j].trim()) || HEADER_LINE_RE.test(lines[j].trim()))
			) {
				j++;
			}
			const next = j < lines.length ? lines[j].trim() : "";
			if (next && matchSection(next)) {
				// "Song Title" or "Song Title by Artist"
				const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
				if (byMatch) {
					headers.set("title", byMatch[1].trim());
					if (!headers.has("artist")) headers.set("artist", byMatch[2].trim());
				} else {
					headers.set("title", trimmed);
				}
				continue;
			}
		}

		body.push(line);
		firstContentSeen = true;
	}

	// Assemble: headers first (fixed order), blank line, then the body with
	// runs of blank lines collapsed.
	const out: string[] = [];
	for (const name of ["title", "artist", "key", "time", "tempo"]) {
		const value = headers.get(name);
		if (value !== undefined) out.push(`{${name}: ${value}}`);
	}
	if (out.length > 0) out.push("");

	let blankRun = 0;
	let pushedContent = false;
	for (const line of body) {
		if (line === "") {
			blankRun++;
			continue;
		}
		if (pushedContent && blankRun > 0) out.push("");
		blankRun = 0;
		out.push(line);
		pushedContent = true;
	}

	return out.join("\n") + (pushedContent ? "\n" : "");
}
