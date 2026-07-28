// Performance mode: a fullscreen stage display.
// A fullscreen overlay above the whole workspace: dark stage theme, big type,
// screen wake lock, edge tap zones and swipes for prev/next, pedal-friendly
// key handling (page turner pedals send arrow / page keys), autoscroll, and
// both set flows: paged (one song per screen) or continuous (whole set in one
// scroll). Overlay instead of a workspace leaf so Obsidian chrome, ribbons,
// and the mobile toolbar never sit between the player and the chart.
import { Component, Notice, TFile, setIcon } from "obsidian";
import type StageBinderPlugin from "../main";
import { Autoscroller, blockIndexAtTop, formHighlighter, RenderedSong, renderSongInto, scrollToBlock, SetlistEntry } from "./render-song";
import type { PdfPageStepDetail } from "./pdf-reader";
import { buildServiceContext, listSetlistFiles, ServiceContext, ServiceEntry, serviceEntryDuration, serviceEntryTime } from "./service-context";
import { StageChrome } from "./stage-chrome";

/** "note:59, cc:63" -> a set of normalized trigger codes. */
export function parseMidiCodes(codes: string): Set<string> {
	const out = new Set<string>();
	for (const part of codes.split(",")) {
		const m = part.trim().toLowerCase().match(/^(note|cc)\s*:\s*(\d{1,3})$/);
		if (m) out.add(`${m[1]}:${parseInt(m[2], 10)}`);
	}
	return out;
}

export class PerformanceMode {
	private plugin: StageBinderPlugin;
	private overlay: HTMLElement | null = null;
	private contentEl: HTMLElement | null = null;
	private scrollBtnEl: HTMLElement | null = null;
	private scrollIconEl: HTMLElement | null = null;
	private speedEl: HTMLElement | null = null;
	private entries: ServiceEntry[] = [];
	private context: ServiceContext | null = null;
	private chrome: StageChrome | null = null;
	private index = 0;
	private continuous = false;
	/** Live performance column layout, initialized from the Performance setting. */
	private cols = 1;
	private scroller: Autoscroller;
	private wakeLock: WakeLockSentinel | null = null;
	private keyHandler = (evt: KeyboardEvent) => this.onKey(evt);
	private visHandler = () => void this.requestWakeLock();
	private touchStartX = 0;
	private touchStartY = 0;
	private scrollHooked = false;
	/** Per-song {autoscroll: N} speeds and the live +/- adjustment on top. */
	private songSpeeds: Array<number | null> = [];
	private rendered: Array<RenderedSong | null> = [];
	private speedOverride: number | null = null;
	private offsets = new Map<number, number>();
	private nashville = false;
	private lyricsOnly = false;
	private shapes = false;
	private formOn = true;
	private formUpdaters: Array<() => void> = [];
	private midi: MIDIAccess | null = null;
	private lastMidiAt = 0;
	private upNextEl: HTMLElement | null = null;
	/** Invalidate slower open/render work when the stage state changes. */
	private lifecycleGeneration = 0;
	private renderGeneration = 0;
	private renderOwner: Component | null = null;

	constructor(plugin: StageBinderPlugin) {
		this.plugin = plugin;
		this.scroller = new Autoscroller(
			() => this.contentEl ?? document.body,
			() => this.effectiveSpeed() * (this.plugin.settings.performanceZoom / 100),
			() => this.syncScrollUi()
		);
	}

	isOpen(): boolean {
		return this.overlay !== null;
	}

