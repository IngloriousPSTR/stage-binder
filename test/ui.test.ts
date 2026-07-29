import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TFile, WorkspaceLeaf } from "./ui/obsidian-mock";
import { resetDom } from "./ui/setup-dom";

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function song(path: string): TFile {
	return new TFile(path);
}

function chartText(title: string, lyric: string): string {
	return `{title: ${title}}\n{key: C}\n[C]${lyric}`;
}

function pluginFor(app: any): any {
	return {
		app,
		settings: {
			autoscrollSpeed: 30,
			chartColumns: 1,
			chordTapDock: false,
			diagramPlacement: "off",
			formDefaultOn: true,
			formHighlight: false,
			formStripPerformance: false,
			formStripPreview: false,
			midiPedal: false,
			perfAdvance: "page",
			performanceColumns: 1,
			performanceZoom: 100,
			perfShowHeader: true,
			perfTheme: "dark",
			perfUpNext: true,
			previewColumns: 1,
			setlistContinuous: false,
			includeChordProInStage: true,
			includeMarkdownInStage: true,
			includePdfInStage: true,
			includeImagesInStage: true
		},
		getStageFileTypes() {
			return {
				chordpro: this.settings.includeChordProInStage,
				markdown: this.settings.includeMarkdownInStage,
				pdf: this.settings.includePdfInStage,
				images: this.settings.includeImagesInStage
			};
		},
		enterPerformanceMode: async () => undefined,
		openChordDock: async () => undefined,
		syncToolboxFile: () => undefined,
		saveSettings: async () => undefined
	};
}

function appWithReads(reads: (file: TFile) => Promise<string> | string): any {
	return {
		vault: {
			on: () => null,
			cachedRead: (file: TFile) => Promise.resolve(reads(file)),
			getResourcePath: (file: TFile) => `app://${file.path}`
		},
		metadataCache: {
			getFileCache: () => ({ links: [], embeds: [] }),
			getFirstLinkpathDest: () => null
		},
		workspace: { requestSaveLayout: () => undefined }
	};
}

test("UI harness provides Obsidian DOM helpers", () => {
	resetDom();
	const root = document.body.createDiv({ cls: "sb-chart-view" });
	root.createEl("button", { text: "Perform" });
	assert.equal(root.querySelector("button")?.textContent, "Perform");
});

test("chart view discards a stale song read", async () => {
	resetDom();
	const oldRead = deferred<string>();
	const newRead = deferred<string>();
	const oldSong = song("Songs/Old.md");
	const newSong = song("Songs/New.md");
	const app = appWithReads((file) => (file.path === oldSong.path ? oldRead.promise : newRead.promise));
	const plugin = pluginFor(app);
	const synced: string[] = [];
	plugin.syncToolboxFile = (file: TFile | null) => synced.push(file?.path ?? "");
	const { ChartView } = await import("../src/ui/chart-view");
	const view = new ChartView(new WorkspaceLeaf(app) as never, plugin);
	document.body.append(view.contentEl);

	const oldRender = view.setFile(oldSong as never);
	const newRender = view.setFile(newSong as never);
	newRead.resolve(chartText("Current Song", "current lyric"));
	await newRender;
	oldRead.resolve(chartText("Old Song", "stale lyric"));
	await oldRender;

	assert.match(view.contentEl.textContent ?? "", /current lyric/);
	assert.doesNotMatch(view.contentEl.textContent ?? "", /stale lyric/);
	assert.equal(view.contentEl.querySelectorAll(".sb-stage-topbar-preview").length, 1);
	assert.equal(view.contentEl.querySelectorAll(".sb-perf-dock").length, 0);
	assert.deepEqual(synced, [oldSong.path, newSong.path]);
});

