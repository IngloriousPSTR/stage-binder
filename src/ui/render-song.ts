// Shared song rendering used by the chart view, the setlist view, and
// performance mode: setlist collection, chart chrome (meta line, form strip,
// diagram strip), the full render pipeline, and the autoscroll engine.
import { App, Component, MarkdownRenderer, TFile, sanitizeHTMLToDom, setIcon } from "obsidian";
import {
	Chart,
	detectAudio,
	detectAutoscroll,
	detectCapo,
	detectKey,
	renderChart,
	semitonesBetween,
	STAGE_NOTE_MARK,
	transposeSource,
	usedChords
} from "../core/chordpro";
import { applyFrontmatter, splitFrontmatter } from "../core/frontmatter";
import { detectForm, expandForm, FormToken, fullLabel, parseForm, shortLabel } from "../core/form";
import { toNashvilleSource } from "../core/nashville";
import { findChord, positionToDiagram } from "../core/chords";
import { drawDiagram } from "./diagram";
import { renderPdfInto } from "./pdf-reader";

// --- setlists ---------------------------------------------------------------

export interface SetlistEntry {
	file: TFile;
	/** Performance key tonic from "in G" / "(G)" after the link, or null. */
	key: string | null;
	/** Display label for the override ("G", "F#m"), or null. */
	label: string | null;
	/** Where the link sits in the setlist note, for rewriting the override.
	 * Absent on ad-hoc single-song entries (Perform on a chart). */
	line?: number;
	endCol?: number;
}

