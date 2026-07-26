// Import pipelines (no Obsidian imports):
// - parseImportedSong: .txt/.cho/.chordpro files from disk (v0.2.0 command),
//   reading metadata from directives or "-chordpro-KEY" filenames.
// - convertPastedChart: Smart Paste (v0.3.0). Takes whatever a website's copy
//   button produced (SongSelect, Ultimate Guitar, PraiseCharts, plain text)
//   and returns ChordPro: chords-over-lyrics lines merge into bracketed
//   lyrics, [Verse 1] style markers become sections, header lines become
//   directives, CCLI numbers are captured, site cruft is dropped.
import { isChordSymbol } from "./chords";
import { formatLyrics } from "./formatter";
import { yamlValue } from "./frontmatter";

export interface ImportMeta {
	[key: string]: string | undefined;
	title?: string;
	artist?: string;
	key?: string;
	capo?: string;
	time?: string;
	tempo?: string;
	ccli?: string;
}

export interface ParsedImport {
	meta: ImportMeta;
	body: string;
	title: string;
}

export type SongLibraryKind = "chordpro" | "text" | "pdf" | "slides";

const SONG_LIBRARY_FOLDERS: Record<SongLibraryKind, string> = {
	chordpro: "ChordPro",
	text: "Text",
	pdf: "PDF",
	slides: "Slides"
};

/** The stable format folder beneath the configured song-library root. */
export function songLibraryFolder(root: string | null | undefined, kind: SongLibraryKind): string {
	const cleanRoot = (root || "Songs").trim().replace(/^\/+|\/+$/g, "") || "Songs";
	return `${cleanRoot}/${SONG_LIBRARY_FOLDERS[kind]}`;
}

/** Route a created file extension into the library's format hierarchy. */
export function songLibraryFolderForExtension(root: string | null | undefined, extension: string): string {
	const ext = extension.trim().replace(/^\./, "").toLowerCase();
	if (["chordpro", "cho", "chopro", "pro", "crd"].includes(ext)) return songLibraryFolder(root, "chordpro");
	if (ext === "pdf") return songLibraryFolder(root, "pdf");
	if (["ppt", "pptx"].includes(ext)) return songLibraryFolder(root, "slides");
	if (["md", "txt"].includes(ext)) return songLibraryFolder(root, "text");
	throw new Error(`Unsupported song-library extension: ${extension}`);
}

const IMPORT_DIRECTIVES: Array<[keyof ImportMeta & string, RegExp]> = [
	["title", /\{\s*(?:title|t)\s*:\s*([^}]*)\}/i],
	["artist", /\{\s*(?:artist|subtitle|st)\s*:\s*([^}]*)\}/i],
	["key", /\{\s*key\s*:\s*([^}]*)\}/i],
	["capo", /\{\s*capo\s*:\s*([^}]*)\}/i],
	["time", /\{\s*time\s*:\s*([^}]*)\}/i],
	["tempo", /\{\s*tempo\s*:\s*([^}]*)\}/i],
	["ccli", /\{\s*ccli\s*:\s*([^}]*)\}/i]
];

