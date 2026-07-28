// Import UIs: "Import songs from files..." (v0.2.0) and Smart Paste (v0.3.0).
// Smart Paste is the universal website path: copy a chart on SongSelect,
// Ultimate Guitar, PraiseCharts or anywhere else, run one command, get a song
// note. No site logins, no scraping, works on iPad through the clipboard.
import { Modal, Notice, Setting, TFile, TFolder } from "obsidian";
import type StageBinderPlugin from "../main";
import {
	convertPastedChart,
	importAsChordpro,
	importAsMarkdown,
	parseImportedSong,
	ParsedImport,
	songLibraryFolderForExtension
} from "../core/import";

function sanitizeTitle(title: string): string {
	return title.replace(/[\\/:#^[\]|?*]/g, "").trim() || "Untitled song";
}

async function ensureFolder(plugin: StageBinderPlugin, folder: string): Promise<void> {
	if (!folder) return;
	let current = "";
	for (const segment of folder.split("/")) {
		current = current ? `${current}/${segment}` : segment;
		const existing = plugin.app.vault.getAbstractFileByPath(current);
		if (existing instanceof TFile) throw new Error(`Song folder path is a file: ${current}`);
		if (!(existing instanceof TFolder)) await plugin.app.vault.createFolder(current);
	}
}

function uniquePath(plugin: StageBinderPlugin, folder: string, base: string, ext: string): string {
	const prefix = folder ? folder + "/" : "";
	let path = `${prefix}${base}.${ext}`;
	let n = 1;
	while (plugin.app.vault.getAbstractFileByPath(path)) {
		n++;
		path = `${prefix}${base} ${n}.${ext}`;
	}
	return path;
}

// --- Import songs from files (v0.2.0) ---------------------------------------

export class ImportSongsModal extends Modal {
	private plugin: StageBinderPlugin;
	private files: File[] = [];
	private folder: string;
	private format: "md" | "chordpro" = "md";
	private statusEl: HTMLElement | null = null;

	constructor(plugin: StageBinderPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.folder = plugin.settings.songsFolder || "Songs";
	}

	onOpen(): void {
		this.setTitle("Import songs");
		const { contentEl } = this;

		contentEl.createEl("p", {
			cls: "cps-import-hint",
			text: "Pick ChordPro or plain-text chart files (.txt, .cho, .chordpro, .pro, .crd). Title and key are read from directives, or from filenames like my-song-chordpro-G.txt."
		});

		const picker = contentEl.createEl("input", { type: "file", cls: "cps-import-input" });
		picker.setAttribute("multiple", "multiple");
		picker.setAttribute("accept", ".txt,.cho,.chordpro,.pro,.crd,.chopro");
		const count = contentEl.createDiv({ cls: "cps-import-count", text: "No files selected." });
		picker.addEventListener("change", () => {
			this.files = Array.from(picker.files ?? []);
			count.setText(this.files.length === 0 ? "No files selected." : `${this.files.length} file(s) selected.`);
		});

		new Setting(contentEl).setName("Songs root folder").setDesc("The output format is routed into its Text or ChordPro subfolder.").addText((text) => {
			text.setValue(this.folder).onChange((v) => (this.folder = v.trim().replace(/^\/+|\/+$/g, "")));
		});

		new Setting(contentEl).setName("Create as").addDropdown((dropdown) => {
			dropdown.addOption("md", "Markdown notes (frontmatter metadata)");
			dropdown.addOption("chordpro", ".chordpro files");
			dropdown.setValue(this.format);
			dropdown.onChange((v) => (this.format = v === "chordpro" ? "chordpro" : "md"));
		});

		this.statusEl = contentEl.createDiv({ cls: "cps-import-status" });

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText("Import").setCta().onClick(() => void this.runImport());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async runImport(): Promise<void> {
		if (this.files.length === 0) {
			new Notice("Select files to import first.");
			return;
		}
		const folder = songLibraryFolderForExtension(this.folder, this.format === "md" ? "md" : "chordpro");
		await ensureFolder(this.plugin, folder);

		let created = 0;
		let skipped = 0;
		let failed = 0;
		for (const file of this.files) {
			try {
				const text = await file.text();
				const parsed = parseImportedSong(file.name, text);
				const base = sanitizeTitle(parsed.title);
				const path = `${folder}/${base}.${this.format === "md" ? "md" : "chordpro"}`;
				if (this.app.vault.getAbstractFileByPath(path)) {
					skipped++;
					continue;
				}
				const out = this.format === "md" ? importAsMarkdown(parsed) : importAsChordpro(parsed);
				await this.app.vault.create(path, out);
				created++;
			} catch (err) {
				console.error("Stage Binder: import failed for", file.name, err);
				failed++;
			}
		}

		let msg = `Imported ${created} song${created === 1 ? "" : "s"} into ${folder}.`;
		if (skipped > 0) msg += ` ${skipped} skipped (already exist).`;
		if (failed > 0) msg += ` ${failed} failed (see console).`;
		this.statusEl?.setText(msg);
		new Notice(msg);
	}
}

// --- Smart Paste (v0.3.0) ----------------------------------------------------

export class SmartPasteModal extends Modal {
	private plugin: StageBinderPlugin;
	private raw = "";
	private title = "";
	private artist = "";
	private key = "";
	private folder: string;
	private format: "md" | "chordpro" = "md";
	private textarea: HTMLTextAreaElement | null = null;
	private titleInput: HTMLInputElement | null = null;
	private artistInput: HTMLInputElement | null = null;
	private keyInput: HTMLInputElement | null = null;
	private statusEl: HTMLElement | null = null;
	private detectTimer = 0;

	constructor(plugin: StageBinderPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.folder = plugin.settings.songsFolder || "Songs";
	}

	onOpen(): void {
		this.setTitle("Smart paste song");
		const { contentEl } = this;

		contentEl.createEl("p", {
			cls: "cps-import-hint",
			text: "Copy a chart from SongSelect, Ultimate Guitar, PraiseCharts or anywhere else, then paste it here. Chords over lyrics, [Verse] markers, key lines and CCLI numbers convert to ChordPro automatically."
		});

		this.textarea = contentEl.createEl("textarea", {
			cls: "cps-paste-area",
			attr: { rows: "10", placeholder: "Paste the chart here..." }
		});
		this.textarea.addEventListener("input", () => {
			this.raw = this.textarea?.value ?? "";
			// Debounced: conversion walks every line against the chord db and
			// a big paste should not re-convert on each keystroke.
			window.clearTimeout(this.detectTimer);
			this.detectTimer = window.setTimeout(() => this.detect(), 250);
		});

		new Setting(contentEl).setName("Title").addText((text) => {
			this.titleInput = text.inputEl;
			text.onChange((v) => (this.title = v));
		});
		new Setting(contentEl).setName("Artist").addText((text) => {
			this.artistInput = text.inputEl;
			text.onChange((v) => (this.artist = v));
		});
		new Setting(contentEl).setName("Key").addText((text) => {
			this.keyInput = text.inputEl;
			text.setPlaceholder("E, F#m, Bb...");
			text.onChange((v) => (this.key = v));
		});
		new Setting(contentEl).setName("Songs root folder").setDesc("The output format is routed into its Text or ChordPro subfolder.").addText((text) => {
			text.setValue(this.folder).onChange((v) => (this.folder = v.trim().replace(/^\/+|\/+$/g, "")));
		});
		new Setting(contentEl).setName("Create as").addDropdown((dropdown) => {
			dropdown.addOption("md", "Markdown note (frontmatter metadata)");
			dropdown.addOption("chordpro", ".chordpro file");
			dropdown.setValue(this.format);
			dropdown.onChange((v) => (this.format = v === "chordpro" ? "chordpro" : "md"));
		});

		this.statusEl = contentEl.createDiv({ cls: "cps-import-status" });

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText("Import").setCta().onClick(() => void this.runImport());
		});

		// Prefill from the clipboard when the platform allows it; iPad may
		// ask for permission or refuse, and then pasting by hand still works.
		void navigator.clipboard
			?.readText()
			.then((text) => {
				if (!text || (this.textarea && this.textarea.value.length > 0)) return;
				this.raw = text;
				if (this.textarea) this.textarea.value = text;
				this.detect();
			})
			.catch(() => undefined);
	}

	onClose(): void {
		window.clearTimeout(this.detectTimer);
		this.contentEl.empty();
	}

	private parsed(): ParsedImport {
		const converted = convertPastedChart(this.raw);
		const parsed = parseImportedSong(this.title.trim() || "pasted-song", converted.text);
		if (this.title.trim()) parsed.meta.title = this.title.trim();
		if (this.artist.trim()) parsed.meta.artist = this.artist.trim();
		if (this.key.trim()) parsed.meta.key = this.key.trim();
		parsed.title = parsed.meta.title ?? "Untitled song";
		return parsed;
	}

	private detect(): void {
		if (this.raw.trim().length === 0) return;
		try {
			const converted = convertPastedChart(this.raw);
			const parsed = parseImportedSong("pasted-song", converted.text);
			if (this.titleInput && !this.title && parsed.meta.title && parsed.meta.title !== "Pasted Song") {
				this.title = parsed.meta.title;
				this.titleInput.value = parsed.meta.title;
			}
			if (this.artistInput && !this.artist && parsed.meta.artist) {
				this.artist = parsed.meta.artist;
				this.artistInput.value = parsed.meta.artist;
			}
			if (this.keyInput && !this.key && parsed.meta.key) {
				this.key = parsed.meta.key;
				this.keyInput.value = parsed.meta.key;
			}
			const bits = [
				parsed.meta.title ? `title: ${parsed.meta.title}` : null,
				parsed.meta.key ? `key: ${parsed.meta.key}` : null,
				parsed.meta.ccli ? `CCLI ${parsed.meta.ccli}` : null
			].filter((b) => b !== null);
			this.statusEl?.setText(bits.length > 0 ? `Detected ${bits.join(", ")}.` : "");
		} catch (err) {
			console.error("Stage Binder: smart paste detection failed", err);
		}
	}

	private async runImport(): Promise<void> {
		if (this.raw.trim().length === 0) {
			new Notice("Paste a chart first.");
			return;
		}
		const folder = songLibraryFolderForExtension(this.folder, this.format === "md" ? "md" : "chordpro");
		await ensureFolder(this.plugin, folder);
		const parsed = this.parsed();
		const base = sanitizeTitle(parsed.title);
		const path = uniquePath(this.plugin, folder, base, this.format === "md" ? "md" : "chordpro");
		const out = this.format === "md" ? importAsMarkdown(parsed) : importAsChordpro(parsed);
		const created = await this.app.vault.create(path, out);
		this.close();
		new Notice(`Imported ${path}`);
		if (created instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(created);
		}
	}
}