export const KEY_OVERRIDE_RE = /^\s*(?:in\s+|\(\s*)([A-G][#b]?)(m?)\)?/i;

/** True for the file types the chart pipeline can treat as a song. */
export function isSongFile(file: TFile): boolean {
	return file.extension === "md" || file.extension === "chordpro";
}

// Order of service as setlist (roadmap 2026-07-14): a service element can be
// a PDF or an image, presented in the setlist and performance views like any
// other item. Print and share exports skip these; they are stage assets.
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

export interface StageFileTypes {
	chordpro: boolean;
	markdown: boolean;
	pdf: boolean;
	images: boolean;
}

/** Whether a linked file is enabled for service/setlist stage surfaces. */
export function isStageFileEnabled(file: TFile, types: StageFileTypes): boolean {
	const ext = file.extension.toLowerCase();
	if (ext === "chordpro") return types.chordpro;
	if (ext === "md") return types.markdown;
	if (ext === "pdf") return types.pdf;
	return IMAGE_EXTENSIONS.has(ext) && types.images;
}

function isServiceAttachment(file: TFile): boolean {
	const ext = file.extension.toLowerCase();
	return ext === "pdf" || IMAGE_EXTENSIONS.has(ext);
}

/** Songs linked from a setlist note, in order, with per-line key overrides. */
export async function collectSetlistSongs(app: App, file: TFile, types?: StageFileTypes): Promise<SetlistEntry[]> {
	const cache = app.metadataCache.getFileCache(file);
	const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? [])];
	refs.sort((a, b) => a.position.start.offset - b.position.start.offset);

	const content = await app.vault.cachedRead(file);
	const lines = content.split(/\r?\n/);
	const out: SetlistEntry[] = [];
	const seen = new Set<string>();

	for (const ref of refs) {
		const dest = app.metadataCache.getFirstLinkpathDest(ref.link.split("#")[0], file.path);
		if (!dest || !(dest instanceof TFile)) continue;
		if (!isSongFile(dest) && !isServiceAttachment(dest)) continue;
		if (types && !isStageFileEnabled(dest, types)) continue;
		const tag = dest.path + ":" + ref.position.start.line + ":" + ref.position.start.col;
		if (seen.has(tag)) continue;
		seen.add(tag);
		const line = lines[ref.position.start.line] ?? "";
		const after = line.slice(ref.position.end.col);
		const m = after.match(KEY_OVERRIDE_RE);
		out.push({
			file: dest,
			key: m ? m[1] : null,
			label: m ? m[1] + (m[2] ? "m" : "") : null,
			line: ref.position.start.line,
			endCol: ref.position.end.col
		});
	}
	return out;
}

// --- chart chrome -----------------------------------------------------------

/**
 * Put rendered chart HTML into an element. ChordSheetJS does NOT escape HTML
 * in lyrics or titles, and song text can come from anywhere (Smart Paste,
 * downloaded files), so raw innerHTML would let a song execute script inside
 * Obsidian. Every chart render must go through this sanitizer.
 */
export function setChartHtml(el: HTMLElement, html: string): void {
	el.empty();
	el.append(sanitizeHTMLToDom(html));
	tagStageNotes(el);
}

/**
 * Stage notes: preprocess rewrote {note: ...} into comments carrying
 * STAGE_NOTE_MARK. Strip the marker and class them so CSS can dim/italicize
 * them on screen and drop them in print.
 */
function tagStageNotes(chartEl: HTMLElement): void {
	for (const comment of Array.from(chartEl.querySelectorAll<HTMLElement>(".comment"))) {
		const text = comment.textContent ?? "";
		if (!text.startsWith(STAGE_NOTE_MARK)) continue;
		comment.setText(text.slice(STAGE_NOTE_MARK.length));
		comment.addClass("sb-stage-note");
	}
}

function placeAfterTitle(chartEl: HTMLElement, el: HTMLElement): void {
	const meta = chartEl.querySelector(".sb-form-strip") ?? chartEl.querySelector(".sb-chart-meta");
	const title = chartEl.querySelector("h1.title");
	if (meta) meta.after(el);
	else if (title) title.after(el);
	else chartEl.prepend(el);
}

export function appendMetaLine(chartEl: HTMLElement, chart: Chart, capo: number, keySuffix = ""): void {
	const parts = [
		chart.meta.artist,
		chart.meta.key ? `Key: ${chart.meta.key}${keySuffix}` : null,
		capo > 0 ? `Capo: ${capo}` : null,
		chart.meta.time ? `Time: ${chart.meta.time}` : null,
		chart.meta.tempo ? `Tempo: ${chart.meta.tempo}` : null
	].filter((p): p is string => p !== null);
	if (parts.length === 0) return;
	const metaEl = createDiv({ cls: "sb-chart-meta", text: parts.join("  ·  ") });
	const title = chartEl.querySelector("h1.title");
	if (title) title.after(metaEl);
	else chartEl.prepend(metaEl);
}

/** The song's roadmap as a row of chips: V1 PC C V2 ... */
export function appendFormStrip(chartEl: HTMLElement, form: string): void {
	const tokens = parseForm(form);
	if (tokens.length === 0) return;
	const strip = createDiv({ cls: "sb-form-strip" });
	for (const token of tokens) {
		strip.createSpan({ cls: "sb-form-chip", text: shortLabel(token) });
	}
	const meta = chartEl.querySelector(".sb-chart-meta");
	const title = chartEl.querySelector("h1.title");
	if (meta) meta.after(strip);
	else if (title) title.after(strip);
	else chartEl.prepend(strip);
}

// Vault file types the reference-audio player can load (roadmap 2026-07-14).
export const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "ogg", "flac", "webm", "aac", "opus", "3gp"]);

/**
 * Reference audio (roadmap 2026-07-14): an audio property / {audio: ...}
 * directive becomes an inline player for vault files, or a "Listen" link for
 * streaming URLs (Spotify, YouTube, Apple Music). Rehearsal chrome; the
 * performance overlay and print both skip it.
 */
export function appendAudioLine(chartEl: HTMLElement, app: App, sourcePath: string, audio: string): void {
	const wrap = createDiv({ cls: "sb-chart-audio" });
	// Accept a bare path, a [[wikilink]], or a [[wikilink|alias]].
	const value = audio.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();

	if (/^https?:\/\//i.test(value)) {
		const link = wrap.createEl("a", { cls: "sb-audio-link", href: value });
		const icon = link.createSpan({ cls: "sb-audio-icon" });
		setIcon(icon, "play-circle");
		link.createSpan({ text: "Listen: reference audio" });
		link.setAttribute("aria-label", `Open reference audio: ${value}`);
	} else {
		const dest = app.metadataCache.getFirstLinkpathDest(value, sourcePath);
		if (dest && AUDIO_EXTENSIONS.has(dest.extension.toLowerCase())) {
			const player = wrap.createEl("audio", { cls: "sb-audio-player" });
			player.controls = true;
			player.preload = "none";
			player.src = app.vault.getResourcePath(dest);
		} else {
			wrap.createSpan({
				cls: "sb-audio-missing",
				text: dest ? `Not an audio file: ${value}` : `Audio not found: ${value}`
			});
		}
	}
	placeAfterTitle(chartEl, wrap);
}

