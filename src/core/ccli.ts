// CCLI usage reporting (v0.7.1). Churches with a CCLI Copyright License must
// report which songs they used and how often. This turns the vault's own data
// (songs carry a ccli/title/artist; service notes link songs and carry a date)
// into that report with no new required metadata: dated setlists ARE the log.
// No Obsidian imports; the vault plumbing lives in the plugin.
import { detectKey, usedChords } from "./chordpro";

/** One song as used in one service. */
export interface SongUsage {
	title: string;
	ccli: string | null;
	artist: string | null;
}

/** One dated service and the songs it used. */
export interface ServiceUsage {
	/** ISO YYYY-MM-DD. */
	date: string;
	/** Note name, for the report's per-date detail. */
	label: string;
	songs: SongUsage[];
}

/** One song aggregated across the reporting period. */
export interface CcliRow {
	title: string;
	ccli: string | null;
	artist: string | null;
	count: number;
	/** Service dates the song appeared on, ascending. */
	dates: string[];
}

export interface CcliReport {
	from: string;
	to: string;
	serviceCount: number;
	rows: CcliRow[];
	/** Rows with no CCLI number, so the report can prompt to fill them in. */
	missing: CcliRow[];
}

const DIRECTIVE = (name: string) => new RegExp(`\\{\\s*${name}\\s*:\\s*([^}]*)\\}`, "i");
const TITLE_RE = DIRECTIVE("title");
const ARTIST_RE = DIRECTIVE("artist");
const CCLI_RE = DIRECTIVE("ccli");

function directiveValue(source: string, re: RegExp): string | null {
	const m = source.match(re);
	const value = m ? m[1].trim() : "";
	return value.length > 0 ? value : null;
}

/**
 * Whether a linked note is actually a song, so the report never counts a
 * linked setlist, contact, or liturgy note as one. A .chordpro file always
 * qualifies; a .md needs chords, a key, or a CCLI number. Keeps CCLI counts
 * honest even when a dated print note links its setlist.
 */
export function isLikelySong(resolved: string, extension: string): boolean {
	if (extension.toLowerCase() === "chordpro") return true;
	return usedChords(resolved).length > 0 || detectKey(resolved) !== null || CCLI_RE.test(resolved);
}

/**
 * Song identity from resolved ChordPro text (frontmatter already folded into
 * directives). Falls back to the note's basename for the title.
 */
export function songMetaFromText(resolved: string, fallbackTitle: string): SongUsage {
	return {
		title: directiveValue(resolved, TITLE_RE) ?? fallbackTitle,
		ccli: directiveValue(resolved, CCLI_RE),
		artist: directiveValue(resolved, ARTIST_RE)
	};
}

const ISO_RE = /(\d{4})[-._/](\d{1,2})[-._/](\d{1,2})/;

/**
 * A service's date as ISO YYYY-MM-DD, from a frontmatter date property first
 * (an Obsidian date property arrives as a string), then a date embedded in the
 * note name (2026-07-13, 2026.07.13, 2026_07_13), or null when neither exists.
 */
export function parseServiceDate(frontmatterDate: string | undefined, basename: string): string | null {
	for (const candidate of [frontmatterDate ?? "", basename]) {
		const m = candidate.match(ISO_RE);
		if (!m) continue;
		const year = m[1];
		const month = parseInt(m[2], 10);
		const day = parseInt(m[3], 10);
		if (month < 1 || month > 12 || day < 1 || day > 31) continue;
		return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	}
	return null;
}

/** Aggregation key: the CCLI number when present, else the normalized title. */
function rowKey(song: SongUsage): string {
	if (song.ccli) return "ccli:" + song.ccli.replace(/\s+/g, "");
	return "title:" + song.title.trim().toLowerCase();
}

/**
 * Aggregate dated services into a CCLI usage report over [from, to] inclusive
 * (both ISO YYYY-MM-DD; lexical comparison is correct for that format). A song
 * used twice in one service counts once for that date.
 */
export function buildCcliReport(services: ServiceUsage[], from: string, to: string): CcliReport {
	const inRange = services.filter((s) => s.date >= from && s.date <= to);
	const byKey = new Map<string, CcliRow>();

	for (const service of inRange) {
		const seen = new Set<string>();
		for (const song of service.songs) {
			const key = rowKey(song);
			if (seen.has(key)) continue;
			seen.add(key);
			let row = byKey.get(key);
			if (!row) {
				row = { title: song.title, ccli: song.ccli, artist: song.artist, count: 0, dates: [] };
				byKey.set(key, row);
			}
			// Keep the fullest metadata seen for this song across services.
			if (!row.artist && song.artist) row.artist = song.artist;
			if (!row.ccli && song.ccli) row.ccli = song.ccli;
			row.count += 1;
			row.dates.push(service.date);
		}
	}

	const rows = [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title));
	for (const row of rows) row.dates.sort();

	return {
		from,
		to,
		serviceCount: inRange.length,
		rows,
		missing: rows.filter((r) => !r.ccli)
	};
}
