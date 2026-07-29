// Parse, render, and transpose the ChordPro dialect used by the plugin.
//
// The user's files use nonstandard section directives like {verse 1} and
// {chorus}. ChordSheetJS does not know those, so before parsing we rewrite
// them into standard ChordPro environments:
//   {verse 1} ... -> {start_of_verse: Verse 1} ... {end_of_verse}
//   {chorus} with content -> {start_of_chorus: Chorus} ... {end_of_chorus}
//   {chorus} with no content (a recall of an earlier chorus) -> {comment: Chorus}
//   {intro} / {pre-chorus} / {instrumental} / {tag} / {outro} -> {comment: Label}
// The source file is never rewritten this way; the mapping only feeds the
// renderer.
//
// Transposition works on the raw source text with a small deterministic
// pitch-class table instead of ChordSheetJS's transpose. That keeps "what you
// see in the preview" and "what Write transpose to file writes" byte-identical.
import { ChordProParser, HtmlDivFormatter, Song } from "chordsheetjs";
import { isChordSymbol } from "./chords";
import { transposeChordSymbol, transposeNote, useFlatsForKey, type KeySpec } from "./music";

export {
	type AccidentalsPref,
	type KeySpec,
	NOTE_CHROMA,
	semitonesBetween,
	setAccidentalsPref,
	transposeKeyName
} from "./music";

export const SECTION_LABELS = [
	"Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge",
	"Instrumental", "Interlude", "Tag", "Outro", "Ending"
] as const;

export const SECTION_DIRECTIVE_RE = /^\{\s*(intro|verse|pre-chorus|chorus|bridge|instrumental|interlude|tag|outro|ending)(?:\s+(\d+))?\s*\}\s*$/i;

// Form, autoscroll, and audio directives are metadata, never chart content.
const META_DIRECTIVE_LINE_RE = /^\{\s*(?:form|autoscroll|audio)\s*:\s*[^}]*\}\s*$/i;

// Stage notes (roadmap 2026-07-14): {note: watch the ritard} renders as a dim
// italic cue. Preprocess rewrites it into a marked comment; setChartHtml then
// turns marked comments into .sb-stage-note elements. The marker never
// reaches the screen.
const NOTE_DIRECTIVE_LINE_RE = /^\{\s*note\s*:\s*([^}]*)\}\s*$/i;
export const STAGE_NOTE_MARK = "⚑sb-note⚑ ";

// Only these get a real ChordSheetJS environment (they gain semantic CSS
// classes); the rest render as labeled comments.
const ENV_SECTIONS: Record<string, string> = {
	verse: "verse",
	chorus: "chorus",
	bridge: "bridge"
};

function sectionLabel(name: string, num: string | undefined): string {
	// Capitalize hyphen- and space-separated words: "pre-chorus" -> "Pre-Chorus",
	// "prayer station" -> "Prayer Station".
	const pretty = name
		.split("-")
		.map((part) =>
			part
				.split(" ")
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ")
		)
		.join("-");
	return num ? `${pretty} ${num}` : pretty;
}

/** Rewrite shorthand section directives into standard ChordPro. */
export function preprocess(source: string): string {
	const lines = source.split(/\r?\n/);
	const out: string[] = [];
	let openEnv: string | null = null;

	const closeEnv = () => {
		if (openEnv) {
			out.push(`{end_of_${openEnv}}`);
			openEnv = null;
		}
	};

	for (let i = 0; i < lines.length; i++) {
		if (META_DIRECTIVE_LINE_RE.test(lines[i])) continue;
		const note = lines[i].match(NOTE_DIRECTIVE_LINE_RE);
		if (note) {
			// Inside an open verse/chorus/bridge the cue stays in that section;
			// the environment is deliberately not closed.
			out.push(`{comment: ${STAGE_NOTE_MARK}${note[1].trim()}}`);
			continue;
		}
		const m = lines[i].match(SECTION_DIRECTIVE_RE);
		if (!m) {
			out.push(lines[i]);
			continue;
		}

		closeEnv();
		const name = m[1].toLowerCase();
		const label = sectionLabel(name, m[2]);

		// Look ahead: does this section have content before the next section
		// directive? A bare {chorus} with none is a recall marker.
		let hasContent = false;
		for (let j = i + 1; j < lines.length; j++) {
			if (SECTION_DIRECTIVE_RE.test(lines[j])) break;
			if (lines[j].trim().length > 0) {
				hasContent = true;
				break;
			}
		}

		const env = ENV_SECTIONS[name];
		if (env && hasContent) {
			out.push(`{start_of_${env}: ${label}}`);
			openEnv = env;
		} else {
			out.push(`{comment: ${label}}`);
		}
	}
	closeEnv();
	return out.join("\n");
}