/** Fingering diagram for each unique chord, in first-use order. */
export function appendDiagramStrip(chartEl: HTMLElement, displaySource: string): void {
	const symbols = usedChords(displaySource);
	if (symbols.length === 0) return;
	const strip = createDiv({ cls: "sb-chart-diagrams" });
	for (const symbol of symbols) {
		const dbChord = findChord(symbol);
		if (!dbChord || dbChord.positions.length === 0) continue;
		const cell = strip.createDiv({ cls: "sb-strip-cell" });
		cell.createDiv({ cls: "sb-strip-name", text: symbol });
		const diagramEl = cell.createDiv({ cls: "sb-diagram sb-strip-diagram" });
		drawDiagram(diagramEl, positionToDiagram(symbol, dbChord.positions[0]));
	}
	if (strip.childElementCount === 0) return;
	placeAfterTitle(chartEl, strip);
}

// --- full pipeline (setlist + performance) ----------------------------------

export interface SongChartOptions {
	/** Extra semitones on top of any key override. */
	offset?: number;
	/** Setlist performance key tonic ("G"); transposes from the song key. */
	targetKey?: string | null;
	nashville?: boolean;
	lyricsOnly?: boolean;
	/** With a capo set, display the chord shapes a player fingers. */
	shapes?: boolean;
	/** Expand the {form: ...} roadmap; defaults to true when a form exists. */
	useForm?: boolean;
	/** Font size percent. */
	zoom?: number;
	showDiagrams?: boolean;
	showFormStrip?: boolean;
	/** Reference audio line; performance mode turns it off (stage, not rehearsal). */
	showAudio?: boolean;
	/** Make chord symbols tappable (opens the fingering dock). */
	onChordClick?: (symbol: string) => void;
	/** False when a newer view render superseded this async render. */
	isCurrent?: () => boolean;
}

/** Delegated click handler: tapping a chord symbol in a chart reports it. */
export function attachChordClicks(chartEl: HTMLElement, onChord: (symbol: string) => void): void {
	chartEl.addClass("sb-chords-clickable");
	chartEl.addEventListener("click", (evt) => {
		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;
		const chordEl = target.closest(".chord");
		if (!chordEl || !chartEl.contains(chordEl)) return;
		const symbol = chordEl.textContent?.trim();
		if (symbol) onChord(symbol);
	});
}

export interface RenderedSong {
	el: HTMLElement;
	chart: Chart;
	capo: number;
	form: string | null;
	/** The song's own autoscroll speed from {autoscroll: N}, or null. */
	autoscroll: number | null;
}

