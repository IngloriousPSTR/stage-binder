// Plugin settings tab. Global owns chart appearance; Editor, Preview, and
// Performance contain only behavior specific to those surfaces.
import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from "obsidian";
import type StageBinderPlugin from "../main";
import type { DiagramPlacement } from "../main";
import { renderChart } from "../core/chordpro";
import { setChartHtml } from "./render-song";

const PREVIEW_SOURCE = [
	"{title: Preview}",
	"{key: G}",
	"{comment: Verse 1}",
	"[G]Amazing [G/B]grace, how [C]sweet the [G]sound",
	"That [G]saved a [Em]wretch like [D]me",
	"",
	"{comment: Verse 2}",
	"'Twas [G]grace that taught my [C]heart to [G]fear",
	"And grace my [Em]fears re[D]lieved"
].join("\n");

type TabId = "global" | "editor" | "preview" | "performance";

const TABS: Array<{ id: TabId; label: string }> = [
	{ id: "global", label: "Global" },
	{ id: "editor", label: "Editor" },
	{ id: "preview", label: "Preview" },
	{ id: "performance", label: "Performance" }
];

type ColorKey = "chordColor" | "lyricsColor" | "sectionColor" | "titleColor";
type ViewId = "preview" | "performance";

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, inputEl: HTMLInputElement, private readonly choose: (path: string) => void) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const needle = query.trim().toLocaleLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.filter((folder) => folder.path !== "" && folder.path !== "/")
			.filter((folder) => !needle || folder.path.toLocaleLowerCase().includes(needle))
			.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
			.slice(0, 100);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.choose(folder.path);
	}
}

export class StageBinderSettingTab extends PluginSettingTab {
	private plugin: StageBinderPlugin;
	private activeTab: TabId = "global";