test("setlist view discards a stale reload", async () => {
	resetDom();
	const oldRead = deferred<string>();
	const newRead = deferred<string>();
	const oldSet = song("Sets/Old Set.md");
	const newSet = song("Sets/New Set.md");
	const oldSong = song("Songs/Old Song.md");
	const newSong = song("Songs/New Song.md");
	const destinations = new Map([
		["Old Song", oldSong],
		["New Song", newSong]
	]);
	const ref = (name: string) => ({
		link: name,
		position: { start: { offset: 0, line: 0, col: 0 }, end: { offset: name.length + 4, line: 0, col: name.length + 4 } }
	});
	const app = appWithReads((file) => {
		if (file.path === oldSet.path) return oldRead.promise;
		if (file.path === newSet.path) return newRead.promise;
		if (file.path === oldSong.path) return chartText("Old Song", "stale set lyric");
		return chartText("Current Song", "current set lyric");
	});
	app.metadataCache.getFileCache = (file: TFile) => ({
		links: [ref(file.path === oldSet.path ? "Old Song" : "New Song")],
		embeds: []
	});
	app.metadataCache.getFirstLinkpathDest = (name: string) => destinations.get(name) ?? null;
	const plugin = pluginFor(app);
	const { SetlistView } = await import("../src/ui/setlist-view");
	const view = new SetlistView(new WorkspaceLeaf(app) as never, plugin);
	document.body.append(view.contentEl);

	const oldReload = view.setFile(oldSet as never);
	const newReload = view.setFile(newSet as never);
	newRead.resolve("[[New Song]]");
	await newReload;
	oldRead.resolve("[[Old Song]]");
	await oldReload;

	assert.equal(view.songs[0]?.file.path, newSong.path);
	assert.match(view.contentEl.textContent ?? "", /current set lyric/);
	assert.doesNotMatch(view.contentEl.textContent ?? "", /stale set lyric/);
});

