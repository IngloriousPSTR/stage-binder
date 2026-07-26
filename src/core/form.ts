// Song form ("roadmap", 2026-07-11): a declared arrangement like
// "V1 PC C V2 PC C C B C C End". The form lives in metadata: a {form: ...}
// directive, or the "form" frontmatter property (which applyFrontmatter turns
// into that directive). The note keeps ONE copy of each section's content;
// expandForm() rebuilds the chart in performance order at render time, so
// editing a chorus once updates every repeat and changing the form never
// touches section text. No Obsidian imports.
import { SECTION_DIRECTIVE_RE, STAGE_NOTE_MARK } from "./chordpro";

/** Section vocabulary shared with preprocess() in chordpro.ts. */
const SECTION_NAMES = new Set([
	"intro", "verse", "pre-chorus", "chorus", "bridge", "instrumental", "tag", "outro"
]);

// Shorthand people actually write in a form string. Unknown words stay as
// custom cue labels rather than erroring; a roadmap should accept "Ending",
// "Turnaround", "Prayer" and simply show them as cues.
const ALIASES: Record<string, string> = {
	v: "verse", vs: "verse", verse: "verse",
	pc: "pre-chorus", prechorus: "pre-chorus", "pre-chorus": "pre-chorus", pre: "pre-chorus",
	c: "chorus", ch: "chorus", chorus: "chorus",
	b: "bridge", br: "bridge", bridge: "bridge",
	i: "intro", in: "intro", intro: "intro",
	o: "outro", out: "outro", outro: "outro", e: "outro", end: "outro", ending: "outro",
	t: "tag", tag: "tag",
	inst: "instrumental", instr: "instrumental", instrumental: "instrumental", interlude: "instrumental",
	turn: "instrumental", turnaround: "instrumental"
};

export interface FormToken {
	/** Canonical section name, or null for a custom cue ("Prayer"). */
	name: string | null;
	number: string | null;
	/** What the user wrote, for custom cues. */
	raw: string;
}

export interface BodySection {
	/** Display label exactly as declared by the chart. */
	label: string;
	name: string;
	number: string | null;
	/** Content lines between this directive and the next, trimmed of blank edges. */
	content: string;
}

export const FORM_DIRECTIVE_RE = /\{\s*form\s*:\s*([^}]*)\}/i;
const COMMENT_SECTION_RE = /^\{\s*comment\s*:\s*([^}]*)\}\s*$/i;

/** The {form: ...} directive value, or null when the song declares none. */
export function detectForm(source: string): string | null {
	const m = source.match(FORM_DIRECTIVE_RE);
	if (!m) return null;
	const value = m[1].trim();
	return value.length > 0 ? value : null;
}

/** One raw form word into a token: "V2" -> verse 2, "PC" -> pre-chorus. */
export function canonicalToken(raw: string): FormToken {
	const cleaned = raw.trim().replace(/[.,;]+$/, "");
	const m = cleaned.match(/^([A-Za-z][A-Za-z-]*?)[\s-]*(\d+[a-z]?)?$/i);
	if (!m) return { name: null, number: null, raw: cleaned };
	const word = m[1].toLowerCase();
	const name = ALIASES[word] ?? (SECTION_NAMES.has(word) ? word : null);
	return { name, number: m[2] ?? null, raw: cleaned };
}

/**
 * Parse a form string into tokens. Accepts separators people use freely:
 * spaces, commas, arrows, pipes, slashes. Bare numbers attach to the
 * preceding word so "Verse 1, Chorus" and "V1 C" both work. Multi-word
 * custom cues are stored quoted ("In Christ Alone") so they survive the
 * round trip instead of splitting into three tokens.
 */
export function parseForm(form: string): FormToken[] {
	const wordRe = /"([^"]*)"|([^\s,;|/"]+)/g;
	const merged: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = wordRe.exec(form)) !== null) {
		if (m[1] !== undefined) {
			const quoted = m[1].trim();
			if (quoted.length > 0) merged.push(quoted);
			continue;
		}
		const word = m[2].replace(/^(?:->|→)+|(?:->|→)+$/g, "").trim();
		if (word.length === 0) continue;
		if (/^\d+$/.test(word) && merged.length > 0 && !/\d$/.test(merged[merged.length - 1])) {
			merged[merged.length - 1] += " " + word;
		} else {
			merged.push(word);
		}
	}
	return merged.map(canonicalToken);
}