	constructor(plugin: StageBinderPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	private folderSetting(
		containerEl: HTMLElement,
		name: string,
		description: string,
		value: string,
		fallback: string,
		missingMessage: string,
		onChange: (value: string) => Promise<void>
	): void {
		const setting = new Setting(containerEl).setName(name).setDesc(description);
		const warning = setting.descEl.createDiv({ cls: "sb-folder-warning" });
		const normalize = (path: string) => path.trim().replace(/^\/+|\/+$/g, "") || fallback;
		const validate = (path: string) => {
			warning.hidden = this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
			warning.setText(warning.hidden ? "" : missingMessage);
		};
		const commit = async (path: string) => {
			const normalized = normalize(path);
			validate(normalized);
			await onChange(normalized);
		};
		setting.addText((text) => {
			text.setPlaceholder(fallback)
				.setValue(normalize(value))
				.onChange(commit);
			new FolderSuggest(this.app, text.inputEl, (path) => void commit(path));
		});
		validate(normalize(value));
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("sb-settings");

		const bar = containerEl.createDiv({ cls: "sb-settings-tabs" });
		for (const tab of TABS) {
			const btn = bar.createEl("button", {
				cls: "sb-settings-tab" + (tab.id === this.activeTab ? " is-active" : ""),
				text: tab.label
			});
			btn.addEventListener("click", () => {
				this.activeTab = tab.id;
				this.display();
			});
		}

		const body = containerEl.createDiv();
		if (this.activeTab === "global") this.displayGlobal(body);
		else if (this.activeTab === "editor") this.displayEditor(body);
		else if (this.activeTab === "preview") this.displayView(body, "preview");
		else this.displayView(body, "performance");
	}

	/** Live chart preview. */
	private chartPreview(container: HTMLElement, scope: "global" | ViewId): void {
		const preview = container.createDiv({ cls: "sb-settings-preview" });
		if (scope === "performance") {
			preview.addClass("sb-settings-preview-perf");
			if (this.plugin.settings.perfTheme === "light") preview.addClass("sb-perf-light");
		}
		const chart = preview.createDiv({ cls: "sb-chart" });
		setChartHtml(chart, renderChart(PREVIEW_SOURCE, 0).html);
	}

	// --- Global tab -----------------------------------------------------------

	private displayGlobal(containerEl: HTMLElement): void {
		this.chartPreview(containerEl, "global");

		new Setting(containerEl).setName("Chart appearance").setHeading();

		this.colorSetting(containerEl, "Chord color", "Color of chord symbols in charts. Default: theme accent.", "chordColor");
		this.colorSetting(containerEl, "Lyrics color", "Color of lyric lines in charts. Default: theme text.", "lyricsColor");
		this.colorSetting(containerEl, "Section label color", "Color of section labels (Verse 1, Chorus...).", "sectionColor");
		this.colorSetting(containerEl, "Title color", "Color of the song title heading.", "titleColor");

		this.scaleSetting(containerEl, "Chord size", "Chord symbol size relative to the chart text.", "chordScale");
		this.scaleSetting(containerEl, "Lyrics size", "Lyric line size relative to the chart text.", "lyricsScale");

		new Setting(containerEl)
			.setName("Chart font")
			.setDesc("Font family for charts. Leave empty for the theme monospace font. Example: iA Writer Mono, Menlo.")
			.addText((text) => {
				text.setPlaceholder("Theme monospace")
					.setValue(this.plugin.settings.chartFont)
					.onChange(async (value) => {
						this.plugin.settings.chartFont = value.trim();
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
					});
			})
			.addExtraButton((btn) => {
				btn.setIcon("rotate-ccw")
					.setTooltip("Reset to theme font")
					.onClick(async () => {
						this.plugin.settings.chartFont = "";
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Chord weight")
			.setDesc("How bold chord symbols are.")
			.addDropdown((dropdown) => {
				dropdown.addOption("600", "Semibold");
				dropdown.addOption("700", "Bold (default)");
				dropdown.addOption("800", "Extra bold");
				dropdown.setValue(String(this.plugin.settings.chordWeight));
				dropdown.onChange(async (value) => {
					this.plugin.settings.chordWeight = parseInt(value, 10) || 700;
					await this.plugin.saveSettings();
					this.plugin.applyAppearance();
				});
			});

		new Setting(containerEl)
			.setName("Line spacing")
			.setDesc("Vertical spacing of chart lines.")
			.addSlider((slider) => {
				slider
					.setLimits(110, 200, 5)
					.setValue(this.plugin.settings.lineHeight)
					.onChange(async (value) => {
						this.plugin.settings.lineHeight = value;
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
					});
			})
			.addExtraButton((btn) => {
				btn.setIcon("rotate-ccw")
					.setTooltip("Reset to default")
					.onClick(async () => {
						this.plugin.settings.lineHeight = 135;
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Default columns")
			.setDesc("Column layout charts open with. Override per view in the Preview and Performance tabs; cycle per chart with the Columns button.")
			.addDropdown((dropdown) => {
				dropdown.addOption("1", "One column");
				dropdown.addOption("2", "Two columns");
				dropdown.addOption("3", "Three columns");
				dropdown.setValue(String(this.plugin.settings.chartColumns));
				dropdown.onChange(async (value) => {
					this.plugin.settings.chartColumns = Math.min(3, Math.max(1, parseInt(value, 10) || 1));
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Autoscroll speed")
			.setDesc("Default scroll speed in pixels per second. Adjust live with the +/− buttons in the chart. A song can set its own speed with {autoscroll: N} or an autoscroll property.")
			.addSlider((slider) => {
				slider
					.setLimits(5, 150, 5)
					.setValue(this.plugin.settings.autoscrollSpeed)
					.onChange(async (value) => {
						this.plugin.settings.autoscrollSpeed = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("Diagrams").setHeading();

		new Setting(containerEl)
			.setName("Chord diagrams")
			.setDesc(
				"Where the song's chord set appears: at the top of chart and setlist views, under every chordpro block in reading view, or in a sidebar panel that follows the active song."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("off", "Off");
				dropdown.addOption("chart-top", "Top of the chart");
				dropdown.addOption("inline", "Inline in notes");
				dropdown.addOption("sidebar", "Sidebar panel");
				dropdown.setValue(this.plugin.settings.diagramPlacement);
				dropdown.onChange(async (value) => {
					await this.plugin.setDiagramPlacement(value as DiagramPlacement);
				});
			});

		new Setting(containerEl)
			.setName("Diagram size")
			.setDesc("Size of the fingering diagrams.")
			.addSlider((slider) => {
				slider
					.setLimits(70, 160, 5)
					.setValue(this.plugin.settings.diagramScale)
					.onChange(async (value) => {
						this.plugin.settings.diagramScale = value;
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
					});
			})
			.addExtraButton((btn) => {
				btn.setIcon("rotate-ccw")
					.setTooltip("Reset to 100%")
					.onClick(async () => {
						this.plugin.settings.diagramScale = 100;
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Tap a chord for fingerings")
			.setDesc("Tapping a chord symbol in a rendered chart opens the fingering dock with its voicings.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.chordTapDock).onChange(async (value) => {
					this.plugin.settings.chordTapDock = value;
					await this.plugin.saveSettings();
					this.plugin.refreshChartViews();
					this.plugin.rerenderReadingViews();
				});
			});

		new Setting(containerEl).setName("Music").setHeading();

		new Setting(containerEl)
			.setName("Accidentals when transposing")
			.setDesc("Automatic picks sharps or flats from the target key. Override to always prefer one.")
			.addDropdown((dropdown) => {
				dropdown.addOption("auto", "Automatic (follow key)");
				dropdown.addOption("sharps", "Prefer sharps");
				dropdown.addOption("flats", "Prefer flats");
				dropdown.setValue(this.plugin.settings.accidentals);
				dropdown.onChange(async (value) => {
					this.plugin.settings.accidentals = value === "sharps" || value === "flats" ? value : "auto";
					await this.plugin.saveSettings();
					this.plugin.applyAppearance();
					this.plugin.refreshChartViews();
				});
			});

		new Setting(containerEl)
			.setName("Follow the active note's key")
			.setDesc("Opening a song sets the toolbox key (palette, hotkeys, capo table) to that song's key automatically.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.followNoteKey).onChange(async (value) => {
					this.plugin.settings.followNoteKey = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Form").setHeading();

		new Setting(containerEl)
			.setName("Open charts in form order")
			.setDesc("A song's form is its roadmap: the order sections are played, such as Verse, Chorus, Bridge, then Chorus again. Toggle per chart with the Form button.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.formDefaultOn).onChange(async (value) => {
					this.plugin.settings.formDefaultOn = value;
					await this.plugin.saveSettings();
					this.plugin.refreshChartViews();
				});
			});

		new Setting(containerEl)
			.setName("Highlight the current section")
			.setDesc("The form chip strip lights up the section you are in as the chart scrolls.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.formHighlight).onChange(async (value) => {
					this.plugin.settings.formHighlight = value;
					await this.plugin.saveSettings();
					this.plugin.refreshChartViews();
				});
			});

		new Setting(containerEl).setName("Library").setHeading();

		this.folderSetting(
			containerEl,
			"Songs folder",
			"Library root. Type to search vault folders. New and imported files are routed into ChordPro, Text, PDF, or Slides subfolders by format.",
			this.plugin.settings.songsFolder,
			"Songs",
			"This folder does not exist yet. Stage Binder will create it when a song is added.",
			async (value) => {
				this.plugin.settings.songsFolder = value;
				await this.plugin.saveSettings();
			}
		);

		this.folderSetting(
			containerEl,
			"Setlists folder",
			"Type to search folders containing service notes offered by the Order and Song Set panels.",
			this.plugin.settings.setlistsFolder,
			"Setlists",
			"This folder does not exist yet. Add it before selecting a service.",
			async (value) => {
				this.plugin.settings.setlistsFolder = value;
				await this.plugin.saveSettings();
			}
		);

		new Setting(containerEl).setName("Stage file types").setHeading();

		const stageType = (
			name: string,
			description: string,
			key: "includeChordProInStage" | "includeMarkdownInStage" | "includePdfInStage" | "includeImagesInStage"
		) => new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				});
			});

		stageType("ChordPro", "Include linked .chordpro charts in stage service views.", "includeChordProInStage");
		stageType("Markdown", "Include linked .md songs and spoken readings in stage service views.", "includeMarkdownInStage");
		stageType("PDF", "Include linked .pdf files in stage service views.", "includePdfInStage");
		stageType("Images", "Include linked PNG, JPEG, GIF, WebP, SVG, BMP, and AVIF files in stage service views.", "includeImagesInStage");

		new Setting(containerEl)
			.setName("Export folder")
			.setDesc("Where exports land: .chordpro files, setlist print notes, share folders, and the CCLI report. Leave empty to write next to the source note. Created on demand.")
			.addText((text) => {
				text.setPlaceholder("Next to the note")
					.setValue(this.plugin.settings.exportFolder)
					.onChange(async (value) => {
						this.plugin.settings.exportFolder = value.trim().replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Service notes folder")
			.setDesc("Optional. Limits the CCLI usage report to service/setlist notes under this folder. Leave empty to scan the whole vault.")
			.addText((text) => {
				text.setPlaceholder("Whole vault")
					.setValue(this.plugin.settings.serviceFolder)
					.onChange(async (value) => {
						this.plugin.settings.serviceFolder = value.trim().replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					});
			});

	}

	// --- Editor tab -------------------------------------------------------------

	private displayEditor(containerEl: HTMLElement): void {
		const preview = containerEl.createDiv({ cls: "sb-settings-preview sb-settings-editor-preview" });
		if (!this.plugin.settings.editorChordColors) preview.addClass("is-off");
		const line = preview.createDiv({ cls: "sb-editor-preview-line" });
		const parts: Array<[string, string | null]> = [
			["Amazing ", null],
			["[G]", "chord"],
			["grace, how ", null],
			["[C]", "chord"],
			["sweet the ", null],
			["[G]", "chord"],
			["sound", null]
		];
		for (const [text, kind] of parts) {
			if (kind === "chord") line.createSpan({ cls: "sb-editor-chord", text });
			else line.appendText(text);
		}

		new Setting(containerEl)
			.setName("Colorize chords while editing")
			.setDesc("[Chords] in a song file render in the chord color as you type.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.editorChordColors).onChange(async (value) => {
					this.plugin.settings.editorChordColors = value;
					await this.plugin.saveSettings();
					this.plugin.refreshEditorExtensions();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName("Editor chord color")
			.setDesc("Color for chords in the editor. Inherits the Global chord color until set.")
			.addColorPicker((picker) => {
				if (this.plugin.settings.editorChordColor) picker.setValue(this.plugin.settings.editorChordColor);
				picker.onChange(async (value) => {
					this.plugin.settings.editorChordColor = value;
					await this.plugin.saveSettings();
					this.plugin.applyAppearance();
				});
			})
			.addExtraButton((btn) => {
				btn.setIcon("rotate-ccw")
					.setTooltip("Inherit the Global chord color")
					.onClick(async () => {
						this.plugin.settings.editorChordColor = "";
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Hover fingering diagrams")
			.setDesc("Resting the pointer on a [Chord] in the editor shows its fingering.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.editorHoverDiagrams).onChange(async (value) => {
					this.plugin.settings.editorHoverDiagrams = value;
					await this.plugin.saveSettings();
					this.plugin.refreshEditorExtensions();
				});
			});

		new Setting(containerEl)
			.setName("Chord autocomplete")
			.setDesc("Typing [ in a song file suggests chords in the current key.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.chordAutocomplete).onChange(async (value) => {
					this.plugin.settings.chordAutocomplete = value;
					await this.plugin.saveSettings();
				});
			});
	}

	// --- Preview and Performance tabs --------------------------------------------

	private displayView(containerEl: HTMLElement, view: ViewId): void {
		this.chartPreview(containerEl, view);

		const columnsKey = view === "preview" ? "previewColumns" : "performanceColumns";
		new Setting(containerEl)
			.setName("Columns")
			.setDesc("Column layout for this view; Inherit follows the Global default.")
			.addDropdown((dropdown) => {
				dropdown.addOption("0", "Inherit");
				dropdown.addOption("1", "One column");
				dropdown.addOption("2", "Two columns");
				dropdown.addOption("3", "Three columns");
				dropdown.setValue(String(this.plugin.settings[columnsKey] || 0));
				dropdown.onChange(async (value) => {
					this.plugin.settings[columnsKey] = Math.min(3, Math.max(0, parseInt(value, 10) || 0));
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Show the form strip")
			.setDesc("Show the song's form (roadmap) as a row of sections under the title.")
			.addToggle((toggle) => {
				const key = view === "preview" ? "formStripPreview" : "formStripPerformance";
				toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
					this.plugin.refreshChartViews();
				});
			});

		if (view === "performance") this.displayPerformanceExtras(containerEl);
	}

	private displayPerformanceExtras(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Stage theme")
			.setDesc(
				"Light reads better in bright rooms and under stage lighting; dark suits dim stages. Toggle live with the sun/moon button on stage."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("light", "Light (default)");
				dropdown.addOption("dark", "Dark");
				dropdown.setValue(this.plugin.settings.perfTheme);
				dropdown.onChange(async (value) => {
					this.plugin.settings.perfTheme = value === "dark" ? "dark" : ("light");
					await this.plugin.saveSettings();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName("Performance text size")
			.setDesc("Chart text size in performance mode. Adjust live with A−/A+ on stage.")
			.addSlider((slider) => {
				slider
					.setLimits(80, 300, 10)
					.setValue(this.plugin.settings.performanceZoom)
					.onChange(async (value) => {
						this.plugin.settings.performanceZoom = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Show the control bar")
			.setDesc("The header with exit, navigation, zoom, and autoscroll buttons. Hidden, the stage is chart-only: the ... button in the corner, the Escape key, swipes, and pedals still work.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.perfShowHeader).onChange(async (value) => {
					this.plugin.settings.perfShowHeader = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Show the up next strip")
			.setDesc(
				"A dim line pinned under the chart: the next item in the set. When the setlist note is a run sheet with durations, it shows the planned clock time and length too (10:05 · Next: Communion (3:00))."
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.perfUpNext).onChange(async (value) => {
					this.plugin.settings.perfUpNext = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Pedal and tap advance by")
			.setDesc("What Previous/Next means on stage. Page scrolls a screenful, Section jumps between headings, and Element moves through the order of service.")
			.addDropdown((dropdown) => {
				dropdown.addOption("page", "Page (default)");
				dropdown.addOption("section", "Section");
				dropdown.addOption("song", "Element");
				dropdown.setValue(this.plugin.settings.perfAdvance);
				dropdown.onChange(async (value) => {
					this.plugin.settings.perfAdvance =
						value === "section" || value === "song" ? (value) : "page";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Continuous setlist scroll by default")
			.setDesc("Setlists and performance mode open with the whole set in one scrolling pane instead of one song per screen.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.setlistContinuous).onChange(async (value) => {
					this.plugin.settings.setlistContinuous = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("MIDI pedal support")
			.setDesc("In performance mode, page-turn pedals in MIDI mode (many AirTurns) turn pages. Any MIDI press advances; the codes below go back.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.midiPedal).onChange(async (value) => {
					this.plugin.settings.midiPedal = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("MIDI codes for previous")
			.setDesc("Comma-separated note:N or cc:N codes that page backwards. Everything else pages forward.")
			.addText((text) => {
				text.setPlaceholder("note:59, cc:63, cc:62")
					.setValue(this.plugin.settings.midiPrevCodes)
					.onChange(async (value) => {
						this.plugin.settings.midiPrevCodes = value;
						await this.plugin.saveSettings();
					});
			});
	}

	// --- shared helpers -----------------------------------------------------------

	private colorSetting(containerEl: HTMLElement, name: string, desc: string, key: ColorKey): void {
		const setting = new Setting(containerEl).setName(name).setDesc(desc);
		setting.addColorPicker((picker) => {
			// The picker cannot show "no color"; an unset value renders as the
			// picker's default black until the user picks one.
			if (this.plugin.settings[key]) picker.setValue(this.plugin.settings[key]);
			picker.onChange(async (value) => {
				this.plugin.settings[key] = value;
				await this.plugin.saveSettings();
				this.plugin.applyAppearance();
			});
		});
		setting.addExtraButton((btn) => {
			btn.setIcon("rotate-ccw")
				.setTooltip("Reset to theme default")
				.onClick(async () => {
					this.plugin.settings[key] = "";
					await this.plugin.saveSettings();
					this.plugin.applyAppearance();
					this.display();
				});
		});
	}

	private scaleSetting(containerEl: HTMLElement, name: string, desc: string, key: "chordScale" | "lyricsScale"): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) => {
				slider
					.setLimits(70, 160, 5)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
					});
			})
			.addExtraButton((btn) => {
				btn.setIcon("rotate-ccw")
					.setTooltip("Reset to 100%")
					.onClick(async () => {
						this.plugin.settings[key] = 100;
						await this.plugin.saveSettings();
						this.plugin.applyAppearance();
						this.display();
					});
			});
	}

}
