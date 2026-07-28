# Contributing

Thanks for looking. Stage Binder is a personal tool that grew into something worth sharing, so it is opinionated: it favors one-click actions and calm defaults over configuration.

## Getting set up

```bash
npm install
npm run lint      # Obsidian-specific static checks
npm test          # core and UI tests; no Obsidian installation needed
npm run build     # typecheck + production bundle
npm run dev       # esbuild watch mode
```

To try a build in Obsidian, point the installer at a scratch vault (not one you gig with):

```bash
CHORDPRO_VAULT="/absolute/path/to/scratch-vault" npm run install:vault
```

Then reload Obsidian and enable the plugin.

## The one architectural rule

**`src/core/` must never import from `obsidian`.**

Everything musical lives there: theory, chord lookup, the ChordPro parser and transposer, the lyrics formatter, the form engine, the importer, and the run sheet parser. That keeps it unit testable without a mock Obsidian. Obsidian-specific code (views, commands, modals, editor extensions) lives in `src/ui/` and `src/main.ts`.

If you add music logic, add it to `src/core/` and write a test for it in `test/core.test.ts`.

## Security note

Chart HTML must always go through `setChartHtml()` in `src/ui/render-song.ts`, which runs it through Obsidian's sanitizer. ChordSheetJS does not escape lyrics or titles, and Smart Paste means song text can come from any website. Never assign chart HTML with `innerHTML`.

## Pull requests

- Run `npm run lint`, `npm test`, and `npm run build` before you push; all must complete successfully.
- Keep the diff focused. One idea per PR.
- Match the surrounding style. The codebase uses tabs, and comments explain *why* something is done, not what the next line does.

## Reporting bugs

Open an issue with the steps to reproduce and your Obsidian and plugin versions. If a specific song triggers it, a two-line snippet is much more useful than a whole chart, and please do not paste full copyrighted lyrics.