/** Render one song file as a chart element appended to container. */
export async function renderSongInto(
	container: HTMLElement,
	app: App,
	owner: Component,
	file: TFile,
	opts: SongChartOptions = {}
): Promise<RenderedSong | null> {
	if (opts.isCurrent?.() === false) return null;
	// Order-of-service elements (roadmap 2026-07-14): a linked .pdf or image
	// is a service asset, not a song. PDFs use the CPS page reader so their
	// navigation stays predictable in the setlist and performance views.
	if (isServiceAttachment(file)) {
		const el = container.createDiv({ cls: "sb-chart sb-attachment" });
		if (opts.zoom && opts.zoom !== 100) el.style.fontSize = opts.zoom / 100 + "em";
		el.createEl("h1", { cls: "title", text: file.basename });
		const bodyEl = el.createDiv({ cls: "sb-attachment-body" });
		if (file.extension.toLowerCase() === "pdf") {
			await renderPdfInto(bodyEl, app, file, opts.isCurrent);
			if (opts.isCurrent?.() === false) return null;
		} else {
			bodyEl.createEl("img", { attr: { src: app.vault.getResourcePath(file), alt: file.basename } });
		}
		return {
			el,
			chart: { html: "", meta: { title: file.basename, artist: null, key: null, time: null, tempo: null } },
			capo: 0,
			form: null,
			autoscroll: null
		};
	}

	const raw = await app.vault.cachedRead(file);
	if (opts.isCurrent?.() === false) return null;
	const resolved = applyFrontmatter(raw);

	// A linked Markdown file with no chords at all (order of service, liturgy,
	// prayers, announcements) is not a song: render it as prose instead of
	// pushing it through the chart pipeline (v0.6.0).
	if (file.extension === "md" && usedChords(resolved).length === 0) {
		const el = container.createDiv({ cls: "sb-chart sb-prose" });
		if (opts.zoom && opts.zoom !== 100) el.style.fontSize = opts.zoom / 100 + "em";
		el.createEl("h1", { cls: "title", text: file.basename });
		const bodyEl = el.createDiv({ cls: "sb-prose-body" });
		await MarkdownRenderer.render(app, splitFrontmatter(raw).body, bodyEl, file.path, owner);
		if (opts.isCurrent?.() === false) return null;
		return {
			el,
			chart: { html: "", meta: { title: file.basename, artist: null, key: null, time: null, tempo: null } },
			capo: 0,
			form: null,
			autoscroll: detectAutoscroll(resolved)
		};
	}

	const form = detectForm(resolved);
	let text = form && opts.useForm !== false ? expandForm(resolved) : resolved;

	const key = detectKey(text) ?? undefined;
	const capo = detectCapo(text);
	let semitones = opts.offset ?? 0;
	if (opts.targetKey && key) semitones += semitonesBetween(key.tonic, opts.targetKey);
	if (opts.shapes && capo > 0) semitones -= capo;
	if (semitones !== 0) text = transposeSource(text, semitones, key);

	let displaySource = text;
	if (opts.nashville) displaySource = toNashvilleSource(displaySource);
	const chart = renderChart(displaySource, 0);

	const el = container.createDiv({ cls: "sb-chart" });
	setChartHtml(el, chart.html);
	el.toggleClass("sb-lyrics-only", opts.lyricsOnly === true);
	if (opts.zoom && opts.zoom !== 100) el.style.fontSize = opts.zoom / 100 + "em";
	if (opts.onChordClick) attachChordClicks(el, opts.onChordClick);

	appendMetaLine(el, chart, capo, opts.shapes && capo > 0 ? " (shape chords)" : "");
	const audio = detectAudio(resolved);
	if (audio && opts.showAudio !== false) appendAudioLine(el, app, file.path, audio);
	if (form && opts.useForm !== false && opts.showFormStrip !== false) appendFormStrip(el, form);
	if (opts.showDiagrams && !opts.nashville) appendDiagramStrip(el, displaySource);
	return { el, chart, capo, form, autoscroll: detectAutoscroll(resolved) };
}

// --- continuous-scroll geometry ----------------------------------------------

/**
 * Scroll a container so a child block sits at the top. Uses rects instead of
 * offsetTop: offsetTop measures from the nearest positioned ancestor, which
 * in Obsidian views and the performance overlay is not the scroll container,
 * so offsetTop-based jumps land off by the header height.
 */
export function scrollToBlock(container: HTMLElement, block: HTMLElement, gap = 4): void {
	const containerRect = container.getBoundingClientRect();
	const blockRect = block.getBoundingClientRect();
	container.scrollTop += blockRect.top - containerRect.top - gap;
}

/** Index of the block currently at the top quarter of the viewport. */
export function blockIndexAtTop(container: HTMLElement, selector: string): number {
	const containerRect = container.getBoundingClientRect();
	const threshold = containerRect.top + container.clientHeight * 0.25;
	let current = 0;
	container.querySelectorAll(selector).forEach((block, i) => {
		if (block.getBoundingClientRect().top <= threshold) current = i;
	});
	return current;
}

// --- form chip "you are here" -------------------------------------------------

