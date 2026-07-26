// Run sheet parsing (v0.4.0): an order-of-service note becomes a stage-ready
// timeline. The note stays an ordinary outline; this parser reads structure
// out of it without imposing any special syntax beyond what a service order
// already looks like:
//
//   ---
//   start: 9:30 AM
//   ---
//   ## Pre-service
//   - Countdown (5 min)
//   - [[Reasons Bless The Lord.chordpro|Reasons]] in G (6 min) @Band
//   - Welcome @Chris (2 min)
//
// Durations: "(5 min)", "(5m)", "(90 sec)", "(1:30)" (m:ss). People: @Name
// tokens. Headings become dividers. Clock times accumulate from start.
// No Obsidian imports; wikilink resolution happens in the view.

export interface RunsheetItem {
	/** Line text with duration/people markup stripped, wikilinks kept. */
	text: string;
	/** Divider rows come from headings; timeline rows from list items. */
	kind: "item" | "divider";
	/** Duration in seconds, or null when the line declares none. */
	seconds: number | null;
	people: string[];
	/** Clock offset from the start in seconds (dividers inherit the next slot). */
	offsetSeconds: number;
	/** 0-based line number in the note, for mapping wikilinks back to rows. */
	line: number;
}

export interface Runsheet {
	/** Minutes-from-midnight start time from the start: property, or null. */
	startMinutes: number | null;
	/** True when the start time was written with AM/PM. */
	twelveHour: boolean;
	items: RunsheetItem[];
	totalSeconds: number;
}

const DURATION_RE = /\(\s*(?:(\d{1,2}):([0-5]\d)|(\d+(?:\.\d+)?)\s*(min|m|sec|s)?)\s*\)/i;
const PERSON_RE = /@([A-Za-z][\w'-]*(?:\s[A-Z][\w'-]*)?)/g;
const HEADING_RE = /^#{1,6}\s+(.*)$/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const START_RE = /^start\s*:\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;

function parseDuration(text: string): { seconds: number | null; rest: string } {
	const m = text.match(DURATION_RE);
	if (!m) return { seconds: null, rest: text };
	let seconds: number;
	if (m[1] !== undefined) {
		seconds = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
	} else {
		const value = parseFloat(m[3]);
		const unit = (m[4] ?? "min").toLowerCase();
		seconds = unit.startsWith("s") ? Math.round(value) : Math.round(value * 60);
	}
	return { seconds, rest: (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).trim() };
}

function parsePeople(text: string): { people: string[]; rest: string } {
	const people: string[] = [];
	const rest = text.replace(PERSON_RE, (_, name: string) => {
		people.push(name.trim());
		return "";
	});
	return { people, rest: rest.replace(/\s{2,}/g, " ").trim() };
}

/** Parse an order-of-service note (frontmatter included) into a timeline. */
export function parseRunsheet(source: string): Runsheet {
	const lines = source.split(/\r?\n/);
	const items: RunsheetItem[] = [];
	let startMinutes: number | null = null;
	let twelveHour = false;
	let offset = 0;

	// Frontmatter scan: only the start property matters here.
	let i = 0;
	if (lines[0]?.trim() === "---") {
		for (i = 1; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				i++;
				break;
			}
			const m = lines[i].match(START_RE);
			if (m) {
				let hours = parseInt(m[1], 10);
				const mins = m[2] ? parseInt(m[2], 10) : 0;
				const ampm = m[3]?.toLowerCase();
				if (ampm) {
					twelveHour = true;
					if (ampm === "pm" && hours < 12) hours += 12;
					if (ampm === "am" && hours === 12) hours = 0;
				}
				if (hours < 24 && mins < 60) startMinutes = hours * 60 + mins;
			}
		}
	}

	for (; i < lines.length; i++) {
		const heading = lines[i].match(HEADING_RE);
		if (heading) {
			items.push({
				text: heading[1].trim(),
				kind: "divider",
				seconds: null,
				people: [],
				offsetSeconds: offset,
				line: i
			});
			continue;
		}
		const list = lines[i].match(LIST_RE);
		if (!list) continue;
		const duration = parseDuration(list[1]);
		const people = parsePeople(duration.rest);
		items.push({
			text: people.rest,
			kind: "item",
			seconds: duration.seconds,
			people: people.people,
			offsetSeconds: offset,
			line: i
		});
		offset += duration.seconds ?? 0;
	}

	return { startMinutes, twelveHour, items, totalSeconds: offset };
}

/** "9:30", "10:05 AM", or "+12:30" elapsed when the sheet has no start time. */
export function formatClock(runsheet: Runsheet, offsetSeconds: number): string {
	if (runsheet.startMinutes === null) {
		const mins = Math.floor(offsetSeconds / 60);
		const secs = offsetSeconds % 60;
		return `+${mins}:${String(secs).padStart(2, "0")}`;
	}
	const total = runsheet.startMinutes + Math.floor(offsetSeconds / 60);
	let hours = Math.floor(total / 60) % 24;
	const mins = total % 60;
	let suffix = "";
	if (runsheet.twelveHour) {
		suffix = hours >= 12 ? " PM" : " AM";
		hours = hours % 12 === 0 ? 12 : hours % 12;
	}
	return `${hours}:${String(mins).padStart(2, "0")}${suffix}`;
}

/** "6:00" or "0:30" for a duration cell. */
export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Wikilinks and markdown links down to their display text. */
export function displayText(text: string): string {
	let out = text.replace(/!?\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1");
	out = out.replace(/!?\[\[([^\]|]+)\]\]/g, (_, target: string) => {
		const base = target.split("#")[0].split("/").pop() ?? target;
		return base.replace(/\.(md|chordpro|pdf)$/i, "");
	});
	out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	return out.replace(/\s{2,}/g, " ").trim();
}
