// Guitar chord voicing lookups against @tombatossals/chords-db, plus the pure
// data mapping from a chords-db position to an svguitar diagram description.
// The db-position-to-diagram mapping follows the approach in
// olvidalo/obsidian-chord-sheets (MIT), adapted from vexchords to svguitar.
// No Obsidian imports and no DOM here; rendering happens in src/ui/diagram.ts.
import guitarJson from "@tombatossals/chords-db/lib/guitar.json";

export interface DbPosition {
	/** Fret per string, low E (string 6) first; -1 = muted, 0 = open. Values are relative to baseFret. */
	frets: number[];
	/** Finger per string, same order; 0 = none. */
	fingers: number[];
	baseFret: number;
	/** Barre frets (relative to baseFret). */
	barres: number[];
	capo?: boolean;
	midi?: number[];
}

export interface DbChord {
	key: string;
	suffix: string;
	positions: DbPosition[];
}

interface GuitarDb {
	main: { strings: number; fretsOnChord: number };
	tunings: { standard: string[] };
	keys: string[];
	suffixes: string[];
	chords: Record<string, DbChord[]>;
}

const db = guitarJson as unknown as GuitarDb;

export const NUM_STRINGS = db.main.strings;
export const NUM_FRETS = db.main.fretsOnChord;

// chords-db indexes its chords object with "Csharp"/"Fsharp" style keys and
// only stores one enharmonic spelling per pitch class.
const KEY_LOOKUP: Record<string, string> = {
	"C": "C", "B#": "C",
	"C#": "Csharp", "Db": "Csharp",
	"D": "D",
	"D#": "Eb", "Eb": "Eb",
	"E": "E", "Fb": "E",
	"F": "F", "E#": "F",
	"F#": "Fsharp", "Gb": "Fsharp",
	"G": "G",
	"G#": "Ab", "Ab": "Ab",
	"A": "A",
	"A#": "Bb", "Bb": "Bb",
	"B": "B", "Cb": "B"
};

// Bass note spellings used inside chords-db slash suffixes ("/C#", "m/D#" ...).
const SLASH_BASS_LOOKUP: Record<string, string> = {
	"C": "C", "C#": "C#", "Db": "C#",
	"D": "D", "D#": "D#", "Eb": "D#",
	"E": "E", "F": "F",
	"F#": "F#", "Gb": "F#",
	"G": "G", "G#": "G#", "Ab": "G#",
	"A": "A", "A#": "Bb", "Bb": "Bb",
	"B": "B"
};

// Written suffix -> chords-db suffix. Anything already matching a db suffix
// passes through unchanged.
const SUFFIX_ALIASES: Record<string, string> = {
	"": "major", "maj": "major", "M": "major",
	"m": "minor", "min": "minor", "-": "minor",
	"dim": "dim", "°": "dim", "o": "dim",
	"dim7": "dim7", "°7": "dim7",
	"aug": "aug", "+": "aug",
	"sus": "sus4",
	"m7": "m7", "min7": "m7", "-7": "m7",
	"M7": "maj7", "Δ": "maj7", "Δ7": "maj7",
	"m9": "m9", "min9": "m9",
	"M9": "maj9",
	"m6": "m6", "min6": "m6",
	"6/9": "69", "m6/9": "m69",
	"2": "add9", "add2": "add9",
	"madd2": "madd9",
	"7#5": "aug7",
	"ø": "m7b5", "ø7": "m7b5",
	"mM7": "mmaj7", "minmaj7": "mmaj7", "mMaj7": "mmaj7"
};