test("service context and shared chrome preserve the complete service order", async () => {
	resetDom();
	const service = song("Setlists/2026/2026-07-26 Service.md");
	const older = song("Setlists/2026/2026-07-19 Service.md");
	const outside = song("Planning/Service.md");
	const chart = song("Songs/Amazing Grace.chordpro");
	const reading = song("Readings/Prayer.md");
	const score = song("Scores/Anthem.pdf");
	const slide = song("Slides/Welcome.png");
	const source = [
		"---",
		"start: 10:00 AM",
		"---",
		"## Gathering",
		"- Welcome @Heidi (2 min)",
		"- [[Amazing Grace]] in G @Band (3 min)",
		"- [[Prayer]] @Reader (4 min)",
		"- ![[Anthem]] @Piano (5 min)",
		"- ![[Welcome]] @Media (1 min)"
	].join("\n");
	const linked = new Map([
		["Amazing Grace", chart],
		["Prayer", reading],
		["Anthem", score],
		["Welcome", slide]
	]);
	const refs = ["Amazing Grace", "Prayer", "Anthem", "Welcome"].map((link, index) => ({
		link,
		position: {
			start: { offset: 100 + index * 30, line: index + 5, col: 2 },
			end: { offset: 110 + index * 30, line: index + 5, col: link.length + 6 }
		}
	}));
	const app = appWithReads((file) => {
		if (file.path === service.path) return source;
		if (file.path === chart.path) return chartText("Amazing Grace", "Amazing grace");
		if (file.path === reading.path) return "# Prayer\n\nLet us pray.";
		return "";
	});
	app.vault.getMarkdownFiles = () => [outside, older, service];
	app.metadataCache.getFileCache = (file: TFile) => file.path === service.path ? { links: refs, embeds: [] } : { links: [], embeds: [] };
	app.metadataCache.getFirstLinkpathDest = (name: string) => linked.get(name) ?? null;

	const { buildServiceContext, listSetlistFiles } = await import("../src/ui/service-context");
	const context = await buildServiceContext(app, service as never);
	assert.deepEqual(context.entries.map((entry) => entry.kind), ["card", "file", "file", "file", "file"]);
	assert.deepEqual(context.entries.map((entry) => entry.fileKind), [null, "song", "prose", "pdf", "image"]);
	assert.equal(context.rows[0].kind, "divider");
	assert.equal(context.entries[0].item.people[0], "Heidi");
	assert.equal(context.entries[1].label, "G");
	assert.deepEqual(listSetlistFiles(app, "Setlists").map((file) => file.path), [service.path, older.path]);

	const filtered = await buildServiceContext(app, service as never, {
		chordpro: true,
		markdown: false,
		pdf: false,
		images: true
	});
	assert.deepEqual(filtered.entries.map((entry) => entry.kind), ["card", "file", "card", "card", "file"]);
	assert.deepEqual(filtered.entries.map((entry) => entry.fileKind), [null, "song", null, null, "image"]);
	assert.equal(filtered.rows[0].kind, "divider");
	const cardsOnly = await buildServiceContext(app, service as never, {
		chordpro: false,
		markdown: false,
		pdf: false,
		images: false
	});
	assert.ok(cardsOnly.entries.every((entry) => entry.kind === "card" && entry.file === null));

	const { StageChrome } = await import("../src/ui/stage-chrome");
	const host = document.body.createDiv();
	const main = host.createEl("main");
	const selected: number[] = [];
	const chrome = new StageChrome({
		host,
		main,
		surface: "preview",
		services: [service as never],
		context,
		currentIndex: 1,
		title: "Amazing Grace",
		cardsSelectable: false,
		onChooseService: () => undefined,
		onSelectEntry: (_entry, index) => selected.push(index)
	});
	chrome.setTools((panel) => panel.createEl("button", { text: "Tool" }));
	const order = host.querySelector<HTMLButtonElement>('button[aria-label="Open order of service"]')!;
	order.focus();
	order.click();
	const orderDrawer = host.querySelector<HTMLElement>('[aria-label="Order of service"]')!;
	assert.equal(order.getAttribute("aria-expanded"), "true");
	assert.equal(orderDrawer.getAttribute("aria-hidden"), "false");
	assert.equal(main.inert, true);
	assert.equal(orderDrawer.querySelectorAll(".sb-stage-drawer-row").length, 5);
	assert.equal(orderDrawer.querySelectorAll<HTMLButtonElement>(".sb-stage-drawer-row:disabled").length, 1);
	assert.match(orderDrawer.textContent ?? "", /Heidi/);

	const songs = host.querySelector<HTMLButtonElement>('button[aria-label="Open song set"]')!;
	songs.click();
	const songsDrawer = host.querySelector<HTMLElement>('[aria-label="Song set"]')!;
	assert.equal(orderDrawer.getAttribute("aria-hidden"), "true");
	assert.equal(songsDrawer.getAttribute("aria-hidden"), "false");
	assert.equal(songsDrawer.querySelectorAll(".sb-stage-drawer-row").length, 4);
	assert.match(songsDrawer.textContent ?? "", /pdf/i);
	assert.match(songsDrawer.textContent ?? "", /image/i);
	assert.equal(chrome.closeTopLayer(), true);
	assert.equal(main.inert, false);
	assert.equal(songsDrawer.getAttribute("aria-hidden"), "true");
	assert.deepEqual(selected, []);
	host.remove();

	const { ChartView } = await import("../src/ui/chart-view");
	const preview = new ChartView(new WorkspaceLeaf(app) as never, pluginFor(app));
	document.body.append(preview.contentEl);
	await preview.setFile(chart as never, service as never);
	assert.equal(preview.getState().servicePath, service.path);
	preview.contentEl.querySelector<HTMLButtonElement>('button[aria-label="Open tools"]')!.click();
	preview.contentEl.querySelector<HTMLButtonElement>('button[aria-label="Toggle lyrics-only view"]')!.click();
	await settle();
	assert.equal(preview.getState().lyricsOnly, true);
	assert.ok(preview.contentEl.querySelector(".sb-chart.sb-lyrics-only"));
	assert.equal(preview.contentEl.querySelectorAll(".sb-perf-dock").length, 0);
	await preview.onClose();
	preview.contentEl.remove();

	const { PerformanceMode } = await import("../src/ui/performance");
	const mode = new PerformanceMode(pluginFor(app));
	const chartEntry = { file: chart, key: "G", label: "G", line: 5 };
	await mode.open([chartEntry] as never, 0, false, service as never);
	assert.match(document.querySelector(".sb-stage-title")?.textContent ?? "", /Welcome/);
	assert.ok(document.querySelector(".sb-service-card"));
	assert.equal(document.querySelectorAll(".sb-perf-dock-btn").length, 5);
	mode.close();
	await mode.open([chartEntry] as never, 0, false, service as never, 5);
	assert.match(document.querySelector(".sb-stage-title")?.textContent ?? "", /Amazing Grace/);
	assert.match(document.querySelector(".sb-performance")?.textContent ?? "", /Amazing grace/);
	mode.close();
});