	async open(
		songs: SetlistEntry[],
		index = 0,
		continuous?: boolean,
		source: TFile | null = null,
		startingRow?: number
	): Promise<void> {
		if (songs.length === 0 && !source) return;
		this.close();
		const lifecycle = ++this.lifecycleGeneration;
		this.context = null;
		if (source) {
			try {
				this.context = await buildServiceContext(this.plugin.app, source, this.plugin.getStageFileTypes());
			} catch (err) {
				this.context = null;
				if (songs.length === 0) {
					new Notice(`Could not read service: ${err instanceof Error ? err.message : String(err)}`);
					return;
				}
			}
			if (lifecycle !== this.lifecycleGeneration) return;
		}
		this.entries = this.context?.entries.length ? this.context.entries : songs.map((song, songIndex) => this.soloEntry(song, songIndex));
		if (this.entries.length === 0) {
			new Notice("This service has no list items to perform.");
			return;
		}
		const contextIndex = source && startingRow !== undefined
			? this.entries.findIndex((entry) => entry.line === startingRow)
			: -1;
		this.index = source
			? (contextIndex >= 0 ? contextIndex : 0)
			: Math.max(0, Math.min(index, this.entries.length - 1));
		this.continuous = continuous ?? this.plugin.settings.setlistContinuous;
		this.cols = this.plugin.settings.performanceColumns || this.plugin.settings.chartColumns || 1;
		this.offsets.clear();
		this.nashville = false;
		this.lyricsOnly = false;
		this.shapes = false;
		this.formOn = this.plugin.settings.formDefaultOn;

		const overlay = document.body.createDiv({ cls: "cps-performance" });
		this.overlay = overlay;
		overlay.toggleClass("cps-perf-light", this.plugin.settings.perfTheme === "light");
		this.contentEl = overlay.createEl("main", { cls: "cps-perf-content cps-stage-main" });
		this.chrome = new StageChrome({
			host: overlay,
			main: this.contentEl,
			surface: "performance",
			services: listSetlistFiles(this.plugin.app, this.plugin.settings.setlistsFolder),
			context: this.context,
			currentIndex: this.index,
			title: this.entries[this.index]?.title ?? "Performance",
			position: this.entries.length > 1 ? `${this.index + 1} / ${this.entries.length}` : "",
			cardsSelectable: true,
			onChooseService: (service) => void this.chooseService(service),
			onSelectEntry: (_entry, entryIndex) => void this.selectEntry(entryIndex),
			onExit: () => this.close()
		});
		overlay.prepend(this.chrome.topbar);

		// Hidden header still leaves Escape, swipes, pedals, and the peek
		// button; the header preference persists across shows (v0.6.0).
		overlay.toggleClass("cps-perf-noheader", !this.plugin.settings.perfShowHeader);
		const peek = overlay.createEl("button", { cls: "cps-perf-btn cps-perf-peek" });
		setIcon(peek, "more-horizontal");
		peek.setAttribute("aria-label", "Show controls");
		peek.addEventListener("click", () => {
			overlay.toggleClass("cps-perf-noheader", !overlay.hasClass("cps-perf-noheader"));
		});

		// Up next sits immediately above the performance dock.
		this.upNextEl = overlay.createDiv({ cls: "cps-perf-upnext" });
		this.buildDock(overlay);

		// Edge tap zones: generous touch targets that never cover the text's
		// center reading column.
		const tapPrev = overlay.createDiv({ cls: "cps-perf-tap cps-perf-tap-left" });
		tapPrev.addEventListener("click", () => void this.prev());
		const tapNext = overlay.createDiv({ cls: "cps-perf-tap cps-perf-tap-right" });
		tapNext.addEventListener("click", () => void this.next());

		// Swipe between songs; vertical pans keep native scrolling.
		this.contentEl.addEventListener("touchstart", (evt) => {
			this.touchStartX = evt.touches[0].clientX;
			this.touchStartY = evt.touches[0].clientY;
		}, { passive: true });
		this.contentEl.addEventListener("touchend", (evt) => {
			const dx = evt.changedTouches[0].clientX - this.touchStartX;
			const dy = evt.changedTouches[0].clientY - this.touchStartY;
			if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				if (dx < 0) void this.next();
				else void this.prev();
			}
		}, { passive: true });
		this.contentEl.addEventListener("touchmove", () => this.scroller.stop(), { passive: true });
		this.contentEl.addEventListener("wheel", () => this.scroller.stop(), { passive: true });

