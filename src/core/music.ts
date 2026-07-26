// Dependency-free pitch and chord math. Keep ChordPro parsing and
// chord-database lookups out of this module so it remains easy to test.

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const NOTE_CHROMA: Record<string, number> = {
	"Cb": 11, "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4,
	"E#": 5, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10,
	"Bb": 10, "B": 11, "B#": 0
};

// Major: Db, Eb, F, Ab, Bb. Minor: Cm, Dm, Ebm, Fm, Gm, Bbm.
const FLAT_MAJOR_CHROMA = new Set([1, 3, 5, 8, 10]);
const FLAT_MINOR_CHROMA = new Set([0, 2, 3, 5, 7, 10]);

export interface KeySpec {
	tonic: string;
	minor: boolean;
}

export type AccidentalsPref = "auto" | "sharps" | "flats";
let accidentalsPref: AccidentalsPref = "auto";

export function setAccidentalsPref(pref: AccidentalsPref): void {
	accidentalsPref = pref;
}

function preferFlats(fallback: boolean): boolean {
	if (accidentalsPref === "flats") return true;
	if (accidentalsPref === "sharps") return false;
	return fallback;
}

export function useFlatsForKey(key: KeySpec | null | undefined, semitones: number): boolean {
	if (!key) return preferFlats(false);
	const chroma = NOTE_CHROMA[key.tonic];
	if (chroma === undefined) return preferFlats(false);
	const next = ((chroma + semitones) % 12 + 12) % 12;
	return preferFlats(key.minor ? FLAT_MINOR_CHROMA.has(next) : FLAT_MAJOR_CHROMA.has(next));
}

export function transposeNote(note: string, semitones: number, useFlats: boolean): string {
	const chroma = NOTE_CHROMA[note];
	if (chroma === undefined) return note;
	const next = ((chroma + semitones) % 12 + 12) % 12;
	return useFlats ? FLAT_NAMES[next] : SHARP_NAMES[next];
}

export function transposeChordSymbol(symbol: string, semitones: number, useFlats: boolean): string {
	const m = symbol.match(/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/);
	if (!m) return symbol;
	const [, root, suffix, bass] = m;
	const newRoot = transposeNote(root, semitones, useFlats);
	const newBass = bass ? "/" + transposeNote(bass, semitones, useFlats) : "";
	return newRoot + suffix + newBass;
}

/** Transpose one chord using the target key's conventional spelling. */
export function transposeChord(symbol: string, semitones: number, key?: KeySpec | null): string {
	if (semitones === 0) return symbol;
	return transposeChordSymbol(symbol, semitones, useFlatsForKey(key, semitones));
}

export function transposeKeyName(tonic: string, minor: boolean, semitones: number): string {
	const chroma = NOTE_CHROMA[tonic];
	if (chroma === undefined) return tonic;
	const next = ((chroma + semitones) % 12 + 12) % 12;
	const useFlats = useFlatsForKey({ tonic, minor }, semitones);
	return (useFlats ? FLAT_NAMES : SHARP_NAMES)[next] + (minor ? "m" : "");
}

export function semitonesBetween(fromTonic: string, toTonic: string): number {
	const from = NOTE_CHROMA[fromTonic];
	const to = NOTE_CHROMA[toTonic];
	if (from === undefined || to === undefined) return 0;
	let delta = ((to - from) % 12 + 12) % 12;
	if (delta > 6) delta -= 12;
	return delta;
}

const DEGREE_LABELS = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];
const CHORD_TOKEN_RE = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;

function degreeLabel(note: string, keyChroma: number): string | null {
	const chroma = NOTE_CHROMA[note];
	if (chroma === undefined) return null;
	return DEGREE_LABELS[((chroma - keyChroma) % 12 + 12) % 12];
}

export function chordToNashville(symbol: string, keyTonic: string): string {
	const keyChroma = NOTE_CHROMA[keyTonic];
	if (keyChroma === undefined) return symbol;
	const m = symbol.trim().match(CHORD_TOKEN_RE);
	if (!m) return symbol;
	const [, root, suffix, bass] = m;
	const degree = degreeLabel(root, keyChroma);
	if (!degree) return symbol;
	const bassDegree = bass ? degreeLabel(bass, keyChroma) : null;
	return degree + suffix + (bassDegree ? "/" + bassDegree : "");
}