test("mixed-format services preserve order and render text and PDFs", async () => {
	resetDom();
	window.localStorage.removeItem("stage-binder-pdf-layout");
	const service = song("Setlists/Testing/Mixed Format Service.md");
	const chart = song("Songs/ChordPro/Chart.chordpro");
	const convertedChart = song("Songs/ChordPro/Converted Text Song.chordpro");
	const spoken = song("Setlists/Testing/Spoken.md");
	const score = song("Songs/PDF/Score/Piano/Score-Piano-G.pdf");
	const source = [
		"---",
		"date: 2026-07-18",
		"---",
		"- [[Chart]] @Band (3 min)",
		"- [[Converted Text Song]] @Band (3 min)",
		"- [[Spoken]] @Leader (2 min)",
		"- [[Score]] @Piano (4 min)"
	].join("\n");
	const files = new Map([
		["Chart", chart],
		["Converted Text Song", convertedChart],
		["Spoken", spoken],
		["Score", score]
	]);
	const refs = ["Chart", "Converted Text Song", "Spoken", "Score"].map((link, index) => ({
		link,
		position: {
			start: { offset: 100 + index * 100, line: index + 3, col: 2 },
			end: { offset: 100 + index * 100 + link.length + 4, line: index + 3, col: link.length + 6 }
		}
	}));
	const app = appWithReads((file) => {
		if (file.path === service.path) return source;
		if (file.path === chart.path) return chartText("Chart", "chordpro lyric");
		if (file.path === convertedChart.path) return chartText("Converted Text Song", "converted text lyric");
		if (file.path === spoken.path) return "# Spoken\n\n## Leader\nWelcome everyone.";
		return "";
	});
	app.vault.readBinary = async () => new Uint8Array([1, 2, 3]).buffer;
	(globalThis as any).__pdfjsMock = {
		getDocument: () => ({
			promise: Promise.resolve({
				numPages: 2,
				getPage: async () => ({
					getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
					render: () => ({ promise: Promise.resolve() })
				})
			})
		})
	};
	app.metadataCache.getFileCache = (file: TFile) => file.path === service.path ? { links: refs, embeds: [] } : { links: [], embeds: [] };
	app.metadataCache.getFirstLinkpathDest = (name: string) => files.get(name) ?? null;

	const { collectSetlistSongs, renderSongInto } = await import("../src/ui/render-song");
	const entries = await collectSetlistSongs(app, service as never);
	assert.deepEqual(entries.map((entry) => entry.file.path), [chart.path, convertedChart.path, spoken.path, score.path]);
	const filteredEntries = await collectSetlistSongs(app, service as never, {
		chordpro: false,
		markdown: false,
		pdf: true,
		images: false
	});
	assert.deepEqual(filteredEntries.map((entry) => entry.file.path), [score.path]);

	const rendered = document.body.createDiv();
	const plugin = pluginFor(app);
	for (const entry of entries) await renderSongInto(rendered, app, plugin, entry.file as never);
	assert.match(rendered.textContent ?? "", /chordpro lyric/);
	assert.match(rendered.textContent ?? "", /converted text lyric/);
	assert.ok(rendered.querySelector(".sb-prose"));
	assert.ok(rendered.querySelector(".sb-attachment"));
	assert.equal(rendered.querySelectorAll(".sb-pdf-page").length, 2);
	const previewReader = rendered.querySelector<HTMLElement>(".sb-pdf-reader")!;
	assert.ok(previewReader.classList.contains("is-vertical"));
	previewReader.querySelector<HTMLButtonElement>(".sb-pdf-layout")!.click();
	assert.ok(previewReader.classList.contains("is-horizontal"));


	const { PerformanceMode } = await import("../src/ui/performance");
	const mode = new PerformanceMode(plugin);
	await mode.open(entries as never, 0, false, service as never);
	const next = document.querySelector<HTMLButtonElement>('[data-action="element-next"]');
	assert.ok(next);
	assert.match(document.querySelector(".sb-stage-title")?.textContent ?? "", /Chart/);
	next.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.match(document.querySelector(".sb-stage-title")?.textContent ?? "", /Converted Text Song/);
	next.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.match(document.querySelector(".sb-stage-title")?.textContent ?? "", /Spoken/);
	next.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.match(document.querySelector(".sb-stage-title")?.textContent ?? "", /Score/);
	assert.ok(document.querySelector(".sb-performance .sb-attachment"));
	assert.ok(document.querySelector(".sb-performance .sb-pdf-reader.is-horizontal"));
	assert.match(document.querySelector(".sb-performance .sb-pdf-status")?.textContent ?? "", /Page 1 of 2/);
	await mode.next();
	assert.match(document.querySelector(".sb-performance .sb-pdf-status")?.textContent ?? "", /Page 2 of 2/);
	mode.close();
});