/**
 * Match each form token, in order, to the rendered block that starts it.
 * Expanded charts emit one block per token: an environment paragraph for
 * verse/chorus/bridge with content, a labeled comment for everything else.
 * Matching is heuristic (class name or leading label text); when any token
 * fails to match, the whole mapping is abandoned so the highlight simply
 * stays off rather than pointing at the wrong section.
 */
function formAnchors(chartEl: HTMLElement, tokens: FormToken[]): HTMLElement[] | null {
	// A paragraph holding nothing but a stage note is a cue, not a section
	// start; matching it would shift every following anchor by one.
	const noteOnly = (c: HTMLElement) =>
		c.querySelector(".sb-stage-note") !== null &&
		c.querySelector(".lyrics, .chord, .label, .comment:not(.sb-stage-note)") === null;
	let candidates = Array.from(chartEl.querySelectorAll<HTMLElement>(".paragraph")).filter((c) => !noteOnly(c));
	if (candidates.length === 0) {
		candidates = Array.from(chartEl.querySelectorAll<HTMLElement>(".comment:not(.sb-stage-note)"));
	}
	const anchors: HTMLElement[] = [];
	let from = 0;
	for (const token of tokens) {
		const label = fullLabel(token).toLowerCase();
		let found = -1;
		for (let i = from; i < candidates.length; i++) {
			const classMatch = token.name !== null && candidates[i].classList.contains(token.name);
			const text = (candidates[i].textContent ?? "").trim().toLowerCase();
			const textMatch = label.length > 0 && text.startsWith(label);
			if (classMatch || textMatch) {
				found = i;
				break;
			}
		}
		if (found === -1) return null;
		anchors.push(candidates[found]);
		from = found + 1;
	}
	return anchors;
}

/**
 * Live "you are here" on the form strip: as the container scrolls past each
 * section, the matching chip lights up. Returns an updater the view should
 * call from its (single, persistent) scroll listener, or null when the chart
 * has no strip or the token-to-block mapping is ambiguous.
 */
export function formHighlighter(
	container: HTMLElement,
	rendered: { el: HTMLElement; form: string | null }
): (() => void) | null {
	if (!rendered.form) return null;
	const strip = rendered.el.querySelector<HTMLElement>(".sb-form-strip");
	if (!strip) return null;
	const chips = Array.from(strip.children).filter((c): c is HTMLElement => c.instanceOf(HTMLElement));
	const tokens = parseForm(rendered.form);
	if (chips.length === 0 || chips.length !== tokens.length) return null;
	const anchors = formAnchors(rendered.el, tokens);
	if (!anchors) return null;

	const update = (): void => {
		if (!strip.isConnected) return;
		const threshold = container.getBoundingClientRect().top + container.clientHeight * 0.25;
		let current = -1;
		for (let i = 0; i < anchors.length; i++) {
			if (anchors[i].getBoundingClientRect().top <= threshold) current = i;
		}
		chips.forEach((chip, i) => chip.toggleClass("is-current", i === current));
	};
	update();
	return update;
}

// --- autoscroll -------------------------------------------------------------

/**
 * Shared autoscroll engine (v0.2.0). Scrolls an element at the plugin's
 * autoscrollSpeed (px/s), scaled by the view's zoom so charts read at the
 * same pace at any text size. Stops at the bottom.
 */
export class Autoscroller {
	active = false;
	private raf = 0;

	constructor(
		private getEl: () => HTMLElement,
		private getSpeed: () => number,
		private onStateChange: () => void
	) {}

	start(): void {
		if (this.active) return;
		this.active = true;
		let last = performance.now();
		const step = (now: number) => {
			if (!this.active) return;
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			const el = this.getEl();
			el.scrollTop += this.getSpeed() * dt;
			if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
				this.stop();
				return;
			}
			this.raf = window.requestAnimationFrame(step);
		};
		this.raf = window.requestAnimationFrame(step);
		this.onStateChange();
	}

	stop(): void {
		const wasActive = this.active;
		this.active = false;
		if (this.raf) window.cancelAnimationFrame(this.raf);
		this.raf = 0;
		if (wasActive) this.onStateChange();
	}

	toggle(): void {
		if (this.active) this.stop();
		else this.start();
	}
}