/** Compact chip label for a token: verse 2 -> "V2", pre-chorus -> "PC". */
export function shortLabel(token: FormToken): string {
	if (!token.name) return token.raw;
	const base: Record<string, string> = {
		intro: "In", verse: "V", "pre-chorus": "PC", chorus: "C",
		bridge: "B", instrumental: "Inst", tag: "Tag", outro: "End"
	};
	return (base[token.name] ?? token.raw) + (token.number ?? "");
}

/** Full display label: verse 2 -> "Verse 2", custom cues stay as written. */
export function fullLabel(token: FormToken): string {
	if (!token.name) return token.raw;
	const pretty = token.name
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join("-");
	return token.number ? `${pretty} ${token.number}` : pretty;
}

/** Serialize tokens back into the canonical stored form string. */
export function formToString(tokens: FormToken[]): string {
	return tokens
		.map((t) => {
			const label = shortLabel(t);
			// Custom cues with spaces or separator characters must be quoted
			// or parseForm would split them into several tokens.
			return !t.name && /[\s,;|/]/.test(label) ? `"${label.replace(/"/g, "")}"` : label;
		})
		.join(" ");
}

/** All sections declared in a (directive-resolved) source, in file order. */
export function parseSections(source: string): { preamble: string[]; sections: BodySection[] } {
	const lines = source.split(/\r?\n/);
	const preamble: string[] = [];
	const sections: BodySection[] = [];
	let current: { label: string; name: string; number: string | null; lines: string[] } | null = null;

	const push = () => {
		if (!current) return;
		const content = current.lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
		sections.push({ label: current.label, name: current.name, number: current.number, content });
		current = null;
	};

	for (const line of lines) {
		if (FORM_DIRECTIVE_RE.test(line.trim()) && line.trim().startsWith("{")) continue;
		const shorthand = line.match(SECTION_DIRECTIVE_RE);
		const comment = line.match(COMMENT_SECTION_RE);
		if (shorthand) {
			push();
			const name = shorthand[1].toLowerCase();
			const number = shorthand[2] ?? null;
			const token = canonicalToken(number ? `${name} ${number}` : name);
			current = { label: fullLabel(token), name, number, lines: [] };
		} else if (comment && !comment[1].trim().startsWith(STAGE_NOTE_MARK)) {
			push();
			const label = comment[1].trim();
			const token = canonicalToken(label);
			current = {
				label,
				name: token.name ?? label.toLowerCase(),
				number: token.name ? token.number : null,
				lines: []
			};
		} else if (current) {
			current.lines.push(line);
		} else {
			preamble.push(line);
		}
	}
	push();

	while (preamble.length > 0 && preamble[preamble.length - 1].trim().length === 0) preamble.pop();
	return { preamble, sections };
}

function findSection(sections: BodySection[], token: FormToken): BodySection | null {
	if (!token.name) {
		const wanted = token.raw.trim().toLowerCase();
		return sections.find((section) => section.label.trim().toLowerCase() === wanted) ?? null;
	}
	const named = sections.filter((s) => s.name === token.name);
	if (named.length === 0) return null;
	if (token.number) {
		return named.find((s) => s.number === token.number) ?? (named.length === 1 ? named[0] : null);
	}
	return named.find((s) => s.content.length > 0) ?? named[0];
}

/**
 * Rebuild the song body in form order. Sections repeat with their full
 * content each time the form calls for them (a stage chart should never make
 * the player flip back). Tokens with no matching content render as bare
 * section directives, which preprocess() turns into recall labels; custom
 * cues become {comment: ...} lines. Sources without a form pass through
 * untouched.
 */
export function expandForm(source: string): string {
	const form = detectForm(source);
	if (!form) return source;
	const tokens = parseForm(form);
	if (tokens.length === 0) return source;

	const { preamble, sections } = parseSections(source);
	const out: string[] = [...preamble];
	if (out.length > 0) out.push("");

	for (const token of tokens) {
		const section = findSection(sections, token);
		if (!section && !token.name) {
			out.push(`{comment: ${token.raw}}`);
			out.push("");
			continue;
		}
		const label = section?.label ?? fullLabel(token);
		const directive = `{comment: ${label}}`;
		out.push(directive);
		if (section && section.content.length > 0) out.push(section.content);
		out.push("");
	}

	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out.join("\n") + "\n";
}