function titleCase(s: string): string {
	return s
		.split(/\s+/)
		.filter((w) => w.length > 0)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

/** Parse a chart file for import: metadata out of directives or the filename. */
export function parseImportedSong(fileName: string, text: string): ParsedImport {
	const meta: ImportMeta = {};
	for (const [key, re] of IMPORT_DIRECTIVES) {
		const m = text.match(re);
		if (m && m[1].trim().length > 0) meta[key] = m[1].trim();
	}

	let stem = fileName.replace(/\.[^.]+$/, "");
	const km = stem.match(/-chordpro-([A-G](?:#|b)?m?)$/i);
	if (km && km.index !== undefined) {
		stem = stem.slice(0, km.index);
		if (!meta.key) meta.key = km[1].charAt(0).toUpperCase() + km[1].slice(1);
	}
	stem = stem.replace(/-chordpro$/i, "");
	if (!meta.title) meta.title = titleCase(stem.replace(/[-_]+/g, " "));

	let body = text;
	for (const [key, re] of IMPORT_DIRECTIVES) {
		if (meta[key]) body = body.replace(new RegExp("^[ \\t]*" + re.source + "[ \\t]*\\r?\\n?", "im"), "");
	}
	body = body.replace(/^\s*\n+/, "").replace(/\s+$/, "");
	return { meta, body, title: meta.title ?? "Untitled song" };
}

const META_ORDER = ["title", "artist", "key", "capo", "time", "tempo", "ccli", "form"] as const;

/** A parsed import as a markdown note with frontmatter metadata. */
export function importAsMarkdown(p: ParsedImport): string {
	const lines = ["---"];
	for (const key of META_ORDER) {
		const value = p.meta[key];
		if (value) lines.push(`${key}: ${yamlValue(value)}`);
	}
	lines.push("---", "");
	return lines.join("\n") + "\n" + p.body + "\n";
}

/** A parsed import as a .chordpro file with directive metadata. */
export function importAsChordpro(p: ParsedImport): string {
	const head: string[] = [];
	for (const key of META_ORDER) {
		const value = p.meta[key];
		if (value) head.push(`{${key}: ${value}}`);
	}
	return (head.length > 0 ? head.join("\n") + "\n\n" : "") + p.body + "\n";
}

// --- Smart Paste ------------------------------------------------------------

// Tokens that may sit on a chord line without disqualifying it: bar lines,
// repeat marks, "N.C.", and empty decoration.
const CHORD_LINE_EXTRA_RE = /^(?:\||\|\||-|–|—|%|·|\.|,|\(?[xX]\d+\)?|\(|\)|N\.?C\.?)$/;

/** True for a line that is chords (and decorations) only: "G   C/E  D  x2". */
export function looksLikeChordLine(line: string): boolean {
	const tokens = line.trim().split(/\s+/).filter((t) => t.length > 0);
	if (tokens.length === 0) return false;
	let chords = 0;
	for (const raw of tokens) {
		const token = raw.replace(/^[([]+|[)\],]+$/g, "");
		if (token.length === 0 || CHORD_LINE_EXTRA_RE.test(token)) continue;
		if (!isChordSymbol(token)) return false;
		chords++;
	}
	return chords > 0;
}

/**
 * Merge a chord line into the lyric line under it, ChordPro style. Column
 * positions place each [chord]; chords past the lyric's end pad with spaces
 * so they keep their timing feel.
 */
export function mergeChordLine(chordLine: string, lyricLine: string): string {
	const matches: Array<{ token: string; col: number }> = [];
	const re = /\S+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(chordLine)) !== null) {
		const token = m[0].replace(/^[([]+|[)\],]+$/g, "");
		if (token.length === 0 || CHORD_LINE_EXTRA_RE.test(token)) continue;
		if (isChordSymbol(token)) matches.push({ token, col: m.index });
	}
	let out = lyricLine;
	for (let i = matches.length - 1; i >= 0; i--) {
		const { token, col } = matches[i];
		if (col >= out.length) out = out.padEnd(col);
		out = out.slice(0, col) + `[${token}]` + out.slice(col);
	}
	return out.replace(/\s+$/, "");
}

/** A chord-only line with no lyric under it becomes an inline bracket line. */
function chordLineToInline(line: string): string {
	return line
		.trim()
		.split(/\s+/)
		.map((raw) => {
			const token = raw.replace(/^[([]+|[)\],]+$/g, "");
			return token.length > 0 && !CHORD_LINE_EXTRA_RE.test(token) && isChordSymbol(token) ? `[${token}]` : raw;
		})
		.join(" ");
}

const CCLI_SONG_RE = /CCLI\s+Song\s*#?\s*(\d+)/i;

// SongSelect / site boilerplate that should not survive into a chart. The
// copyright line itself is kept; reporting needs it.
const PASTE_CRUFT_RES = [
	/^CCLI\s+Song\s*#?\s*\d+\s*$/i,
	/^CCLI\s+Licen[cs]e\s*#?\s*\d+\s*$/i,
	/^For use solely with the SongSelect.*$/i,
	/^All rights reserved\.?\s*www\..*$/i,
	/^www\.ccli\.com\s*$/i
];

export interface PastedSong {
	/** ChordPro text, directives first. */
	text: string;
	ccli: string | null;
}

/**
 * Smart Paste: whatever a website's copy produced into ChordPro. Handles
 * text that is already ChordPro (passes through cleanup only), classic
 * chords-over-lyrics, UG-style [Verse] markers, and SongSelect headers.
 */
export function convertPastedChart(input: string): PastedSong {
	let text = input
		.replace(/\r/g, "")
		.replace(/\[\/?(?:ch|tab)\]/g, "")
		.replace(/\t/g, "    ")
		.replace(/\u00a0/g, " ");

	const ccliMatch = text.match(CCLI_SONG_RE);
	const ccli = ccliMatch ? ccliMatch[1] : null;

	const rawLines = text.split("\n").filter((line) => !PASTE_CRUFT_RES.some((re) => re.test(line.trim())));

	// Merge chords-over-lyrics pairs unless the text already carries inline
	// [Chord] tokens (then bracket merging would double up). Section markers
	// like [Bridge] must not count, so every candidate is verified as a chord.
	let hasInlineChords = false;
	const bracketRe = /\[([^[\]]+)\]/g;
	let bm: RegExpExecArray | null;
	while ((bm = bracketRe.exec(text)) !== null) {
		if (isChordSymbol(bm[1].trim())) {
			hasInlineChords = true;
			break;
		}
	}
	const lines: string[] = [];
	for (let i = 0; i < rawLines.length; i++) {
		const line = rawLines[i];
		if (!hasInlineChords && looksLikeChordLine(line)) {
			const next = i + 1 < rawLines.length ? rawLines[i + 1] : "";
			const nextTrim = next.trim();
			const nextIsLyric =
				nextTrim.length > 0 &&
				!looksLikeChordLine(next) &&
				!/^[[({]/.test(nextTrim) &&
				!/^\{[^}]*\}$/.test(nextTrim);
			if (nextIsLyric) {
				lines.push(mergeChordLine(line, next));
				i++;
			} else {
				lines.push(chordLineToInline(line));
			}
			continue;
		}
		lines.push(line);
	}

	let out = formatLyrics(lines.join("\n"));
	if (ccli && !/\{\s*ccli\s*:/i.test(out)) {
		// Slot the ccli directive after the other headers.
		const parts = out.split("\n");
		let lastHeader = -1;
		for (let i = 0; i < parts.length; i++) {
			if (/^\{(title|artist|key|time|tempo)\s*:/i.test(parts[i])) lastHeader = i;
			else if (parts[i].trim().length > 0) break;
		}
		parts.splice(lastHeader + 1, 0, `{ccli: ${ccli}}`);
		out = parts.join("\n");
	}
	return { text: out, ccli };
}
