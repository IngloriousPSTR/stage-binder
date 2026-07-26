// Frontmatter as song metadata (roadmap 2026-07-09): YAML properties are the
// canonical metadata for .md songs and get translated into ChordPro
// directives when a chart renders or exports. No Obsidian imports; the tiny
// YAML subset parser here covers the flat "key: value" lines song notes use.
// (Inside Obsidian the host app's metadata cache can supply the same object;
// this parser keeps core usable standalone and in tests.)

/** Song metadata keys, in the order directives should be emitted. note is
 * last so a frontmatter stage note renders below the title block. */
export const SONG_META_KEYS = [
	"title",
	"artist",
	"key",
	"capo",
	"time",
	"tempo",
	"ccli",
	"audio",
	"form",
	"autoscroll",
	"note"
] as const;

export interface SplitSong {
	/** Flat frontmatter properties (lowercased keys, quoted values unwrapped). */
	meta: Record<string, string>;
	/** Source with the frontmatter block removed. */
	body: string;
	hadFrontmatter: boolean;
}

/**
 * Serialize a string as a YAML scalar safe to write after "key: ". Values
 * that could change meaning (a colon, #, quote, bracket/brace, a leading YAML
 * indicator, edge whitespace, or a bare keyword like true/null) are emitted as
 * a JSON double-quoted string, which is valid YAML and round-trips through
 * splitFrontmatter; everything else passes through bare. Titles like "God: Our
 * Refuge" or 'O Come, "All Ye Faithful"' stay valid frontmatter.
 */
export function yamlValue(v: string): string {
	const needsQuote =
		v.length === 0 ||
		v !== v.trim() ||
		/[:#'"[\]{}]/.test(v) ||
		/^[-?&*!|>%@`]/.test(v) ||
		/^(?:true|false|yes|no|on|off|null|~)$/i.test(v);
	return needsQuote ? JSON.stringify(v) : v;
}

const FRONTMATTER_OPEN_RE = /^---[ \t]*\r?\n/;

/** Split a leading YAML frontmatter block off a song source. */
export function splitFrontmatter(source: string): SplitSong {
	const open = source.match(FRONTMATTER_OPEN_RE);
	if (!open) return { meta: {}, body: source, hadFrontmatter: false };

	const rest = source.slice(open[0].length);
	const close = rest.match(/^---[ \t]*(?:\r?\n|$)/m);
	if (!close || close.index === undefined) {
		return { meta: {}, body: source, hadFrontmatter: false };
	}

	const block = rest.slice(0, close.index);
	const body = rest.slice(close.index + close[0].length);

	const meta: Record<string, string> = {};
	for (const line of block.split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
		if (!m) continue;
		let value = m[2].trim();
		if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
			// Double-quoted: JSON decodes the escapes yamlValue may have added
			// ("O Come, \"All Ye Faithful\""); fall back to a bare strip if the
			// value is not valid JSON.
			try {
				value = JSON.parse(value) as string;
			} catch {
				value = value.slice(1, -1);
			}
		} else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
			// YAML single-quote: '' is a literal '.
			value = value.slice(1, -1).replace(/''/g, "'");
		}
		if (value.length > 0) meta[m[1].toLowerCase()] = value;
	}
	return { meta, body, hadFrontmatter: true };
}

/** True when the body already declares this directive ("{key: ...}"). */
function hasDirective(body: string, name: string): boolean {
	return new RegExp("\\{\\s*" + name + "\\s*:", "i").test(body);
}

/**
 * Translate a metadata object (frontmatter properties) into ChordPro
 * directive lines, skipping keys the body already declares and anything
 * outside the song vocabulary.
 */
export function metaToDirectives(meta: Record<string, unknown>, body: string): string[] {
	const out: string[] = [];
	for (const key of SONG_META_KEYS) {
		const raw = meta[key];
		if (raw === undefined || raw === null) continue;
		const value = typeof raw === "string"
			? raw.trim()
			: typeof raw === "number" || typeof raw === "boolean"
				? String(raw)
				: Array.isArray(raw)
					? raw.filter((item): item is string | number | boolean =>
						typeof item === "string" || typeof item === "number" || typeof item === "boolean")
						.join(", ")
						.trim()
					: "";
		if (value.length === 0 || hasDirective(body, key)) continue;
		out.push(`{${key}: ${value}}`);
	}
	return out;
}

/**
 * Resolve a raw .md/.chordpro source into ChordPro-ready text: strip the
 * frontmatter block and prepend its song properties as directives.
 * Sources without frontmatter pass through untouched.
 */
export function applyFrontmatter(source: string): string {
	const { meta, body, hadFrontmatter } = splitFrontmatter(source);
	if (!hadFrontmatter) return source;
	const directives = metaToDirectives(meta, body);
	if (directives.length === 0) return body;
	const trimmedBody = body.replace(/^\s*\n/, "");
	return directives.join("\n") + "\n\n" + trimmedBody;
}

const CHORDPRO_FENCE_RE = /^[ \t]*(```+|~~~+)[ \t]*chordpro[ \t]*$([\s\S]*?)^[ \t]*\1[ \t]*$/gim;

/**
 * The contents of all ```chordpro fenced blocks in a markdown note, joined,
 * or null when the note has none (then the whole body is the song).
 */
export function extractChordproBlocks(markdown: string): string | null {
	const blocks: string[] = [];
	let m: RegExpExecArray | null;
	CHORDPRO_FENCE_RE.lastIndex = 0;
	while ((m = CHORDPRO_FENCE_RE.exec(markdown)) !== null) {
		blocks.push(m[2].replace(/^\r?\n/, "").replace(/\s+$/, ""));
	}
	return blocks.length > 0 ? blocks.join("\n\n") : null;
}