const CHORD_SYMBOL_RE = /^([A-G][#b]?)([^/\s]*)(?:\/([A-G][#b]?))?$/;

/** The root note of a chord symbol ("F#m7" -> "F#"), or null if unparseable. */
export function chordRoot(symbol: string): string | null {
	const m = symbol.trim().match(CHORD_SYMBOL_RE);
	return m ? m[1] : null;
}

// How to write a chords-db suffix back as a chord-symbol suffix. Only "major"
// and "minor" need translating; every other db suffix ("sus4", "maj7", "/F#")
// is already in written form and passes through unchanged.
const DB_SUFFIX_TO_WRITTEN: Record<string, string> = {
	major: "",
	minor: "m"
};

/**
 * Every voicing quality chords-db has for a root, as written chord symbols
 * ("D" -> ["D", "Dm", "Ddim", "Dsus2", "Dsus4", ... "D/F#", "D/A"]).
 * Each returned symbol round-trips through findChord(). Empty if the root is
 * outside the 12 pitch classes.
 */
export function chordVariations(root: string): string[] {
	const dbKey = KEY_LOOKUP[root];
	if (!dbKey) return [];
	const entries = db.chords[dbKey];
	if (!entries) return [];
	return entries.map((c) => root + (DB_SUFFIX_TO_WRITTEN[c.suffix] ?? c.suffix));
}

/** True when the bracketed token looks like a chord symbol we understand. */
export function isChordSymbol(symbol: string): boolean {
	const m = symbol.trim().match(CHORD_SYMBOL_RE);
	if (!m) return false;
	// The suffix must be plausible chord vocabulary, not a word like "Bridge".
	return /^(?:maj|min|dim|aug|sus|add|alt|[mM]|[0-9]|[#b()+°øΔ-])*$/.test(m[2]);
}

/**
 * Find the chords-db entry for a written chord symbol.
 * Slash chords try the db's slash suffixes first ("A/C#" -> key A, suffix "/C#"),
 * then fall back to the plain chord without the bass.
 */
export function findChord(symbol: string): DbChord | null {
	const m = symbol.trim().match(CHORD_SYMBOL_RE);
	if (!m) return null;
	const [, root, rawSuffix, bass] = m;

	const dbKey = KEY_LOOKUP[root];
	if (!dbKey) return null;
	const entries = db.chords[dbKey];
	if (!entries) return null;

	const suffix = SUFFIX_ALIASES[rawSuffix] ?? rawSuffix;

	if (bass) {
		const dbBass = SLASH_BASS_LOOKUP[bass];
		if (dbBass) {
			const slashSuffix = (suffix === "minor" ? "m" : suffix === "major" ? "" : suffix) + "/" + dbBass;
			const slashMatch = entries.find((c) => c.suffix === slashSuffix);
			if (slashMatch) return slashMatch;
		}
		// Fall through: show the plain chord shape without the bass.
	}

	return entries.find((c) => c.suffix === suffix) ?? null;
}

// --- svguitar mapping ---------------------------------------------------

export type DiagramFinger = [number, number | "x", string?];

export interface DiagramData {
	fingers: DiagramFinger[];
	barres: { fromString: number; toString: number; fret: number }[];
	/** Base fret (svguitar "position"). 1 = open position. */
	position: number;
	/** Number of frets the diagram needs. */
	frets: number;
	title: string;
}

/**
 * Convert a chords-db position into svguitar's shape.
 * chords-db orders strings low E first; svguitar numbers string 1 as the
 * highest string, so string number = NUM_STRINGS - index.
 */
export function positionToDiagram(symbol: string, pos: DbPosition): DiagramData {
	const barres: DiagramData["barres"] = [];
	for (const barreFret of pos.barres) {
		const strings = pos.frets
			.map((fret, i) => (fret === barreFret ? NUM_STRINGS - i : 0))
			.filter((s) => s > 0);
		if (strings.length >= 2) {
			barres.push({
				fromString: Math.max(...strings),
				toString: Math.min(...strings),
				fret: barreFret
			});
		}
	}

	const fingers: DiagramFinger[] = [];
	pos.frets.forEach((fret, i) => {
		const stringNum = NUM_STRINGS - i;
		if (fret === -1) {
			fingers.push([stringNum, "x"]);
			return;
		}
		if (fret === 0) {
			// svguitar draws open strings automatically for fret 0 fingers.
			fingers.push([stringNum, 0]);
			return;
		}
		const covered = barres.some(
			(b) => b.fret === fret && stringNum <= b.fromString && stringNum >= b.toString
		);
		if (covered) return;
		const fingerNum = pos.fingers[i];
		fingers.push(fingerNum > 0 ? [stringNum, fret, String(fingerNum)] : [stringNum, fret]);
	});

	const maxFret = Math.max(NUM_FRETS, ...pos.frets.filter((f) => f > 0), ...pos.barres);

	return { fingers, barres, position: pos.baseFret, frets: maxFret, title: symbol };
}
