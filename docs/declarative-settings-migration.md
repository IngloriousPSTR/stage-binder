# Declarative settings migration

Stage Binder should adopt Obsidian 1.13's declarative settings API in a focused follow-up, not in the Community review maintenance release. The maintenance release removes the obsolete slider tooltip calls, but keeps the existing imperative settings UI and the declared Obsidian 1.8.7 compatibility floor.

## Decision

Defer `getSettingDefinitions()` to its own change set.

Obsidian 1.13 calls `getSettingDefinitions()` for search indexing and renders a non-empty result instead of calling `display()`. Older Obsidian versions continue to require `display()`. Implementing both methods is therefore the backward-compatible shape, but returning real definitions changes the rendering path for every setting on Obsidian 1.13 and later. That is too broad to combine with release-provenance and warning cleanup.

The current type definitions show that the declarative API can represent the ordinary toggles, dropdowns, sliders, text fields, color fields, and folder fields. Stage Binder's custom behavior still needs explicit design and tests:

- Four top-level tabs must become declarative pages or an equivalent searchable hierarchy.
- The Global, Editor, Preview, and Performance live previews need non-searchable custom render definitions and cleanup coverage.
- Songs and setlists folder controls need native folder definitions plus the current normalization, missing-folder messages, defaults, and save behavior.
- Reset buttons for fonts, colors, chart scale, line spacing, and diagram scale need custom render definitions or a consistent declarative action pattern.
- Every setting change must preserve its current side effects, including appearance application, chart refresh, reading-view rerendering, editor-extension refresh, and diagram-panel changes.
- `display()` must remain as the pre-1.13 fallback while Obsidian 1.8.7 is supported. Its deprecation finding is expected during that compatibility window.

## Compatibility approach

1. Keep `display()` unchanged as the Obsidian 1.8.7–1.12 fallback.
2. Add `getSettingDefinitions()` using type-only imports so loading the plugin does not require new runtime exports on older Obsidian versions.
3. Return four declarative pages matching the existing tabs and group the same controls under their existing headings.
4. Override declarative value reads and writes against `plugin.settings`, with a typed side-effect table so each control triggers the same work as its imperative counterpart.
5. Use native `folder` controls on Obsidian 1.13+, preserving the current validation text and normalization rules.
6. Keep live previews and reset affordances as narrowly scoped custom render rows until the API offers direct equivalents.

## Acceptance tests

- On Obsidian 1.13 or later, searching Settings finds every named Stage Binder control and opens the correct page.
- Global, Editor, Preview, and Performance expose the same controls, defaults, labels, and descriptions as the current tabs.
- Folder suggestions, path normalization, and missing-folder warnings work for Songs and Setlists.
- Every reset button restores the current default and refreshes its preview immediately.
- Changing chart colors, font, weight, line spacing, scale, columns, diagrams, and editor behavior produces the same live side effects as today.
- The light and dark Performance previews follow the selected stage theme.
- On Obsidian 1.8.7, the existing `display()` path renders and saves all settings without accessing 1.13-only runtime values.
- Automated UI tests cover search metadata, read/write dispatch, page composition, reset actions, and the imperative fallback.

## Sources reviewed

- The installed `obsidian` type definitions for `SettingTab`, `SettingDefinitionItem`, declarative pages, render definitions, folder controls, and slider controls (Obsidian API 1.13).
- [Obsidian settings documentation](https://docs.obsidian.md/Plugins/User+interface/Settings).
- [Stage Binder's pre-change Community scorecard](https://community.obsidian.md/plugins/stage-binder#scorecard), reviewed at commit `a471afe3074b95a1bfcbe627961a093e70a1a599`.