test("performance mode does not open a ghost overlay from stale work", async () => {
	resetDom();
	const oldSourceRead = deferred<string>();
	const oldSource = song("Sets/Old Service.md");
	const oldSong = song("Songs/Old.md");
	const newSong = song("Songs/New.md");
	const app = appWithReads((file) => {
		if (file.path === oldSource.path) return oldSourceRead.promise;
		if (file.path === oldSong.path) return chartText("Old Song", "stale stage lyric");
		return chartText("Current Song", "current stage lyric");
	});
	const plugin = pluginFor(app);
	const { PerformanceMode } = await import("../src/ui/performance");
	const mode = new PerformanceMode(plugin);
	const entry = (file: TFile) => ({ file, key: null, label: null });

	const oldOpen = mode.open([entry(oldSong) as never], 0, false, oldSource as never);
	const newOpen = mode.open([entry(newSong) as never], 0, false, null);
	await newOpen;
	oldSourceRead.resolve("- [[Old]] (3 min)");
	await oldOpen;

	assert.equal(document.querySelectorAll(".sb-performance").length, 1);
	assert.match(document.body.textContent ?? "", /current stage lyric/);
	mode.close();
});

test("performance mode cycles the live chart column layout", async () => {
	resetDom();
	const file = song("Songs/Columns.md");
	const app = appWithReads(() => chartText("Columns", "column test lyric"));
	const plugin = pluginFor(app);
	const { PerformanceMode } = await import("../src/ui/performance");
	const mode = new PerformanceMode(plugin);
	await mode.open([{ file, key: null, label: null }] as never, 0, false, null);

	const tools = document.querySelector<HTMLButtonElement>('button[aria-label="Open tools"]');
	assert.ok(tools);
	tools.click();
	const button = document.querySelector<HTMLButtonElement>('button[aria-label="2 columns"]');
	assert.ok(button);
	button.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.ok(document.querySelector(".sb-performance .sb-chart.sb-cols-2"));
	mode.close();
});