export interface ChartMeta {
	title: string | null;
	artist: string | null;
	key: string | null;
	time: string | null;
	tempo: string | null;
}

export interface Chart {
	html: string;
	meta: ChartMeta;
}

function metaValue(song: Song, name: string): string | null {
	const value = song.metadata.getSingle(name);
	return value ?? null;
}

/** Render ChordPro source to chords-over-lyrics HTML, transposed for display. */
export function renderChart(source: string, semitones = 0): Chart {
	const displaySource = semitones === 0 ? source : transposeSource(source, semitones);
	const song = new ChordProParser().parse(preprocess(displaySource));
	const html = new HtmlDivFormatter().format(song);
	return {
		html,
		meta: {
			title: metaValue(song, "title"),
			artist: metaValue(song, "artist"),
			key: metaValue(song, "key"),
			time: metaValue(song, "time"),
			tempo: metaValue(song, "tempo")
		}
	};
}

// --- transpose ------------------------------------------------------------

const KEY_DIRECTIVE_RE = /^(\{\s*key\s*:\s*)([A-G][#b]?)(m?)(\s*\}\s*)$/im;

/** Read the {key: X} directive; returns e.g. { tonic: "F#", minor: true }. */
export function detectKey(source: string): { tonic: string; minor: boolean } | null {
	const m = source.match(KEY_DIRECTIVE_RE);
	if (!m) return null;
	return { tonic: m[2], minor: m[3].toLowerCase() === "m" };
}

/**
 * Transpose the raw ChordPro text: every [Chord] token plus the {key: X}
 * directive. Everything else, including whitespace, is preserved verbatim.
 * keyHint supplies the key for spelling decisions when the source has no
 * {key:} directive (e.g. .md songs that keep the key in frontmatter).
 */
export function transposeSource(source: string, semitones: number, keyHint?: KeySpec): string {
	if (semitones === 0) return source;
	const useFlats = useFlatsForKey(detectKey(source) ?? keyHint, semitones);

	const transposed = source.replace(/\[([^[\]]+)\]/g, (whole, token: string) => {
		if (!isChordSymbol(token)) return whole;
		return "[" + transposeChordSymbol(token.trim(), semitones, useFlats) + "]";
	});

	return transposed.replace(KEY_DIRECTIVE_RE, (whole, open: string, tonic: string, minor: string, close: string) => {
		return open + transposeNote(tonic, semitones, useFlats) + minor + close;
	});
}

// --- song inspection --------------------------------------------------------

const CAPO_DIRECTIVE_RE = /\{\s*capo\s*:\s*(\d{1,2})\s*\}/i;

/** The {capo: N} directive value, or 0 when the song has none. */
export function detectCapo(source: string): number {
	const m = source.match(CAPO_DIRECTIVE_RE);
	return m ? parseInt(m[1], 10) : 0;
}

const AUTOSCROLL_DIRECTIVE_RE = /\{\s*autoscroll\s*:\s*(\d{1,3})\s*\}/i;

/**
 * The song's own autoscroll speed in px/s from {autoscroll: N} (or the
 * autoscroll frontmatter property, which applyFrontmatter turns into that
 * directive), or null to use the global setting. Slow ballads and fast songs
 * each scroll right without touching the shared speed.
 */
export function detectAutoscroll(source: string): number | null {
	const m = source.match(AUTOSCROLL_DIRECTIVE_RE);
	if (!m) return null;
	const speed = parseInt(m[1], 10);
	return speed > 0 ? Math.min(300, speed) : null;
}

const AUDIO_DIRECTIVE_RE = /\{\s*audio\s*:\s*([^}]+)\}/i;

/**
 * The song's reference audio from {audio: ...} (or the audio frontmatter
 * property, which applyFrontmatter turns into that directive): a streaming
 * URL or a vault file path/wikilink, or null.
 */
export function detectAudio(source: string): string | null {
	const m = source.match(AUDIO_DIRECTIVE_RE);
	const value = m ? m[1].trim() : "";
	return value.length > 0 ? value : null;
}

/** Unique chord symbols in the order they first appear in the song. */
export function usedChords(source: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const re = /\[([^[\]]+)\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(source)) !== null) {
		const symbol = m[1].trim();
		if (!isChordSymbol(symbol) || seen.has(symbol)) continue;
		seen.add(symbol);
		out.push(symbol);
	}
	return out;
}
