// Modals for the roadmap commands: "New song" (title + key prompt),
// "Transpose song to key" (target key picker showing the semitone delta),
// "Set reference audio" (paste a link or pick a vault recording), and the
// "CCLI usage report" period prompt.
import { App, FuzzySuggestModal, Modal, Notice, Setting, SuggestModal, TFile } from "obsidian";
import { KEY_OPTIONS, KeyOption } from "../core/theory";
import { KeySpec, semitonesBetween } from "../core/chordpro";

export interface NewSongResult {
	title: string;
	keyId: string;
}

export class NewSongModal extends Modal {
	private title = "";
	private keyId: string;
	private onSubmit: (result: NewSongResult) => void;

	constructor(app: App, defaultKeyId: string, onSubmit: (result: NewSongResult) => void) {
		super(app);
		this.keyId = defaultKeyId;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.setTitle("New song");
		const { contentEl } = this;

		new Setting(contentEl)
			.setName("Title")
			.addText((text) => {
				text.setPlaceholder("Song title");
				text.onChange((value) => (this.title = value));
				// Enter in the title field submits.
				text.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						this.submit();
					}
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.setName("Key")
			.addDropdown((dropdown) => {
				for (const option of KEY_OPTIONS) {
					dropdown.addOption(option.id, option.label);
				}
				dropdown.setValue(this.keyId);
				dropdown.onChange((value) => (this.keyId = value));
			});

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText("Create").setCta().onClick(() => this.submit());
		});
	}

	private submit(): void {
		if (this.title.trim().length === 0) return;
		this.close();
		this.onSubmit({ title: this.title.trim(), keyId: this.keyId });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Reference audio prompt (roadmap 2026-07-14): built for people new to
 * Obsidian, so nobody has to hand-edit frontmatter. Paste a streaming link
 * OR pick a recording already in the vault; Save writes the property.
 */
export class AudioLinkModal extends Modal {
	private value: string;
	private hadValue: boolean;
	private audioFiles: TFile[];
	private onSubmit: (value: string | null) => void;

	constructor(app: App, current: string | null, audioFiles: TFile[], onSubmit: (value: string | null) => void) {
		super(app);
		this.value = current ?? "";
		this.hadValue = !!current;
		this.audioFiles = audioFiles;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.setTitle("Reference audio");
		const { contentEl } = this;

		contentEl.createDiv({
			cls: "setting-item-description",
			text: "Paste a link (Spotify, YouTube, Apple Music...) or pick a recording from your vault. A play button appears on the song's chart."
		});

		let input: HTMLInputElement | null = null;
		new Setting(contentEl)
			.setName("Link or file")
			.addText((text) => {
				input = text.inputEl;
				text.setPlaceholder("https://... or recording.mp3")
					.setValue(this.value)
					.onChange((value) => (this.value = value));
				text.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						this.submit();
					}
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		if (this.audioFiles.length > 0) {
			new Setting(contentEl)
				.setName("Vault recordings")
				.setDesc("Search the audio files already in your vault.")
				.addButton((btn) => {
					btn.setButtonText("Browse...").onClick(() => {
						new AudioFileSuggestModal(this.app, this.audioFiles, (file) => {
							this.value = file.path;
							if (input) input.value = file.path;
						}).open();
					});
				});
		}

		const buttons = new Setting(contentEl);
		if (this.hadValue) {
			buttons.addButton((btn) => {
				btn.setButtonText("Remove").onClick(() => {
					this.close();
					this.onSubmit(null);
				});
			});
		}
		buttons.addButton((btn) => {
			btn.setButtonText("Save").setCta().onClick(() => this.submit());
		});
	}

	private submit(): void {
		const value = this.value.trim();
		if (value.length === 0) return;
		this.close();
		this.onSubmit(value);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export interface CcliRange {
	from: string;
	to: string;
}

/**
 * CCLI report prompt (v0.7.1): pick the reporting period. Prefilled with the
 * current year so the common case is one click; both fields are plain
 * YYYY-MM-DD text so it works the same on iPad.
 */
export class CcliReportModal extends Modal {
	private from: string;
	private to: string;
	private onSubmit: (range: CcliRange) => void;

	constructor(app: App, from: string, to: string, onSubmit: (range: CcliRange) => void) {
		super(app);
		this.from = from;
		this.to = to;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.setTitle("CCLI usage report");
		const { contentEl } = this;

		contentEl.createDiv({
			cls: "setting-item-description",
			text: "Counts songs across your dated service notes (any note that links songs and has a date, in its properties or its name). Pick the reporting period."
		});

		new Setting(contentEl).setName("From").addText((text) => {
			text.setPlaceholder("2026-01-01")
				.setValue(this.from)
				.onChange((value) => (this.from = value.trim()));
		});

		new Setting(contentEl).setName("To").addText((text) => {
			text.setPlaceholder("2026-12-31")
				.setValue(this.to)
				.onChange((value) => (this.to = value.trim()));
		});

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText("Generate report")
				.setCta()
				.onClick(() => this.submit());
		});
	}

	private submit(): void {
		const iso = /^\d{4}-\d{2}-\d{2}$/;
		if (!iso.test(this.from) || !iso.test(this.to)) {
			new Notice("Dates must be YYYY-MM-DD.");
			return;
		}
		if (this.from > this.to) {
			new Notice("The From date is after the To date.");
			return;
		}
		this.close();
		this.onSubmit({ from: this.from, to: this.to });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class AudioFileSuggestModal extends FuzzySuggestModal<TFile> {
	private files: TFile[];
	private onChoose: (file: TFile) => void;

	constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
		super(app);
		this.files = files;
		this.onChoose = onChoose;
		this.setPlaceholder("Pick a recording...");
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

interface TransposeTarget {
	option: KeyOption;
	semitones: number;
}

export class TransposeKeyModal extends SuggestModal<TransposeTarget> {
	private currentKey: KeySpec;
	private onChoose: (semitones: number) => void;

	constructor(app: App, currentKey: KeySpec, onChoose: (semitones: number) => void) {
		super(app);
		this.currentKey = currentKey;
		this.onChoose = onChoose;
		this.setPlaceholder(`Transpose from ${currentKey.tonic}${currentKey.minor ? "m" : ""} to...`);
	}

	getSuggestions(query: string): TransposeTarget[] {
		const mode = this.currentKey.minor ? "minor" : "major";
		return KEY_OPTIONS.filter((option) => option.mode === mode)
			.map((option) => ({
				option,
				semitones: semitonesBetween(this.currentKey.tonic, option.tonic)
			}))
			.filter((t) => t.option.label.toLowerCase().startsWith(query.toLowerCase()));
	}

	renderSuggestion(target: TransposeTarget, el: HTMLElement): void {
		el.createSpan({ text: target.option.label });
		const delta =
			target.semitones === 0 ? "current key" : target.semitones > 0 ? `+${target.semitones}` : `${target.semitones}`;
		el.createSpan({ cls: "cps-transpose-delta", text: ` (${delta})` });
	}

	onChooseSuggestion(target: TransposeTarget): void {
		if (target.semitones !== 0) this.onChoose(target.semitones);
	}
}