test("accessibility and narrow-screen CSS contracts remain in the plugin stylesheet", () => {
	const css = readFileSync("styles.css", "utf8");
	assert.match(css, /:focus-visible\s*\{/);
	assert.match(css, /button\.sb-stage-icon-btn\s*>\s*svg\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;/);
	assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*?button\.sb-stage-icon-btn\s*>\s*svg\s*\{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;/);
	assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.sb-chord-dock\s*\{[\s\S]*?transition:\s*none/);
	assert.match(css, /@media\s+screen\s+and\s+\(max-width:\s*700px\)[\s\S]*?\.sb-performance \.sb-perf-columns[\s\S]*?display:\s*none/);
	assert.match(css, /@media\s+screen\s+and\s+\(max-width:\s*700px\)[\s\S]*?\.sb-chart\.sb-cols-2[\s\S]*?\.sb-chart\.sb-cols-3[\s\S]*?column-count:\s*1/);
});

test("plugin settings provide vault folder search and stage file-type controls", () => {
	const settings = readFileSync("src/ui/settings.ts", "utf8");
	const main = readFileSync("src/main.ts", "utf8");
	assert.match(settings, /class FolderSuggest extends AbstractInputSuggest<TFolder>/);
	assert.match(settings, /"Songs folder"/);
	assert.match(settings, /"Setlists folder"/);
	assert.match(settings, /"Stage file types"/);
	for (const label of ["ChordPro", "Markdown", "PDF", "Images"]) {
		assert.match(settings, new RegExp(`stageType\\("${label}"`));
	}
	for (const key of ["includeChordProInStage", "includeMarkdownInStage", "includePdfInStage", "includeImagesInStage"]) {
		assert.match(main, new RegExp(`${key}: true`));
	}
});

test("new Markdown songs use blank form metadata and canonical section labels", () => {
	const main = readFileSync("src/main.ts", "utf8");
	assert.match(main, /"form: ",\s*"---"/);
	assert.match(main, /"\{comment: Verse 1\}"/);
	assert.match(main, /else if \(name === "form"\) fm\[name\] = ""/);
	assert.match(main, /songLibraryFolderForExtension\(this\.settings\.songsFolder, "md"\)/);
	const importer = readFileSync("src/ui/import-modal.ts", "utf8");
	assert.equal((importer.match(/songLibraryFolderForExtension\(this\.folder,/g) ?? []).length, 2);
	assert.match(importer, /Songs root folder[\s\S]*routed into its Text or ChordPro subfolder/);
});

function toolboxPluginFor(app: any, overrides: Record<string, unknown> = {}): any {
	return {
		app,
		settings: {
			lastKeyId: "C-major",
			toolboxOpenSections: ["song", "order"]
		},
		getActiveSongFile: () => null,
		saveSettings: async () => undefined,
		runNewSong: () => undefined,
		runSmartPaste: () => undefined,
		runFormatLyrics: () => undefined,
		runSetAudioLink: () => undefined,
		openChartPreview: async () => undefined,
		enterPerformanceMode: async () => undefined,
		runExportChordpro: () => undefined,
		runExportShareFolder: () => undefined,
		insertSection: () => undefined,
		writeForm: async () => undefined,
		...overrides
	};
}

test("toolbox uses job-based sections and migrates saved disclosure ids", async () => {
	resetDom();
	const app = appWithReads(() => "");
	let saves = 0;
	const plugin = toolboxPluginFor(app, { saveSettings: async () => { saves++; } });
	const { ToolboxView } = await import("../src/ui/toolbox");
	const view = new ToolboxView(new WorkspaceLeaf(app) as never, plugin as never);
	await view.onOpen();
	assert.equal(view.contentEl.querySelectorAll('[role="tab"]').length, 0);
	const sections = Array.from(view.contentEl.querySelectorAll<HTMLDetailsElement>(".sb-toolbox-disclosure"));
	assert.deepEqual(sections.map((section) => section.querySelector("summary")?.textContent), ["Create", "Chart", "Form", "Reference", "Display & output"]);
	assert.deepEqual(sections.map((section) => section.open), [false, true, true, false, false]);
	assert.match(sections[0].textContent ?? "", /New song[\s\S]*Smart paste[\s\S]*Format lyrics/);
	assert.match(sections[1].textContent ?? "", /Key[\s\S]*Sections[\s\S]*Song details/);
	const sectionButtons = Array.from(sections[1].querySelectorAll<HTMLButtonElement>(".sb-snippet-btn"));
	assert.equal(sectionButtons.filter((button) => button.textContent === "Instrumental").length, 1);
	assert.equal(sectionButtons.filter((button) => button.textContent === "Outro").length, 1);
	assert.match(sections[2].textContent ?? "", /roadmap:[\s\S]*Open a song to build its form/);
	assert.match(sections[3].textContent ?? "", /Reference audio[\s\S]*Capo table[\s\S]*Transpose map/);
	assert.match(sections[4].textContent ?? "", /Export chart[\s\S]*Export set/);
	assert.doesNotMatch(sections[4].textContent ?? "", /Publish/);
	sections[3].open = true;
	await settle();
	assert.ok(plugin.settings.toolboxOpenSections.includes("reference"));
	assert.ok(plugin.settings.toolboxOpenSections.includes("chart"));
	assert.ok(!plugin.settings.toolboxOpenSections.includes("song"));
	assert.equal(saves, 1);
});

test("toolbox current chart actions follow the active song", async () => {
	resetDom();
	const file = song("Songs/Grace.md");
	const app = appWithReads(() => "{title: Grace}\n[C]Amazing grace");
	let previews = 0;
	let performances = 0;
	const plugin = toolboxPluginFor(app, {
		settings: { lastKeyId: "C-major", toolboxOpenSections: ["chart"] },
		getActiveSongFile: () => file,
		openChartPreview: async () => { previews++; },
		enterPerformanceMode: async () => { performances++; }
	});
	const { ToolboxView } = await import("../src/ui/toolbox");
	const view = new ToolboxView(new WorkspaceLeaf(app) as never, plugin as never);
	await view.onOpen();

	const current = view.contentEl.querySelector<HTMLElement>(".sb-current-chart")!;
	assert.match(current.textContent ?? "", /Current chart[\s\S]*Grace[\s\S]*Songs/);
	const actions = Array.from(current.querySelectorAll<HTMLButtonElement>(".sb-action-btn"));
	assert.deepEqual(actions.map((button) => button.textContent), ["Preview", "Perform"]);
	assert.ok(actions.every((button) => !button.disabled));
	actions[0].click();
	actions[1].click();
	await settle();
	assert.equal(previews, 1);
	assert.equal(performances, 1);
	await view.refreshForm(null);
	assert.match(current.textContent ?? "", /No song open[\s\S]*Open a song to preview or perform/);
	assert.ok(actions.every((button) => button.disabled));
});

test("form adds comment-labeled sections with direct controls", async () => {
	resetDom();
	const file = song("Songs/Grace.md");
	const written: Array<string | null> = [];
	const app = appWithReads(() => "{title: Grace}\n{comment: Verse 1}\n[C]line one\n{comment: Chorus}\n[G]refrain");
	const plugin = toolboxPluginFor(app, {
		getActiveSongFile: () => file,
		writeForm: async (_file: TFile, value: string | null) => {
			written.push(value);
		}
	});
	const { ToolboxView } = await import("../src/ui/toolbox");
	const view = new ToolboxView(new WorkspaceLeaf(app) as never, plugin as never);
	await view.onOpen();

	const editor = view.contentEl.querySelector<HTMLElement>(".sb-form-editor")!;
	const addButtons = () => Array.from(editor.querySelectorAll<HTMLButtonElement>(".sb-form-add .sb-snippet-btn"));
	assert.deepEqual(addButtons().map((btn) => btn.textContent), ["Add Verse 1", "Add Chorus"]);
	assert.match(editor.textContent ?? "", /Arrange the sections in performance order/);

	addButtons()[0].click();
	await settle();
	addButtons()[1].click();
	await settle();
	addButtons()[1].click();
	await settle();

	const rows = () => Array.from(editor.querySelectorAll<HTMLElement>(".sb-form-row .sb-form-label"));
	assert.deepEqual(rows().map((row) => row.textContent), ["Verse 1", "Chorus", "Chorus"]);
	assert.equal(written[written.length - 1], "V1 C C");
	assert.match(editor.textContent ?? "", /Saved automatically/);
});

test("form rows move and remove without a selection step", async () => {
	resetDom();
	const file = song("Songs/Grace.md");
	const written: Array<string | null> = [];
	const app = appWithReads(() => "{form: V1 C B}\n{comment: Verse 1}\n[C]line\n{comment: Chorus}\n[G]refrain\n{comment: Bridge}\n[Am]lift");
	const plugin = toolboxPluginFor(app, {
		getActiveSongFile: () => file,
		writeForm: async (_file: TFile, value: string | null) => {
			written.push(value);
		}
	});
	const { ToolboxView } = await import("../src/ui/toolbox");
	const view = new ToolboxView(new WorkspaceLeaf(app) as never, plugin as never);
	await view.onOpen();

	const editor = view.contentEl.querySelector<HTMLElement>(".sb-form-editor")!;
	const rows = () => Array.from(editor.querySelectorAll<HTMLElement>(".sb-form-row"));
	assert.deepEqual(rows().map((row) => row.querySelector(".sb-form-label")?.textContent), ["Verse 1", "Chorus", "Bridge"]);
	rows()[0].querySelectorAll<HTMLButtonElement>(".sb-form-row-btn")[1].click();
	await settle();
	assert.deepEqual(rows().map((row) => row.querySelector(".sb-form-label")?.textContent), ["Chorus", "Verse 1", "Bridge"]);
	rows()[1].querySelector<HTMLButtonElement>(".sb-form-remove")!.click();
	await settle();
	assert.deepEqual(rows().map((row) => row.querySelector(".sb-form-label")?.textContent), ["Chorus", "Bridge"]);
	assert.equal(written[written.length - 1], "C B");
});

test("form tab offers section inserts when the song declares no sections", async () => {
	resetDom();
	const file = song("Songs/Sparse.md");
	const inserted: string[] = [];
	const app = appWithReads(() => "{title: Sparse}\nJust lyrics, no sections");
	const plugin = toolboxPluginFor(app, {
		getActiveSongFile: () => file,
		insertSection: (directive: string) => {
			inserted.push(directive);
		}
	});
	const { ToolboxView } = await import("../src/ui/toolbox");
	const view = new ToolboxView(new WorkspaceLeaf(app) as never, plugin as never);
	await view.onOpen();

	const editor = view.contentEl.querySelector<HTMLElement>(".sb-form-editor")!;
	assert.match(editor.textContent ?? "", /no section headers yet/);
	const inserts = Array.from(editor.querySelectorAll<HTMLButtonElement>(".sb-snippet-grid .sb-snippet-btn"));
	assert.deepEqual(inserts.slice(0, 6).map((btn) => btn.textContent), ["Intro", "Verse 1", "Verse 2", "Pre-Chorus", "Chorus", "Bridge"]);
	inserts[1].click();
	assert.deepEqual(inserted, ["{comment: Verse 1}"]);
});

test("form can use detected sections in file order", async () => {
	resetDom();
	const file = song("Songs/Grace.md");
	const written: Array<string | null> = [];
	const app = appWithReads(() => "{comment: Intro}\n[C]music\n{comment: Verse 1}\n[G]line\n{comment: Chorus}\n[F]sing");
	const plugin = toolboxPluginFor(app, {
		getActiveSongFile: () => file,
		writeForm: async (_file: TFile, value: string | null) => written.push(value)
	});
	const { ToolboxView } = await import("../src/ui/toolbox");
	const view = new ToolboxView(new WorkspaceLeaf(app) as never, plugin as never);
	await view.onOpen();
	view.contentEl.querySelector<HTMLButtonElement>(".sb-form-editor .mod-cta")!.click();
	await settle();
	assert.equal(written.at(-1), "In V1 C");
});