		// Capture phase so pedal keys reach us before the editor or hotkeys.
		window.addEventListener("keydown", this.keyHandler, true);
		document.addEventListener("visibilitychange", this.visHandler);
		await this.requestWakeLock();
		if (lifecycle !== this.lifecycleGeneration) return;
		void this.initMidi();
		this.songSpeeds = [];
		this.rendered = [];
		this.speedOverride = null;
		this.syncScrollUi();
		await this.render();
	}

	private soloEntry(song: SetlistEntry, index: number): ServiceEntry {
		const ext = song.file.extension.toLowerCase();
		return {
			kind: "file",
			title: song.file.basename,
			item: { kind: "item", text: song.file.basename, seconds: null, people: [], offsetSeconds: 0, line: song.line ?? index },
			file: song.file,
			fileKind: ext === "pdf" ? "pdf" : ext === "md" || ext === "chordpro" ? "song" : "image",
			key: song.key,
			label: song.label,
			line: song.line ?? index,
			endCol: song.endCol
		};
	}

	private buildDock(overlay: HTMLElement): void {
		const dock = overlay.createEl("nav", { cls: "cps-perf-dock" });
		dock.setAttribute("aria-label", "Performance navigation");
		const navButton = (action: string, icon: string, text: string, label: string, handler: () => void) => {
			const button = dock.createEl("button", { cls: "cps-perf-dock-btn" });
			button.dataset.action = action;
			const iconEl = button.createSpan({ cls: "cps-perf-dock-icon" });
			setIcon(iconEl, icon);
			button.createSpan({ text });
			button.setAttribute("aria-label", label);
			button.addEventListener("click", handler);
			return button;
		};
		navButton("element-prev", "skip-back", "Back", "Previous service element", () => void this.goSong(-1));
		navButton("advance-prev", "chevron-left", "Previous", "Previous by selected advance mode", () => void this.prev());
		this.scrollBtnEl = navButton("autoscroll", "play", "Auto", "Toggle autoscroll", () => this.scroller.toggle());
		this.scrollBtnEl.addClass("cps-scroll-btn");
		this.scrollIconEl = this.scrollBtnEl.querySelector<HTMLElement>(".cps-perf-dock-icon");
		navButton("advance-next", "chevron-right", "Next", "Next by selected advance mode", () => void this.next());
		navButton("element-next", "skip-forward", "Forward", "Next service element", () => void this.goSong(1));
	}

	private async chooseService(source: TFile): Promise<void> {
		const lifecycle = this.lifecycleGeneration;
		try {
			const context = await buildServiceContext(this.plugin.app, source, this.plugin.getStageFileTypes());
			if (lifecycle !== this.lifecycleGeneration || !this.overlay) return;
			if (context.entries.length === 0) {
				new Notice("This service has no list items to perform.");
				return;
			}
			this.context = context;
			this.entries = context.entries;
			this.index = 0;
			this.offsets.clear();
			this.songSpeeds = [];
			this.rendered = [];
			this.speedOverride = null;
			this.scroller.stop();
			this.chrome?.updateContext(context, 0);
			await this.render();
		} catch (err) {
			new Notice(`Could not read service: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async selectEntry(index: number): Promise<void> {
		if (index < 0 || index >= this.entries.length) return;
		if (this.continuous) {
			const block = this.contentEl?.querySelector(`[data-cps-entry="${index}"]`);
			if (block instanceof HTMLElement && this.contentEl) {
				scrollToBlock(this.contentEl, block);
				this.index = index;
				this.syncHeader();
				this.buildTools();
			}
			return;
		}
		this.index = index;
		this.speedOverride = null;
		this.scroller.stop();
		await this.render();
	}

	private buildTools(): void {
		const chrome = this.chrome;
		if (!chrome) return;
		const rendered = this.rendered[this.index];
		const entry = this.entries[this.index];
		chrome.setTools((panel) => {
			const row = (label: string) => {
				const el = panel.createDiv({ cls: "cps-stage-tool-row" });
				el.createSpan({ cls: "cps-stage-tool-label", text: label });
				return el.createDiv({ cls: "cps-stage-tool-actions" });
			};
			const button = (parent: HTMLElement, text: string, label: string, action: () => void, active?: boolean) => {
				const el = parent.createEl("button", { cls: "cps-stage-choice" + (active === true ? " is-active" : ""), text });
				el.setAttribute("aria-label", label);
				if (active !== undefined) el.setAttribute("aria-pressed", String(active));
				el.addEventListener("click", action);
				return el;
			};

			if (entry?.fileKind === "song") {
				const chart = row("Chart");
				button(chart, "−", "Transpose down a semitone", () => void this.adjustOffset(-1));
				chart.createSpan({ cls: "cps-stage-key", text: `Key: ${rendered?.chart.meta.key ?? entry.label ?? "—"}` });
				button(chart, "+", "Transpose up a semitone", () => void this.adjustOffset(1));
				button(chart, "145", "Toggle Nashville numbers", () => { this.nashville = !this.nashville; void this.render(); }, this.nashville);
				button(chart, "Lyrics", "Toggle lyrics-only view", () => { this.lyricsOnly = !this.lyricsOnly; void this.render(); }, this.lyricsOnly);
				if ((rendered?.capo ?? 0) > 0 || rendered?.form || (this.offsets.get(this.index) ?? 0) !== 0) {
					const song = row("Song");
					if ((rendered?.capo ?? 0) > 0) button(song, `Shapes ${rendered!.capo}`, "Toggle capo shapes", () => { this.shapes = !this.shapes; void this.render(); }, this.shapes);
					if (rendered?.form) button(song, "Form", "Toggle declared song form", () => { this.formOn = !this.formOn; void this.render(); }, this.formOn);
					if ((this.offsets.get(this.index) ?? 0) !== 0) button(song, "Reset key", "Reset live transpose", () => void this.setOffset(0));
				}
			}

			const text = row("Text");
			button(text, "A−", "Smaller text", () => void this.setZoom(-10));
			text.createSpan({ cls: "cps-stage-value", text: `${this.plugin.settings.performanceZoom}%` });
			button(text, "A+", "Larger text", () => void this.setZoom(10));

			const columns = row("Columns");
			for (const count of [1, 2, 3]) button(columns, String(count), `${count} column${count === 1 ? "" : "s"}`, () => { this.cols = count; void this.render(); }, this.cols === count);

			const reading = row("Reading");
			button(reading, "Single", "Show one service element", () => void this.setContinuous(false), !this.continuous);
			button(reading, "Continuous", "Show the continuous service", () => void this.setContinuous(true), this.continuous);

			const advance = row("Advance");
			button(advance, "Page", "Advance by page", () => this.setAdvance("page"), this.plugin.settings.perfAdvance === "page");
			button(advance, "Section", "Advance by section", () => this.setAdvance("section"), this.plugin.settings.perfAdvance === "section");
			button(advance, "Element", "Advance by service element", () => this.setAdvance("song"), this.plugin.settings.perfAdvance === "song");

			const auto = row("Autoscroll");
			button(auto, this.scroller.active ? "Pause" : "Auto", "Toggle autoscroll", () => this.scroller.toggle(), this.scroller.active);
			button(auto, "−", "Autoscroll slower", () => this.nudgeAutoscroll(-5));
			this.speedEl = auto.createSpan({ cls: "cps-stage-value", text: String(this.effectiveSpeed()) });
			button(auto, "+", "Autoscroll faster", () => this.nudgeAutoscroll(5));

			const display = row("Display");
			button(display, "Light", "Use light stage theme", () => this.setTheme("light"), this.plugin.settings.perfTheme === "light");
			button(display, "Dark", "Use dark stage theme", () => this.setTheme("dark"), this.plugin.settings.perfTheme === "dark");
		});
	}

	private async adjustOffset(delta: number): Promise<void> {
		await this.setOffset((this.offsets.get(this.index) ?? 0) + delta);
	}

	private async setOffset(value: number): Promise<void> {
		const normalized = ((value % 12) + 12) % 12 === 0 && value !== 0 ? 0 : Math.max(-11, Math.min(11, value));
		if (normalized === 0) this.offsets.delete(this.index);
		else this.offsets.set(this.index, normalized);
		await this.render();
	}

	private async setContinuous(value: boolean): Promise<void> {
		if (this.continuous === value) return;
		this.continuous = value;
		this.scroller.stop();
		await this.render();
	}

	private setAdvance(value: "page" | "section" | "song"): void {
		this.plugin.settings.perfAdvance = value;
		void this.plugin.saveSettings();
		this.buildTools();
	}

	private setTheme(value: "light" | "dark"): void {
		this.plugin.settings.perfTheme = value;
		this.overlay?.toggleClass("cps-perf-light", value === "light");
		void this.plugin.saveSettings();
		this.buildTools();
	}

	close(): void {
		this.lifecycleGeneration++;
		this.renderGeneration++;
		if (!this.overlay) return;
		this.scroller.stop();
		window.removeEventListener("keydown", this.keyHandler, true);
		document.removeEventListener("visibilitychange", this.visHandler);
		void this.wakeLock?.release().catch(() => undefined);
		this.wakeLock = null;
		this.closeMidi();
		this.overlay.remove();
		this.overlay = null;
		this.contentEl = null;
		this.upNextEl = null;
		this.chrome = null;
		this.context = null;
		this.entries = [];
		this.scrollHooked = false;
		this.formUpdaters = [];
		this.renderOwner?.unload();
		this.renderOwner = null;
	}

	// --- MIDI pedals (v0.4.0) --------------------------------------------------

	/**
	 * Pedals in MIDI mode (AirTurn and friends) get page-turn mapping without
	 * HID keyboard quirks. Any note-on or CC press advances, so an unknown
	 * single pedal always works on stage; the codes listed in the "previous"
	 * setting go back instead.
	 */
	private async initMidi(): Promise<void> {
		// iOS WebViews have no Web MIDI; feature-detect and stay quiet.
		if (!this.plugin.settings.midiPedal || typeof navigator.requestMIDIAccess !== "function") return;
		try {
			const midi = await navigator.requestMIDIAccess({ sysex: false });
			if (!this.overlay) return; // permission prompt outlived the performance
			this.midi = midi;
			this.attachMidiInputs();
			midi.onstatechange = () => this.attachMidiInputs();
		} catch {
			// Permission denied or platform without MIDI; pedals still work
			// as keyboards through the keydown handler.
			this.midi = null;
		}
	}

	private attachMidiInputs(): void {
		this.midi?.inputs.forEach((input) => {
			input.onmidimessage = (evt) => this.onMidi(evt);
		});
	}

	private closeMidi(): void {
		if (!this.midi) return;
		this.midi.inputs.forEach((input) => {
			input.onmidimessage = null;
		});
		this.midi.onstatechange = null;
		this.midi = null;
	}

	private onMidi(evt: MIDIMessageEvent): void {
		const data = evt.data;
		if (!data || data.length < 3) return;
		const type = data[0] & 0xf0;
		// Presses only: note-on with velocity, or a CC crossing into "on".
		// Releases (note-off, velocity 0, CC below 64) never page.
		const isNote = type === 0x90 && data[2] > 0;
		const isCc = type === 0xb0 && data[2] >= 64;
		if (!isNote && !isCc) return;
		const now = Date.now();
		if (now - this.lastMidiAt < 250) return;
		this.lastMidiAt = now;
		const code = `${isNote ? "note" : "cc"}:${data[1]}`;
		if (parseMidiCodes(this.plugin.settings.midiPrevCodes).has(code)) void this.prev();
		else void this.next();
	}

	toggleAutoscroll(): void {
		this.scroller.toggle();
	}

	/** Current song's {autoscroll: N} beats the setting; live +/- beats both. */
	private effectiveSpeed(): number {
		return this.speedOverride ?? this.songSpeeds[this.index] ?? this.plugin.settings.autoscrollSpeed;
	}

	nudgeAutoscroll(delta: number): void {
		const next = Math.max(5, Math.min(300, this.effectiveSpeed() + delta));
		if (this.songSpeeds[this.index] != null) {
			this.speedOverride = next;
		} else {
			this.plugin.settings.autoscrollSpeed = next;
			void this.plugin.saveSettings();
		}
		this.syncScrollUi();
	}

	private syncScrollUi(): void {
		if (this.scrollBtnEl) {
			this.scrollBtnEl.toggleClass("is-active", this.scroller.active);
			this.scrollBtnEl.setAttribute("aria-pressed", String(this.scroller.active));
			if (this.scrollIconEl) setIcon(this.scrollIconEl, this.scroller.active ? "pause" : "play");
		}
		this.speedEl?.setText(String(this.effectiveSpeed()));
	}

	private async setZoom(delta: number): Promise<void> {
		const s = this.plugin.settings;
		s.performanceZoom = Math.max(80, Math.min(300, s.performanceZoom + delta));
		await this.plugin.saveSettings();
		await this.render();
	}

	private onKey(evt: KeyboardEvent): void {
		if (!this.overlay) return;
		switch (evt.key) {
			case "Escape":
				if (!this.chrome?.closeTopLayer()) this.close();
				break;
			case "ArrowRight":
			case "ArrowDown":
			case "PageDown":
			case " ":
				void this.next();
				break;
			case "ArrowLeft":
			case "ArrowUp":
			case "PageUp":
				void this.prev();
				break;
			default:
				return;
		}
		evt.preventDefault();
		evt.stopPropagation();
	}

	/**
	 * Pedal semantics follow the perfAdvance setting (v0.6.0). Page (default):
	 * page through the current chart, advance to the next song only from the
	 * bottom. Section: jump label to label, falling back to page behavior at
	 * the edges of a song. Song: always a whole song. Continuous mode is one
	 * long chart, so page/section stepping just scrolls through the set.
	 */
	async next(): Promise<void> {
		const el = this.contentEl;
		if (!el) return;
		const mode = this.plugin.settings.perfAdvance;
		if (mode === "song") {
			await this.goSong(1);
			return;
		}
		const pdf = this.stepPdf(1);
		if (pdf !== null) {
			if (!pdf) await this.goSong(1);
			return;
		}
		if (mode === "section" && this.jumpSection(1)) return;
		const remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
		if (remaining > 4) {
			el.scrollTop += el.clientHeight * 0.85;
			this.trackVisibleSong();
			return;
		}
		if (!this.continuous && this.index < this.entries.length - 1) {
			await this.goSong(1);
		}
	}

	async prev(): Promise<void> {
		const el = this.contentEl;
		if (!el) return;
		const mode = this.plugin.settings.perfAdvance;
		if (mode === "song") {
			await this.goSong(-1);
			return;
		}
		const pdf = this.stepPdf(-1);
		if (pdf !== null) {
			if (!pdf) await this.goSong(-1);
			return;
		}
		if (mode === "section" && this.jumpSection(-1)) return;
		if (el.scrollTop > 4) {
			el.scrollTop -= el.clientHeight * 0.85;
			this.trackVisibleSong();
			return;
		}
		if (!this.continuous && this.index > 0) {
			await this.goSong(-1);
		}
	}

	/**
	 * Header section arrows (roadmap 2026-07-15): step section header to
	 * section header; when this element has no section left in that
	 * direction, cross to the neighboring element. Pedals, taps, and swipes
	 * keep following the perfAdvance setting via next()/prev().
	 */
	async nextSection(): Promise<void> {
		const pdf = this.stepPdf(1);
		if (pdf !== null) {
			if (!pdf) await this.goSong(1);
			return;
		}
		if (this.jumpSection(1)) return;
		await this.goSong(1);
	}

	async prevSection(): Promise<void> {
		const pdf = this.stepPdf(-1);
		if (pdf !== null) {
			if (!pdf) await this.goSong(-1);
			return;
		}
		if (this.jumpSection(-1)) return;
		await this.goSong(-1);
	}

	/** Page the current PDF before crossing to another service element. */
	private stepPdf(delta: -1 | 1): boolean | null {
		if (this.continuous) return null;
		const reader = this.contentEl?.querySelector<HTMLElement>(".cps-pdf-reader");
		if (!reader) return null;
		const detail: PdfPageStepDetail = { delta, found: false, moved: false };
		reader.dispatchEvent(new CustomEvent<PdfPageStepDetail>("cps-pdf-page", { detail }));
		return detail.found ? detail.moved : null;
	}

	/** Jump to the neighboring song: re-render in paged mode, scroll to the
	 * song block in continuous mode. */
	private async goSong(delta: number): Promise<void> {
		if (this.continuous) {
			const el = this.contentEl;
			if (!el) return;
			const target = Math.max(0, Math.min(this.entries.length - 1, this.index + delta));
			const block = el.querySelector(`[data-cps-entry="${target}"]`);
			if (block instanceof HTMLElement) {
				scrollToBlock(el, block);
				this.trackVisibleSong();
			}
			return;
		}
		const next = this.index + delta;
		if (next < 0 || next >= this.entries.length) return;
		this.index = next;
		this.speedOverride = null;
		this.scroller.stop();
		await this.render();
	}

	/** Scroll to the next/previous section label; false at a song's edges so
	 * the caller can fall back to page-or-song stepping. */
	private jumpSection(dir: 1 | -1): boolean {
		const el = this.contentEl;
		if (!el) return false;
		// Stage notes are comments too, but cues, not section boundaries.
		// Element titles count as anchors so continuous-mode section stepping
		// lands on prose elements (liturgy, prayers) that have no sections.
		const anchors = Array.from(
			el.querySelectorAll<HTMLElement>(".label, .comment:not(.cps-stage-note), .cps-chart h1.title, .cps-service-card-title")
		);
		if (anchors.length === 0) return false;
		const top = el.getBoundingClientRect().top;
		if (dir > 0) {
			for (const anchor of anchors) {
				if (anchor.getBoundingClientRect().top - top > 8) {
					scrollToBlock(el, anchor);
					this.trackVisibleSong();
					return true;
				}
			}
		} else {
			for (let i = anchors.length - 1; i >= 0; i--) {
				if (anchors[i].getBoundingClientRect().top - top < -8) {
					scrollToBlock(el, anchors[i]);
					this.trackVisibleSong();
					return true;
				}
			}
		}
		return false;
	}

	private async render(): Promise<void> {
		const generation = ++this.renderGeneration;
		const content = this.contentEl;
		if (!content) return;
		const isCurrent = () => generation === this.renderGeneration && this.contentEl === content;
		this.renderOwner?.unload();
		this.renderOwner = new Component();
		this.renderOwner.load();
		content.empty();
		const zoom = this.plugin.settings.performanceZoom;

		this.formUpdaters = [];
		if (!this.scrollHooked) {
			this.scrollHooked = true;
			content.addEventListener(
				"scroll",
				() => {
					this.trackVisibleSong();
					for (const update of this.formUpdaters) update();
				},
				{ passive: true }
			);
		}

		const settings = this.plugin.settings;
		const opts = {
			useForm: this.formOn,
			showFormStrip: settings.formStripPerformance,
			zoom,
			showDiagrams: false,
			nashville: this.nashville,
			lyricsOnly: this.lyricsOnly,
			shapes: this.shapes,
			// The stage shows the chart; reference audio is rehearsal chrome.
			showAudio: false
		};
		const applyCols = (el: HTMLElement) => {
			el.toggleClass("cps-cols-2", this.cols === 2);
			el.toggleClass("cps-cols-3", this.cols === 3);
		};

		if (this.continuous) {
			for (let i = 0; i < this.entries.length; i++) {
				const block = content.createDiv({ cls: "cps-perf-song" });
				block.setAttribute("data-cps-entry", String(i));
				const rendered = await this.renderEntry(block, this.entries[i], i, opts, isCurrent);
				if (!isCurrent()) return;
				this.rendered[i] = rendered;
				if (rendered) {
					applyCols(rendered.el);
					this.songSpeeds[i] = rendered.autoscroll;
					const updater = settings.formHighlight ? formHighlighter(content, rendered) : null;
					if (updater) this.formUpdaters.push(updater);
				} else {
					this.songSpeeds[i] = null;
				}
			}
			const target = content.querySelector(`[data-cps-entry="${this.index}"]`);
			if (target instanceof HTMLElement && this.index > 0) scrollToBlock(content, target);
		} else {
			const rendered = await this.renderEntry(content, this.entries[this.index], this.index, opts, isCurrent);
			if (!isCurrent()) return;
			this.rendered[this.index] = rendered;
			if (rendered) {
				applyCols(rendered.el);
				this.songSpeeds[this.index] = rendered.autoscroll;
				const updater = settings.formHighlight ? formHighlighter(content, rendered) : null;
				if (updater) this.formUpdaters.push(updater);
			} else {
				this.songSpeeds[this.index] = null;
			}
			content.scrollTop = 0;
		}
		this.syncScrollUi();
		this.syncHeader();
		this.buildTools();
	}

	private async renderEntry(
		container: HTMLElement,
		entry: ServiceEntry,
		index: number,
		opts: Omit<Parameters<typeof renderSongInto>[4], "offset" | "targetKey" | "isCurrent">,
		isCurrent: () => boolean
	): Promise<RenderedSong | null> {
		if (entry.kind === "card" || !entry.file) {
			const card = container.createEl("article", { cls: "cps-service-card" });
			card.createDiv({ cls: "cps-service-card-time", text: this.context ? serviceEntryTime(this.context, entry) : "" });
			card.createEl("h1", { cls: "cps-service-card-title", text: entry.title });
			card.createDiv({ cls: "cps-service-card-meta", text: [entry.item.people.join(", "), serviceEntryDuration(entry)].filter(Boolean).join(" · ") });
			return null;
		}
		if (!this.renderOwner) return null;
		return renderSongInto(container, this.plugin.app, this.renderOwner, entry.file, {
			...opts,
			offset: this.offsets.get(index) ?? 0,
			targetKey: entry.key,
			isCurrent
		});
	}

	private trackVisibleSong(): void {
		if (!this.continuous || !this.contentEl) return;
		const current = blockIndexAtTop(this.contentEl, "[data-cps-entry]");
		if (current !== this.index) {
			this.index = current;
			// Speed follows the song under the needle; a live +/- adjustment
			// was for the previous song.
			this.speedOverride = null;
			this.syncHeader();
			this.syncScrollUi();
			this.buildTools();
		}
	}

	private syncHeader(): void {
		const entry = this.entries[this.index];
		if (!entry) return;
		const label = entry.label ? ` (${entry.label})` : "";
		this.chrome?.updateHeader(entry.title + label, this.entries.length > 1 ? `${this.index + 1} / ${this.entries.length}` : "");
		this.chrome?.updateCurrent(this.index);
		this.overlay?.querySelectorAll<HTMLButtonElement>("[data-action='element-prev']").forEach((button) => { button.disabled = this.index === 0; });
		this.overlay?.querySelectorAll<HTMLButtonElement>("[data-action='element-next']").forEach((button) => { button.disabled = this.index === this.entries.length - 1; });
		this.syncUpNext();
	}

	/**
	 * Up next strip (roadmap 2026-07-14): when the set comes from a note that
	 * parses as a run sheet, show the next service element with its planned
	 * clock time and length ("10:05  Next: Communion (3:00)"). Plain setlists
	 * fall back to the next song's name. Off via the perfUpNext setting.
	 */
	private syncUpNext(): void {
		const el = this.upNextEl;
		if (!el) return;
		const show = this.plugin.settings.perfUpNext && this.entries.length > 1;
		el.toggleClass("cps-hidden", !show);
		if (!show) return;
		el.empty();

		const next = this.entries[this.index + 1];
		if (next) {
			if (this.context) el.createSpan({ cls: "cps-perf-upnext-clock", text: serviceEntryTime(this.context, next) });
			const length = serviceEntryDuration(next);
			el.createSpan({ cls: "cps-perf-upnext-text", text: `Next: ${next.title}${length ? ` (${length})` : ""}` });
		} else {
			el.createSpan({ cls: "cps-perf-upnext-text", text: "Last item" });
		}
	}

	private async requestWakeLock(): Promise<void> {
		const overlay = this.overlay;
		if (!overlay || document.hidden) return;
		if (!("wakeLock" in navigator)) return;
		try {
			const sentinel = await navigator.wakeLock.request("screen");
			if (this.overlay !== overlay) {
				await sentinel.release().catch(() => undefined);
				return;
			}
			this.wakeLock = sentinel;
		} catch {
			// Battery saver or platform policy can refuse; performance mode
			// still works, the screen just follows the system sleep setting.
			this.wakeLock = null;
		}
	}
}
