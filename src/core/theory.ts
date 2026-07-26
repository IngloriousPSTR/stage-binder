// Core music theory helpers. No Obsidian imports; keep it liftable into a
// standalone app (BRIEF.md section 9).
import { Chord, Key } from "tonal";

export type Mode = "major" | "minor";

export interface DiatonicChord {
	/** Roman numeral with quality: I, ii, vii° ... */
	numeral: string;
	/** Chord symbol as written into the file, e.g. "F#m", "Bdim" */
	symbol: string;
	/** Note spellings that make up the chord, e.g. ["C", "E", "G"] */
	notes: string[];
}

export interface KeyOption {
	id: string;
	label: string;
	tonic: string;
	mode: Mode;
}

// Conventional tonic spellings for the 12 major and 12 minor keys.
const MAJOR_TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_TONICS = ["A", "Bb", "B", "C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#"];

export const KEY_OPTIONS: KeyOption[] = [
	...MAJOR_TONICS.map((t): KeyOption => ({ id: `${t}-major`, label: t, tonic: t, mode: "major" })),
	...MINOR_TONICS.map((t): KeyOption => ({ id: `${t}-minor`, label: `${t} minor`, tonic: t, mode: "minor" }))
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * Diatonic triads of a key with Roman numerals and note spellings.
 * Uses Tonal so spellings are correct in every key (no hardcoded tables).
 * Minor keys use the natural minor scale degrees (BRIEF.md 5a).
 */
export function diatonicChords(tonic: string, mode: Mode): DiatonicChord[] {
	const triads = mode === "major"
		? Key.majorKey(tonic).triads
		: Key.minorKey(tonic).natural.triads;

	return triads.map((symbol, i) => {
		const chord = Chord.get(symbol);
		let numeral = ROMAN[i];
		if (chord.type === "diminished") {
			numeral = numeral.toLowerCase() + "°";
		} else if (chord.type === "minor") {
			numeral = numeral.toLowerCase();
		}
		return { numeral, symbol, notes: chord.notes };
	});
}

/** Note spellings for any chord symbol, e.g. "F#m7" -> F#, A, C#, E. */
export function chordNotes(symbol: string): string[] {
	return Chord.get(symbol).notes;
}

/** Human description like "C major" or "F# minor" for a chord symbol. */
export function describeChord(symbol: string): string {
	const chord = Chord.get(symbol);
	if (!chord.tonic) return symbol;
	return chord.type ? `${chord.tonic} ${chord.type}` : chord.tonic;
}
