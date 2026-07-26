// Core logic tests. Run with: npm test
// (scripts/run-tests.mjs bundles this file with esbuild and runs it under
// node:test; no Obsidian required because src/core has no Obsidian imports.)
import { test } from "node:test";
import assert from "node:assert/strict";

import { diatonicChords, KEY_OPTIONS } from "../src/core/theory";
import { findChord, isChordSymbol, positionToDiagram } from "../src/core/chords";
import { formatLyrics } from "../src/core/formatter";
import { preprocess, renderChart, transposeSource, detectKey, SECTION_DIRECTIVE_RE } from "../src/core/chordpro";
import { transposeChord } from "../src/core/music";

// --- theory ---------------------------------------------------------------

test("C major diatonic chords with numerals", () => {
	const chords = diatonicChords("C", "major");
	assert.deepEqual(chords.map((c) => c.symbol), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
	assert.deepEqual(chords.map((c) => c.numeral), ["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
	assert.deepEqual(chords[0].notes, ["C", "E", "G"]);
});

test("A natural minor diatonic chords", () => {
	const chords = diatonicChords("A", "minor");
	assert.deepEqual(chords.map((c) => c.symbol), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
	assert.deepEqual(chords.map((c) => c.numeral), ["i", "ii°", "III", "iv", "v", "VI", "VII"]);
});

test("F# major spells sharps correctly", () => {
	const chords = diatonicChords("F#", "major");
	assert.equal(chords[0].symbol, "F#");
	assert.deepEqual(chords[0].notes, ["F#", "A#", "C#"]);
});

test("24 key options", () => {
	assert.equal(KEY_OPTIONS.length, 24);
});

// --- chords-db lookup -------------------------------------------------------

test("finds common chords in chords-db", () => {
	for (const symbol of ["C", "F#m", "Bb", "Dsus4", "Em7", "A/C#", "Bdim"]) {
		const chord = findChord(symbol);
		assert.ok(chord, `expected db entry for ${symbol}`);
		assert.ok(chord.positions.length >= 2, `expected at least two voicings for ${symbol}`);
	}
});

test("isChordSymbol accepts chords and rejects words", () => {
	for (const good of ["A", "F#m", "Bb7", "Dsus4", "A/C#", "Cmaj7", "Em"]) {
		assert.ok(isChordSymbol(good), `${good} should be a chord`);
	}
	for (const bad of ["Chorus", "Produced by X", "Verse 1", "Hello"]) {
		assert.ok(!isChordSymbol(bad), `${bad} should not be a chord`);
	}
});

test("positionToDiagram maps F#m barre chord", () => {
	const chord = findChord("F#m");
	assert.ok(chord);
	const diagram = positionToDiagram("F#m", chord.positions[0]);
	// F#m at fret 2: barre across all six strings.
	assert.equal(diagram.barres.length, 1);
	assert.equal(diagram.barres[0].fret, 2);
	assert.equal(diagram.barres[0].fromString, 6);
	assert.equal(diagram.barres[0].toString, 1);
	// Barred strings are not duplicated as fingers.
	assert.ok(diagram.fingers.every(([, fret]) => fret !== 2));
});

test("positionToDiagram maps open C major", () => {
	const chord = findChord("C");
	assert.ok(chord);
	const diagram = positionToDiagram("C", chord.positions[0]);
	assert.equal(diagram.position, 1);
	// Low E muted, high E open.
	assert.deepEqual(diagram.fingers.find(([s]) => s === 6)?.[1], "x");
	assert.deepEqual(diagram.fingers.find(([s]) => s === 1)?.[1], 0);
});

// --- formatter --------------------------------------------------------------

const PUBLIC_DOMAIN_PASTE = `Amazing Grace
1 Contributor

[Intro]

[Verse 1]
Amazing grace, how sweet the sound
That saved a wretch like me

[Chorus]
Amazing grace
I once was lost, but now am found

[Produced by Someone]
You might also like
Embed`;

test("formatLyrics produces a clean ChordPro skeleton", () => {
	const result = formatLyrics(PUBLIC_DOMAIN_PASTE);
	assert.equal(result, `{title: Amazing Grace}

{comment: Intro}

{comment: Verse 1}
Amazing grace, how sweet the sound
That saved a wretch like me

{comment: Chorus}
Amazing grace
I once was lost, but now am found
`);
});

test("formatLyrics maps header lines and plain section names", () => {
	const input = `Title: My Song
Artist: Somebody
Key: A

Verse 1:
First line here

CHORUS
Chorus line here

Pre-Chorus:
Lift line`;
	const result = formatLyrics(input);
	assert.match(result, /^\{title: My Song\}\n\{artist: Somebody\}\n\{key: A\}\n/);
	assert.match(result, /\{comment: Verse 1\}\nFirst line here/);
	assert.match(result, /\{comment: Chorus\}\nChorus line here/);
	assert.match(result, /\{comment: Pre-Chorus\}\nLift line/);
});

test("formatLyrics leaves ambiguous lines alone", () => {
	const input = "Some lyric line\nAnother lyric that mentions the chorus here\n";
	const result = formatLyrics(input);
	assert.match(result, /Some lyric line\nAnother lyric that mentions the chorus here/);
});

// --- chordpro render / transpose ---------------------------------------------

const FIXTURE = `{title: Aura Lea}
{artist: W. W. Fosdick and George R. Poulton}
{key: A}
{time: 4/4}
{tempo: 76}

{intro}
[A] [F#m]

{verse 1}
[A]When the blackbird in the Spring, on the willow tree
Sat and [D]rocked, I heard him sing, singing Aura Lea

{chorus}
Aura [D]Lea, Aura [A]Lea
Maid of [Bm]golden [E]hair

{chorus}
`;

test("preprocess maps sections to standard ChordPro", () => {
	const result = preprocess(FIXTURE);
	assert.match(result, /\{comment: Intro\}/);
	assert.match(result, /\{start_of_verse: Verse 1\}/);
	assert.match(result, /\{end_of_verse\}/);
	assert.match(result, /\{start_of_chorus: Chorus\}/);
	assert.match(result, /\{end_of_chorus\}/);
	// The trailing bare {chorus} recall becomes a comment, not an empty env.
	const recalls = result.match(/\{comment: Chorus\}/g);
	assert.equal(recalls?.length, 1);
});

test("renderChart produces chords-over-lyrics HTML with meta", () => {
	const chart = renderChart(FIXTURE);
	assert.match(chart.html, /class="title"/);
	assert.match(chart.html, /class="label"/);
	assert.match(chart.html, /class="chord"/);
	assert.match(chart.html, /F#m/);
	assert.equal(chart.meta.key, "A");
	assert.equal(chart.meta.artist, "W. W. Fosdick and George R. Poulton");
	assert.equal(chart.meta.tempo, "76");
});

test("transposeSource +2 from A goes to B with sharp spellings", () => {
	const result = transposeSource(FIXTURE, 2);
	assert.match(result, /\{key: B\}/);
	assert.match(result, /\[B\]When the blackbird/);
	assert.match(result, /\[G#m\]/);
	assert.match(result, /\[C#m\]golden \[F#\]hair/);
	// Lyrics untouched.
	assert.match(result, /on the willow tree/);
});

test("transposeSource +1 from A prefers flats for Bb", () => {
	const result = transposeSource(FIXTURE, 1);
	assert.match(result, /\{key: Bb\}/);
	assert.match(result, /\[Bb\]When the blackbird/);
	assert.match(result, /\[Gm\]/);
	assert.match(result, /\[Eb\]rocked/);
});

test("transposeSource -12/+12 round trip is identity", () => {
	assert.equal(transposeSource(transposeSource(FIXTURE, 5), -5), FIXTURE);
	assert.equal(transposeSource(FIXTURE, 0), FIXTURE);
});

test("detectKey reads the key directive", () => {
	assert.deepEqual(detectKey(FIXTURE), { tonic: "A", minor: false });
	assert.deepEqual(detectKey("{key: F#m}"), { tonic: "F#", minor: true });
	assert.equal(detectKey("no key here"), null);
});

test("renderChart transposes the displayed chords", () => {
	const chart = renderChart(FIXTURE, 2);
	assert.match(chart.html, /G#m/);
	assert.equal(chart.meta.key, "B");
});

// --- frontmatter metadata (roadmap 2026-07-09) ------------------------------

import { splitFrontmatter, applyFrontmatter, metaToDirectives, extractChordproBlocks } from "../src/core/frontmatter";
import { detectCapo, usedChords, semitonesBetween, transposeKeyName } from "../src/core/chordpro";
import { chordToNashville, toNashvilleSource } from "../src/core/nashville";

test("splitFrontmatter parses flat YAML properties", () => {
	const src = "---\ntitle: My Song\nkey: F#m\ncapo: 2\nartist: \"Some One\"\n---\n\n{verse 1}\n[A]La\n";
	const { meta, body, hadFrontmatter } = splitFrontmatter(src);
	assert.ok(hadFrontmatter);
	assert.equal(meta.title, "My Song");
	assert.equal(meta.key, "F#m");
	assert.equal(meta.capo, "2");
	assert.equal(meta.artist, "Some One");
	assert.ok(body.includes("{verse 1}"));
	assert.ok(!body.includes("---"));
});

test("splitFrontmatter passes through sources without frontmatter", () => {
	const src = "{title: X}\n[A]La\n";
	const { body, hadFrontmatter } = splitFrontmatter(src);
	assert.equal(hadFrontmatter, false);
	assert.equal(body, src);
});

test("applyFrontmatter turns properties into directives, skipping duplicates", () => {
	const src = "---\ntitle: My Song\nkey: A\ntempo: 76\n---\n{title: Override}\n\n{verse 1}\n[A]La\n";
	const out = applyFrontmatter(src);
	// body already has {title:}, so only key and tempo are added
	assert.ok(!out.includes("{title: My Song}"));
	assert.ok(out.includes("{key: A}"));
	assert.ok(out.includes("{tempo: 76}"));
	assert.ok(out.indexOf("{key: A}") < out.indexOf("{title: Override}"));
});

test("metaToDirectives ignores unknown keys and empty values", () => {
	const out = metaToDirectives({ key: "G", capo: 3, aliases: "x", artist: "" }, "");
	assert.deepEqual(out, ["{key: G}", "{capo: 3}"]);
});

test("extractChordproBlocks pulls fenced blocks", () => {
	const md = "# Note\n\n```chordpro\n{key: G}\n[G]Hi\n```\n\ntext\n";
	assert.equal(extractChordproBlocks(md), "{key: G}\n[G]Hi");
	assert.equal(extractChordproBlocks("no blocks here"), null);
});

// --- capo / used chords -----------------------------------------------------

test("detectCapo reads the capo directive", () => {
	assert.equal(detectCapo("{capo: 3}\n[A]La"), 3);
	assert.equal(detectCapo("[A]La"), 0);
});

test("usedChords lists unique chords in first-use order", () => {
	const src = "{verse 1}\n[A]La [D]la [A]la [F#m]la\n{chorus}\n[E]La [D]la\n";
	assert.deepEqual(usedChords(src), ["A", "D", "F#m", "E"]);
});

// --- transpose helpers ------------------------------------------------------

test("semitonesBetween takes the shortest path", () => {
	assert.equal(semitonesBetween("A", "B"), 2);
	assert.equal(semitonesBetween("A", "G"), -2);
	assert.equal(semitonesBetween("C", "F#"), 6);
	assert.equal(semitonesBetween("A", "A"), 0);
});

test("transposeKeyName spells the target key conventionally", () => {
	assert.equal(transposeKeyName("A", false, 1), "Bb");
	assert.equal(transposeKeyName("A", false, 2), "B");
	assert.equal(transposeKeyName("E", true, 1), "Fm");
	assert.equal(transposeKeyName("F#", false, -4), "D");
});

test("shared music engine transposes browser chord symbols", () => {
	assert.equal(transposeChord("A", 1, { tonic: "A", minor: false }), "Bb");
	assert.equal(transposeChord("E/G#", 1, { tonic: "A", minor: false }), "F/A");
	assert.equal(transposeChord("F#m7", -2, { tonic: "A", minor: false }), "Em7");
	assert.equal(transposeChord("not-a-chord", 2, { tonic: "C", minor: false }), "not-a-chord");
});

test("transposeSource uses the keyHint when no key directive exists", () => {
	const out = transposeSource("[A]La [D]la", 1, { tonic: "A", minor: false });
	// Target key Bb prefers flats
	assert.ok(out.includes("[Bb]"));
	assert.ok(out.includes("[Eb]"));
});

// --- Nashville numbers ------------------------------------------------------

test("chordToNashville numbers chords relative to the key", () => {
	assert.equal(chordToNashville("A", "A"), "1");
	assert.equal(chordToNashville("F#m7", "A"), "6m7");
	assert.equal(chordToNashville("D/F#", "A"), "4/6");
	assert.equal(chordToNashville("G", "A"), "b7");
	assert.equal(chordToNashville("Esus4", "A"), "5sus4");
	assert.equal(chordToNashville("D#", "A"), "#4");
});

test("toNashvilleSource rewrites chord tokens and needs a key", () => {
	const src = "{key: A}\n{verse 1}\n[A]La [F#m]la [D/F#]la\n";
	const out = toNashvilleSource(src);
	assert.ok(out.includes("[1]La [6m]la [4/6]la"));
	// No key: unchanged
	const nokey = "[A]La";
	assert.equal(toNashvilleSource(nokey), nokey);
});

// --- form / roadmap (v0.3.0) ------------------------------------------------

import { parseForm, formToString, expandForm, detectForm, shortLabel, canonicalToken, parseSections } from "../src/core/form";

test("parseForm reads shorthand and full names", () => {
	const tokens = parseForm("V1 PC C V2 PC C C B C C End");
	assert.equal(tokens.length, 11);
	assert.deepEqual(tokens[0], { name: "verse", number: "1", raw: "V1" });
	assert.equal(tokens[1].name, "pre-chorus");
	assert.equal(tokens[2].name, "chorus");
	assert.equal(tokens[7].name, "bridge");
	assert.equal(tokens[10].name, "outro");
});

test("parseForm handles commas and full names with spaces", () => {
	const tokens = parseForm("Verse 1, Chorus, Verse 2, Chorus");
	assert.deepEqual(tokens.map((t) => t.name), ["verse", "chorus", "verse", "chorus"]);
	assert.equal(tokens[0].number, "1");
	assert.equal(tokens[2].number, "2");
});

test("custom cues survive as labels", () => {
	const tokens = parseForm("V1 C Prayer C");
	assert.equal(tokens[2].name, null);
	assert.equal(tokens[2].raw, "Prayer");
	assert.equal(shortLabel(tokens[2]), "Prayer");
});

test("formToString round-trips through parseForm", () => {
	const s = formToString(parseForm("V1 PC C V2 PC C C B C C End"));
	assert.equal(s, "V1 PC C V2 PC C C B C C End");
	assert.equal(formToString(parseForm(s)), s);
});

test("expandForm repeats section content in form order", () => {
	const src = [
		"{title: Test}",
		"{key: E}",
		"{form: V1 C V2 C C}",
		"",
		"{verse 1}",
		"[E]First verse",
		"",
		"{chorus}",
		"[A]The chorus",
		"",
		"{verse 2}",
		"[E]Second verse"
	].join("\n");
	const out = expandForm(src);
	// Chorus content appears three times
	assert.equal(out.split("[A]The chorus").length - 1, 3);
	// Order: v1 before first chorus, v2 after
	const v1 = out.indexOf("First verse");
	const c1 = out.indexOf("The chorus");
	const v2 = out.indexOf("Second verse");
	assert.ok(v1 < c1 && c1 < v2);
	// The form directive itself is gone
	assert.ok(!/\{\s*form/i.test(out));
	// Header directives survive
	assert.ok(out.includes("{title: Test}"));
});

test("forms recognize standard comment labels used by the existing library", () => {
	const src = [
		"{form: V1 C V2 C}",
		"{comment: Verse 1}",
		"[C]one",
		"{comment: Chorus}",
		"[F]sing",
		"{comment: Verse 2}",
		"[G]two"
	].join("\n");
	const parsed = parseSections(src);
	assert.deepEqual(parsed.sections.map((section) => section.label), ["Verse 1", "Chorus", "Verse 2"]);
	const out = expandForm(src);
	assert.equal((out.match(/\{comment: Chorus\}/g) ?? []).length, 2);
	assert.equal((out.match(/\[F\]sing/g) ?? []).length, 2);
});

test("forms preserve lettered section variants and custom comment sections", () => {
	const src = [
		'{form: B1a "Simplified harmonies" B1b}',
		"{comment: Bridge 1a}",
		"[Am]first",
		"{comment: Simplified harmonies}",
		"[C]easy",
		"{comment: Bridge 1b}",
		"[G]second"
	].join("\n");
	const sections = parseSections(src).sections;
	assert.deepEqual(sections.map((section) => section.label), ["Bridge 1a", "Simplified harmonies", "Bridge 1b"]);
	const out = expandForm(src);
	assert.ok(out.includes("{comment: Bridge 1a}\n[Am]first"));
	assert.ok(out.includes("{comment: Simplified harmonies}\n[C]easy"));
	assert.ok(out.includes("{comment: Bridge 1b}\n[G]second"));
});

test("stage-note comments remain inside their section", () => {
	const src = `{comment: Verse 1}\n[C]line\n{comment: ${STAGE_NOTE_MARK}hold}\n[F]more`;
	const sections = parseSections(src).sections;
	assert.equal(sections.length, 1);
	assert.ok(sections[0].content.includes(STAGE_NOTE_MARK));
});

test("expandForm leaves songs without a form untouched", () => {
	const src = "{key: G}\n{verse 1}\n[G]Hello\n";
	assert.equal(expandForm(src), src);
});

test("expandForm renders unknown sections as recall markers", () => {
	const src = "{form: V1 B}\n{verse 1}\n[C]La\n";
	const out = expandForm(src);
	assert.ok(out.includes("{comment: Bridge}"));
});

test("detectForm reads the directive", () => {
	assert.equal(detectForm("{form: V1 C}\n{verse 1}\nx"), "V1 C");
	assert.equal(detectForm("{verse 1}\nx"), null);
});

test("canonicalToken maps aliases", () => {
	assert.equal(canonicalToken("Ending").name, "outro");
	assert.equal(canonicalToken("prechorus").name, "pre-chorus");
	assert.equal(canonicalToken("Inst").name, "instrumental");
});

// --- smart paste (v0.3.0) -----------------------------------------------------

import {
	convertPastedChart,
	looksLikeChordLine,
	mergeChordLine,
	parseImportedSong,
	importAsMarkdown,
	songLibraryFolderForExtension
} from "../src/core/import";

test("song library routes created formats beneath one root", () => {
	assert.equal(songLibraryFolderForExtension("Songs", "chordpro"), "Songs/ChordPro");
	assert.equal(songLibraryFolderForExtension("Songs/", ".md"), "Songs/Text");
	assert.equal(songLibraryFolderForExtension("Library", "PDF"), "Library/PDF");
	assert.equal(songLibraryFolderForExtension("Library", "pptx"), "Library/Slides");
	assert.equal(songLibraryFolderForExtension("", "txt"), "Songs/Text");
	assert.throws(() => songLibraryFolderForExtension("Songs", "mp3"), /Unsupported/);
});

test("looksLikeChordLine detects chord lines and rejects lyrics", () => {
	assert.ok(looksLikeChordLine("G        C/E       D"));
	assert.ok(looksLikeChordLine("| G | C | D |  x2"));
	assert.ok(!looksLikeChordLine("Amazing grace how sweet the sound"));
	assert.ok(!looksLikeChordLine("Groovy Dance Craze"));
});

test("mergeChordLine places chords by column", () => {
	const merged = mergeChordLine("G        C", "Amazing grace");
	assert.equal(merged, "[G]Amazing g[C]race");
});

test("convertPastedChart merges chords-over-lyrics and finds sections", () => {
	const pasted = [
		"Amazing Grace",
		"Key: G",
		"",
		"[Verse 1]",
		"G           C        G",
		"Amazing grace how sweet the sound",
		"",
		"[Chorus]",
		"C     G",
		"How sweet it is"
	].join("\n");
	const out = convertPastedChart(pasted).text;
	assert.ok(out.includes("{title: Amazing Grace}"));
	assert.ok(out.includes("{key: G}"));
	assert.ok(out.includes("{comment: Verse 1}"));
	assert.ok(out.includes("{comment: Chorus}"));
	assert.ok(out.includes("[G]Amazing"));
	assert.ok(!/^\s*G\s+C\s+G\s*$/m.test(out));
});

test("convertPastedChart captures CCLI and drops SongSelect boilerplate", () => {
	const pasted = [
		"Demo Song",
		"Key: E",
		"",
		"[Verse]",
		"E         A",
		"You are here",
		"",
		"CCLI Song # 123456",
		"CCLI License # 123456",
		"For use solely with the SongSelect Terms of Use."
	].join("\n");
	const result = convertPastedChart(pasted);
	assert.equal(result.ccli, "123456");
	assert.ok(result.text.includes("{ccli: 123456}"));
	assert.ok(!result.text.includes("For use solely"));
	assert.ok(!result.text.includes("CCLI License"));
});

test("convertPastedChart passes ChordPro through without double brackets", () => {
	const pasted = "{title: Test}\n{verse 1}\n[G]Hello [C]world\n";
	const out = convertPastedChart(pasted).text;
	assert.ok(out.includes("[G]Hello [C]world"));
	assert.ok(!out.includes("[[G]]"));
});

test("parseImportedSong + importAsMarkdown build a frontmatter note", () => {
	const parsed = parseImportedSong("demo-song-chordpro-E.txt", "{verse 1}\n[E]Sample lyric\n");
	assert.equal(parsed.meta.key, "E");
	assert.equal(parsed.meta.title, "Demo Song");
	const md = importAsMarkdown(parsed);
	assert.ok(md.startsWith("---\ntitle: Demo Song\nkey: E\n---"));
	assert.ok(md.includes("[E]Sample lyric"));
});

// --- accidentals preference (v0.2.0) -----------------------------------------

import { setAccidentalsPref } from "../src/core/chordpro";

test("accidentals preference overrides key-based spelling", () => {
	// A up 1 = Bb major: auto follows the flat key, sharps forces A#.
	setAccidentalsPref("sharps");
	assert.ok(transposeSource("{key: A}\n[A]La", 1).includes("[A#]"));
	// C up 2 = D major: auto spells sharps, flats forces Gb for the E chord.
	setAccidentalsPref("flats");
	assert.ok(transposeSource("{key: C}\n[E]La", 2).includes("[Gb]"));
	setAccidentalsPref("auto");
	assert.ok(transposeSource("{key: A}\n[A]La", 1).includes("[Bb]"));
	assert.ok(transposeSource("{key: C}\n[E]La", 2).includes("[F#]"));
});

// --- v0.3.1 audit regressions -------------------------------------------------

test("multi-word custom cues round-trip through quoting", () => {
	const tokens = parseForm("V1 C");
	tokens.push({ name: null, number: null, raw: "In Christ Alone" });
	const stored = formToString(tokens);
	assert.equal(stored, 'V1 C "In Christ Alone"');
	const reparsed = parseForm(stored);
	assert.equal(reparsed.length, 3);
	assert.equal(reparsed[2].name, null);
	assert.equal(reparsed[2].raw, "In Christ Alone");
	// Round-trips stably a second time
	assert.equal(formToString(reparsed), stored);
});

test("parseForm still splits unquoted separators and arrows", () => {
	const tokens = parseForm("V1 -> C | V2 / C");
	assert.deepEqual(tokens.map((t) => t.name), ["verse", "chorus", "verse", "chorus"]);
});

test("expandForm output is unaffected by quoted cues", () => {
	const src = '{form: V1 "Instrumental Prayer" C}\n{verse 1}\nv1\n\n{chorus}\nc\n';
	const out = expandForm(src);
	assert.ok(out.includes("{comment: Instrumental Prayer}"));
	assert.ok(out.indexOf("v1") < out.indexOf("{comment: Instrumental Prayer}"));
});

import { detectAutoscroll } from "../src/core/chordpro";
import { prepareSongText, shareFileName } from "../src/core/share";
import { parseRunsheet, formatClock, formatDuration } from "../src/core/runsheet";

// --- v0.4.0: autoscroll directive ---------------------------------------------

test("detectAutoscroll reads the directive and caps it", () => {
	assert.equal(detectAutoscroll("{autoscroll: 45}\n[C]La"), 45);
	assert.equal(detectAutoscroll("{ AutoScroll : 20 }"), 20);
	assert.equal(detectAutoscroll("[C]La"), null);
	assert.equal(detectAutoscroll("{autoscroll: 0}"), null);
	assert.equal(detectAutoscroll("{autoscroll: 999}"), 300);
});

test("autoscroll frontmatter becomes a directive and never renders", () => {
	const resolved = applyFrontmatter("---\nkey: G\nautoscroll: 25\n---\n[G]La");
	assert.equal(detectAutoscroll(resolved), 25);
	assert.ok(!preprocess(resolved).includes("autoscroll"));
	assert.ok(!renderChart(resolved, 0).html.includes("autoscroll"));
});

// --- v0.4.0: print / team share resolver ---------------------------------------

test("prepareSongText expands the form and transposes to the target key", () => {
	const raw = [
		"---",
		"title: Test Song",
		"key: G",
		"form: V1 C C",
		"---",
		"{verse 1}",
		"[G]Verse line",
		"",
		"{chorus}",
		"[C]Chorus line"
	].join("\n");
	const text = prepareSongText(raw, "A");
	assert.ok(text.includes("{key: A}"));
	assert.ok(text.includes("[A]Verse line"));
	assert.ok(text.includes("[D]Chorus line"));
	// The form repeats the chorus twice in the output.
	assert.equal(text.split("[D]Chorus line").length - 1, 2);
});

test("prepareSongText without a target keeps the song's key", () => {
	const text = prepareSongText("{key: E}\n[E]La", null);
	assert.ok(text.includes("{key: E}"));
	assert.ok(text.includes("[E]La"));
});

test("shareFileName numbers and labels song files", () => {
	assert.equal(shareFileName(0, "Amazing Grace", "Eb"), "01 Amazing Grace (Eb).chordpro");
	assert.equal(shareFileName(11, "What/If: A Song?", null), "12 WhatIf A Song.chordpro");
});

// --- v0.4.0: run sheet ----------------------------------------------------------

test("parseRunsheet reads durations, people, and clock offsets", () => {
	const src = [
		"---",
		"start: 9:30 AM",
		"---",
		"## Pre-service",
		"- Countdown (5 min)",
		"- [[Reasons.chordpro|Reasons]] in G (6 min) @Band",
		"- Welcome @Chris Rodriguez (2 min)",
		"- Reading",
		"1. Prayer (90 sec)"
	].join("\n");
	const sheet = parseRunsheet(src);
	assert.equal(sheet.startMinutes, 9 * 60 + 30);
	assert.equal(sheet.twelveHour, true);
	assert.equal(sheet.items.length, 6);
	assert.equal(sheet.items[0].kind, "divider");
	assert.equal(sheet.items[1].seconds, 300);
	assert.deepEqual(sheet.items[2].people, ["Band"]);
	assert.deepEqual(sheet.items[3].people, ["Chris Rodriguez"]);
	assert.equal(sheet.items[3].text, "Welcome");
	assert.equal(sheet.items[4].seconds, null);
	assert.equal(sheet.items[5].seconds, 90);
	// Cumulative offsets: 0, 0, 300, 660, 780, 780.
	assert.equal(sheet.items[2].offsetSeconds, 300);
	assert.equal(sheet.items[5].offsetSeconds, 780);
	assert.equal(sheet.totalSeconds, 870);
});

test("parseRunsheet handles m:ss durations and lines without frontmatter", () => {
	const sheet = parseRunsheet("- Offering (1:30)\n- Sermon (30)");
	assert.equal(sheet.startMinutes, null);
	assert.equal(sheet.items[0].seconds, 90);
	assert.equal(sheet.items[1].seconds, 1800);
});

test("formatClock renders 12-hour, 24-hour, and elapsed styles", () => {
	const twelve = parseRunsheet("---\nstart: 11:55 AM\n---\n- A (10 min)\n- B (5 min)");
	assert.equal(formatClock(twelve, twelve.items[0].offsetSeconds), "11:55 AM");
	assert.equal(formatClock(twelve, twelve.items[1].offsetSeconds), "12:05 PM");
	const twentyFour = parseRunsheet("---\nstart: 18:00\n---\n- A (5 min)");
	assert.equal(formatClock(twentyFour, 0), "18:00");
	const elapsed = parseRunsheet("- A (5 min)");
	assert.equal(formatClock(elapsed, 300), "+5:00");
	assert.equal(formatDuration(90), "1:30");
});

// --- standard sections -------------------------------------------------------

test("section vocabulary recognizes the standard labels", () => {
	assert.ok(SECTION_DIRECTIVE_RE.test("{interlude}"));
	assert.ok(SECTION_DIRECTIVE_RE.test("{ending}"));
	assert.ok(SECTION_DIRECTIVE_RE.test("{pre-chorus 2}"));
	assert.ok(!SECTION_DIRECTIVE_RE.test("{prayer}"));
	assert.ok(preprocess("{interlude}\nriff").includes("{comment: Interlude}"));
});

// --- stage notes and reference audio -----------------------------------------

import { detectAudio, STAGE_NOTE_MARK } from "../src/core/chordpro";
import { displayText } from "../src/core/runsheet";

test("preprocess rewrites {note: ...} into a marked comment", () => {
	const out = preprocess("{verse 1}\n[A]La la\n{note: watch the ritard}\n[D]La\n");
	assert.ok(out.includes(`{comment: ${STAGE_NOTE_MARK}watch the ritard}`));
	assert.ok(!out.includes("{note:"));
	// The note must not close the verse environment around it.
	const verseClose = out.indexOf("{end_of_verse}");
	const note = out.indexOf(STAGE_NOTE_MARK);
	assert.ok(note < verseClose);
});

test("note frontmatter becomes a stage note directive", () => {
	const out = applyFrontmatter("---\nkey: G\nnote: pads only, no drums\n---\n[G]La\n");
	assert.ok(out.includes("{note: pads only, no drums}"));
	assert.ok(preprocess(out).includes(`{comment: ${STAGE_NOTE_MARK}pads only, no drums}`));
});

test("audio directives are metadata: detected, never rendered", () => {
	const src = "{key: G}\n{audio: https://open.spotify.com/track/x}\n[G]La\n";
	assert.equal(detectAudio(src), "https://open.spotify.com/track/x");
	assert.ok(!preprocess(src).includes("{audio:"));
	assert.equal(detectAudio("[G]La"), null);
});

test("audio frontmatter becomes a directive", () => {
	const out = applyFrontmatter("---\nkey: G\naudio: Recordings/demo.m4a\n---\n[G]La\n");
	assert.equal(detectAudio(out), "Recordings/demo.m4a");
});

test("displayText strips wikilinks, aliases, and markdown links", () => {
	assert.equal(displayText("[[Songs/Amazing Grace.chordpro|Amazing Grace]] in G"), "Amazing Grace in G");
	assert.equal(displayText("[[Bulletin.pdf]]"), "Bulletin");
	assert.equal(displayText("[Sermon notes](https://x.test)"), "Sermon notes");
});

// --- YAML safety in generated frontmatter (v0.7.1, audit finding) -------------

import { yamlValue } from "../src/core/frontmatter";

test("yamlValue quotes titles that would break YAML, round-trips via splitFrontmatter", () => {
	const cases = [
		"God: Our Refuge",
		"King #1",
		'O Come, "All Ye Faithful"',
		"Yes / No",
		"No",
		"  leading space",
		"- dashed"
	];
	for (const title of cases) {
		const note = `---\ntitle: ${yamlValue(title)}\nkey: G\n---\n\n[G]La\n`;
		const { meta } = splitFrontmatter(note);
		assert.equal(meta.title, title, `round-trip failed for: ${title}`);
		assert.equal(meta.key, "G");
	}
});

test("yamlValue leaves plain titles bare", () => {
	assert.equal(yamlValue("Amazing Grace"), "Amazing Grace");
	assert.equal(yamlValue("Demo Song"), "Demo Song");
	// F#m is a bare-safe scalar (# not preceded by space).
	const { meta } = splitFrontmatter("---\nkey: F#m\n---\n[A]La\n");
	assert.equal(meta.key, "F#m");
});

// --- CCLI usage report (v0.7.1) ----------------------------------------------

import { buildCcliReport, isLikelySong, parseServiceDate, songMetaFromText } from "../src/core/ccli";

test("parseServiceDate reads frontmatter dates and filename dates", () => {
	assert.equal(parseServiceDate("2026-07-13", "Sunday Set"), "2026-07-13");
	assert.equal(parseServiceDate(undefined, "2026-07-13 Morning Service"), "2026-07-13");
	assert.equal(parseServiceDate(undefined, "Service 2026.01.05"), "2026-01-05");
	assert.equal(parseServiceDate(undefined, "2026_1_5 Set"), "2026-01-05");
	assert.equal(parseServiceDate(undefined, "No date here"), null);
	assert.equal(parseServiceDate(undefined, "2026-13-40 bad"), null);
});

test("songMetaFromText pulls title, artist, ccli; falls back to basename", () => {
	const resolved = "{title: Amazing Grace}\n{artist: John Newton}\n{ccli: 22025}\n[C]La\n";
	assert.deepEqual(songMetaFromText(resolved, "file"), {
		title: "Amazing Grace",
		artist: "John Newton",
		ccli: "22025"
	});
	assert.deepEqual(songMetaFromText("[C]La\n", "Untitled Song"), {
		title: "Untitled Song",
		artist: null,
		ccli: null
	});
});

test("buildCcliReport aggregates counts, dates, and flags missing CCLI", () => {
	const services = [
		{
			date: "2026-01-05",
			label: "Jan 5",
			 songs: [
				{ title: "Amazing Grace", ccli: "22025", artist: "John Newton" },
				{ title: "Demo Song", ccli: null, artist: "A. Writer" }
			]
		},
		{
			date: "2026-01-12",
			label: "Jan 12",
			songs: [
				{ title: "Amazing Grace", ccli: "22025", artist: null },
				{ title: "Amazing Grace", ccli: "22025", artist: null } // duplicate in one service
			]
		},
		{
			date: "2025-12-29", // out of range
			label: "Dec 29",
			songs: [{ title: "Amazing Grace", ccli: "22025", artist: "John Newton" }]
		}
	];
	const report = buildCcliReport(services, "2026-01-01", "2026-06-30");
	assert.equal(report.serviceCount, 2);
	const grace = report.rows.find((r) => r.title === "Amazing Grace");
	assert.ok(grace);
	assert.equal(grace.count, 2); // once per service, duplicate ignored
	assert.deepEqual(grace.dates, ["2026-01-05", "2026-01-12"]);
	assert.equal(grace.artist, "John Newton"); // fullest metadata retained
	assert.equal(report.missing.length, 1);
	assert.equal(report.missing[0].title, "Demo Song");
});

test("buildCcliReport keys by CCLI number so retitled songs still merge", () => {
	const services = [
		{ date: "2026-02-01", label: "a", songs: [{ title: "Amazing Grace", ccli: "22025", artist: null }] },
		{ date: "2026-02-08", label: "b", songs: [{ title: "Amazing Grace (Traditional)", ccli: "22025", artist: null }] }
	];
	const report = buildCcliReport(services, "2026-01-01", "2026-12-31");
	assert.equal(report.rows.length, 1);
	assert.equal(report.rows[0].count, 2);
});

test("isLikelySong distinguishes songs from linked setlists and notes", () => {
	assert.equal(isLikelySong("anything", "chordpro"), true);
	assert.equal(isLikelySong("{key: G}\nsome text", "md"), true);
	assert.equal(isLikelySong("[G]La la la", "md"), true);
	assert.equal(isLikelySong("{ccli: 22025}\nno chords", "md"), true);
	assert.equal(isLikelySong("# Setlist\n\n- [[Song A]]\n- [[Song B]]", "md"), false);
	assert.equal(isLikelySong("Contact: the drummer, 555-1234", "md"), false);
});
