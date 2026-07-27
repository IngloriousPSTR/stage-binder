# ChordPro Studio

ChordPro Studio is an Obsidian plugin for writing ChordPro charts, organizing setlists and run sheets, and performing from an iPad or desktop. Songs remain ordinary Markdown or `.chordpro` files in your vault.

## Why

Most music tools manage a list of songs. A service or show is more than a list of songs.

ChordPro Studio keeps the whole plan together: charts, the Form each song is actually played in, performance keys, clock times, assignments, readings and notes, PDFs, images, and the running order. When the set begins, the same files become a touch-friendly performance view.

Charts, setlists, and run sheets remain ordinary files in your Obsidian vault. They stay searchable, work offline, and remain yours if you stop using the plugin tomorrow.

ChordPro Studio was built first for a small church with a volunteer band and no room in the budget for another subscription. The same workflow also fits gigging musicians, bandleaders, and songwriters who need more than a folder of disconnected charts.

## Features

- Write songs with chord insertion, section helpers, chord autocomplete, and guitar diagrams.
- Define a song's **Form**, such as Verse, Chorus, Verse, Chorus, Bridge, Chorus.
- Preview charts with transpose, Nashville numbers, lyrics-only display, columns, and text sizing.
- Build setlists from ordinary Obsidian links and assign a performance key to each song.
- Build timed run sheets with leaders, durations, linked songs, prose notes, PDFs, and images.
- Perform in a fullscreen, touch-friendly display with autoscroll, page-turner keyboard controls, MIDI pedal support, and light or dark themes.
- Export transposed ChordPro files, create printable set notes, and prepare CCLI usage reports.

## Install

After ChordPro Studio is accepted into the Obsidian Community directory:

1. Open **Settings → Community plugins → Browse**.
2. Search for **ChordPro Studio**.
3. Select **Install**, then **Enable**.

For prerelease or manual testing, download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release and place them in:

```text
<your-vault>/.obsidian/plugins/chordpro-studio/
```

Reload Obsidian, then enable ChordPro Studio under Community plugins.

Requires Obsidian 1.8.7 or later. Desktop and mobile are supported.

## Quick start

1. Run **New song** from the command palette.
2. Open the ChordPro Studio toolbox from the guitar ribbon icon.
3. Add section labels and chords, then choose **Preview**.
4. Create a Markdown note containing links to songs and run **Open setlist**.
5. Choose **Perform** when you are ready to use the set on stage.

The repository includes one small [public-domain demo set](examples/) that can be copied into a scratch vault. ChordPro Studio never creates demo files automatically.

## Song format

Songs can be `.chordpro` files or Markdown notes. Metadata can use ChordPro directives:

```chordpro
{title: Amazing Grace}
{artist: John Newton}
{key: G}
{form: V1 V2 V3 V4}

{comment: Verse 1}
Amazing [G]grace, how [C]sweet the [G]sound
That saved a wretch like [D]me
```

Markdown songs can keep the same values in YAML properties and place the chart in the note body or a fenced `chordpro` block.

## Setlists and run sheets

A setlist is a Markdown note containing links in performance order:

```markdown
# Saturday set

1. [[Songs/Amazing Grace.chordpro]] in G
2. [[PDF/Aura Lea.pdf]]
```

A run sheet may also contain a `start` property, headings, durations, and leaders:

```markdown
---
start: 7:30 PM
---

## Set one

- [[Songs/Amazing Grace.chordpro]] in G (4 min) @Band
- Changeover (2 min) @Stage manager
```

## Network use and privacy

ChordPro Studio does not include telemetry, analytics, advertising, accounts, payments, or automatic network requests.

The plugin reads files only from the current Obsidian vault. It writes or rewrites files only after an explicit user action, such as creating a song, committing a transpose, exporting a chart, or generating a report. A user may attach an external reference-audio URL to a song; ChordPro Studio displays that URL as a link and connects only when the user chooses to open it.

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

To install a build in a scratch vault:

```bash
CHORDPRO_VAULT="/absolute/path/to/scratch-vault" npm run install:vault
```

Do not test development builds in a vault containing irreplaceable material.

## Security and copyright

Rendered chart HTML passes through Obsidian's sanitizer. The plugin does not include song libraries or licensed lyrics. Users are responsible for having permission to store, display, print, or share the music they add to their vault.

The files under `examples/` use public-domain works. Their provenance is documented in [examples/README.md](examples/README.md).

## License

ChordPro Studio is released under the [MIT License](LICENSE). Third-party notices are preserved in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/README.md).
