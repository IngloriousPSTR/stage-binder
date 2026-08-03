# Getting started with Stage Binder

Stage Binder turns Obsidian into a place to write song charts, arrange them, build setlists and run sheets, and perform from a tablet or a laptop. Your songs stay as plain text files in your own vault. No account, no cloud service, no lock-in.

This guide takes about fifteen minutes and ends with you running a set from a tablet.

---

## 1. Install

**From the Community directory**

Open **Settings → Community plugins → Browse**, search for "Stage Binder", select **Install**, then **Enable**.

**Manually from a release**

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/IngloriousPSTR/stage-binder/releases/latest), and put all three into `YourVault/.obsidian/plugins/stage-binder/`. Restart Obsidian, then enable the plugin under **Settings → Community plugins**.

---

## 2. Point it at two folders

Open Settings, Stage Binder. On the **Global** tab, scroll to **Library**:

- **Songs folder**: where charts live. Default `Songs`. New and imported files are filed automatically into `ChordPro`, `Text`, `PDF`, or `Slides` subfolders by format.
- **Setlists folder**: where setlists and run sheets live. Default `Setlists`.

Below that, **Stage file types** controls what a setlist is allowed to contain. ChordPro, Markdown, PDF, and Images are all on by default. Leave them on: mixing formats in one running order is the point.

Everything else has a sensible default. Come back to chart colours, fonts, and sizes once you have a song to look at.

---

## 3. Write your first song

Open the toolbox with the command **Stage Binder: Open toolbox**, then use **Create**:

- **New song** starts a blank chart
- **Smart paste** builds a chart from lyrics already on your clipboard, including output from SongSelect, Ultimate Guitar, and PraiseCharts
- **Format lyrics** cleans up lyrics you have pasted by hand

A ChordPro chart is just text. Square brackets place a chord above the syllable that follows it:

```chordpro
{title: Amazing Grace}
{artist: John Newton}
{key: G}
{time: 3/4}
{tempo: 76}
{form: V1 V2 V3 V4}

{comment: Verse 1}
Amazing [G]grace, how [C]sweet the [G]sound
That saved a wretch like [D]me
```

Two things matter most:

- `{comment: Verse 1}` marks a **section**. Sections are what Form, Performance advance, and setlists all work from.
- `{form: ...}` is the song's **roadmap**, covered in step 5.

Chord names autocomplete as you type, and hovering a chord in the editor shows its shape.

---

## 4. Read it as a chart

Run **Stage Binder: Preview chart (chords over lyrics)**. The chart renders with chords positioned over the lyrics, chord diagrams across the top, and the form strip beneath the title.

Open the **Tools** panel from the `...` button above the chart. This is where the live controls live:

| Control | What it does |
|---|---|
| `-` `Key: G` `+` | Transpose up or down. The chart, the diagrams, and the capo table all follow |
| `145` | Switch to Nashville numbers, so the chart works in any key |
| `Lyrics` | Hide chords and show lyrics only |
| `Form` | Apply or ignore the song's roadmap |
| `A-` `100%` `A+` | Text size, for reading distance |
| `1` `2` `3` | Column layout. Three columns on a landscape tablet often fits a whole song |
| `Auto` `-` `30` `+` | Autoscroll speed in pixels per second |
| `Performance` | Go fullscreen |

Tap any chord symbol in the rendered chart to open the **fingering dock**, which shows every voicing for that chord with an **Insert** button for each.

---

## 5. Arrange it with Form

A **form** is the order you actually play the sections: Verse, Chorus, Verse, Chorus, Bridge, Chorus. It lives in the song file, so the chart and any setlist referring to it always agree.

In the toolbox, open **Form**. Add sections with the **Add to form** buttons, reorder them with the arrows, and remove ones you do not need. Changes save automatically. Repeat a section by adding it again.

Why bother: with a form applied, Performance mode advances through your arrangement rather than the order the sections happen to appear in the file. You write each verse once and play it whenever you like.

The form strip under the title lights up the section you are in as the chart scrolls.

---

## 6. Build a run sheet

A setlist is an ordinary Markdown note in your Setlists folder. Link to songs, assign people, and give each item a duration:

```markdown
---
start: 7:00 PM
---

# Acoustic Evening

## Set

1. [[Welcome and house notes]] @Host (2 min)
2. [[Stage plot.svg]] @Stage (1 min)
3. [[Amazing Grace.chordpro]] in G @Vocals (4 min)
4. [[Greensleeves]] in Am @Guitar (3 min)
5. [[PDF/Aura Lea.pdf]] @Piano (3 min)
```

Note what is happening there. A ChordPro chart, a Markdown note, an SVG image, and a PDF are all sitting in one running order. Anything you link becomes a stage item.

- `in G` sets the key for that performance without editing the song
- `@Vocals` assigns a person or role
- `(4 min)` sets a duration, and `start:` turns the durations into clock times

Non-song items matter as much as songs. House notes, changeover instructions, and a stage plot are all things you need on stage and would otherwise keep on paper.

---

## 7. Perform

Open the setlist and press **Perform**.

The bottom dock has five buttons:

| Button | Action |
|---|---|
| **Back** | Previous item in the set |
| **Previous** | Previous section in the current song |
| **Auto** | Start or stop autoscroll |
| **Next** | Next section |
| **Forward** | Next item in the set |

Across the bottom, the **Up Next** bar shows the clock time and what is coming, so you know what is next without leaving what you are on.

The **Song set** drawer lists the whole running order with times, formats, roles, and durations. Tap any item to jump straight to it.

In the Tools panel, Performance adds:

- **Reading**: single page, or continuous scroll through the set
- **Advance**: whether Next moves by page, section, or element
- **Display**: light or dark. Dark for a dim stage, light for daylight

The screen stays awake while you are performing. Keyboard-style page-turn pedals work anywhere Obsidian receives their key presses; MIDI-mode pedals work on platforms where Web MIDI is available.

---

## 8. Worth knowing

**Rebuild a chart from a PDF.** Open the PDF in one pane and a new chart in the other, and type the chart alongside it. You end up with a transposable, resizable, searchable version of something that was previously a fixed image.

**Reference tools**, in the toolbox under Reference: a capo table, an easy-shapes finder for playable voicings in awkward keys, a transpose map, and a reference audio link for the recording you are learning from.

**Export**, under Display and output: export a single chart or a whole set, for printing or sharing with people who do not use Obsidian.

---

## Where to go next

- Try transposing a song and watch the diagrams and capo table follow
- Build a set that mixes a chart, a PDF, and a plain note
- Run it once on a tablet before you rely on it at a gig

Found a problem or want a feature? Open an issue on [GitHub](https://github.com/IngloriousPSTR/stage-binder/issues).
