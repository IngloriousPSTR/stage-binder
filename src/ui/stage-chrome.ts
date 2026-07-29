import { TFile, setIcon } from "obsidian";
import { ServiceContext, ServiceEntry, serviceEntryDuration, serviceEntryTime } from "./service-context";

let chromeId = 0;

export interface StageChromeOptions {
	host: HTMLElement;
	main: HTMLElement;
	surface: "preview" | "performance";
	services: TFile[];
	context: ServiceContext | null;
	currentIndex: number;
	title: string;
	position?: string;
	cardsSelectable: boolean;
	onChooseService: (file: TFile) => void;
	onSelectEntry: (entry: ServiceEntry, index: number) => void;
	onExit?: () => void;
}

/** Shared Obsidian-native top bar, tools popover, and service drawers. */
export class StageChrome {
	readonly topbar: HTMLElement;
	private options: StageChromeOptions;
	private titleEl: HTMLElement;
	private positionEl: HTMLElement;
	private toolsPanel: HTMLElement;
	private orderDrawer: HTMLElement;
	private songsDrawer: HTMLElement;
	private scrim: HTMLElement;
	private orderBtn: HTMLButtonElement;
	private songsBtn: HTMLButtonElement;
	private toolsBtn: HTMLButtonElement;
	private restoreFocus: HTMLElement | null = null;

	constructor(options: StageChromeOptions) {
		this.options = options;
		const id = ++chromeId;
		this.topbar = options.host.createEl("header", { cls: `sb-stage-topbar sb-stage-topbar-${options.surface}` });
		this.orderBtn = this.iconButton(this.topbar, "panel-left", "Open order of service");
		this.orderBtn.setAttribute("aria-controls", `sb-order-${id}`);
		this.orderBtn.setAttribute("aria-expanded", "false");
		const heading = this.topbar.createDiv({ cls: "sb-stage-heading" });
		this.titleEl = heading.createDiv({ cls: "sb-stage-title", text: options.title });
		this.positionEl = heading.createDiv({ cls: "sb-stage-position", text: options.position ?? "" });
		this.toolsBtn = this.iconButton(this.topbar, "more-horizontal", "Open tools");
		this.toolsBtn.setAttribute("aria-controls", `sb-tools-${id}`);
		this.toolsBtn.setAttribute("aria-expanded", "false");
		this.songsBtn = this.iconButton(this.topbar, "panel-right", "Open song set");
		this.songsBtn.setAttribute("aria-controls", `sb-songs-${id}`);
		this.songsBtn.setAttribute("aria-expanded", "false");
		if (options.onExit) {
			const exit = this.iconButton(this.topbar, "x", "Exit performance mode");
			exit.addClass("sb-stage-exit");
			exit.addEventListener("click", options.onExit);
		}

		this.toolsPanel = options.host.createDiv({ cls: "sb-stage-tools" });
		this.toolsPanel.id = `sb-tools-${id}`;
		this.toolsPanel.setAttribute("role", "dialog");
		this.toolsPanel.setAttribute("aria-label", "Chart and reading tools");
		this.toolsPanel.hidden = true;

		this.scrim = options.host.createDiv({ cls: "sb-stage-scrim" });
		this.orderDrawer = options.host.createEl("aside", { cls: "sb-stage-drawer sb-stage-drawer-left" });
		this.orderDrawer.id = `sb-order-${id}`;
		this.orderDrawer.setAttribute("role", "dialog");
		this.orderDrawer.setAttribute("aria-modal", "true");
		this.orderDrawer.setAttribute("aria-label", "Order of service");
		this.orderDrawer.setAttribute("aria-hidden", "true");
		this.orderDrawer.inert = true;
		this.songsDrawer = options.host.createEl("aside", { cls: "sb-stage-drawer sb-stage-drawer-right" });
		this.songsDrawer.id = `sb-songs-${id}`;
		this.songsDrawer.setAttribute("role", "dialog");
		this.songsDrawer.setAttribute("aria-modal", "true");
		this.songsDrawer.setAttribute("aria-label", "Song set");
		this.songsDrawer.setAttribute("aria-hidden", "true");
		this.songsDrawer.inert = true;

		this.orderBtn.addEventListener("click", () => this.toggleDrawer("order", this.orderBtn));
		this.songsBtn.addEventListener("click", () => this.toggleDrawer("songs", this.songsBtn));
		this.toolsBtn.addEventListener("click", () => this.toggleTools());
		this.scrim.addEventListener("click", () => this.closeAll());
		this.renderDrawers();
	}

	private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
		const button = parent.createEl("button", { cls: "sb-stage-icon-btn" });
		setIcon(button, icon);
		button.setAttribute("aria-label", label);
		return button;
	}

	setTools(render: (panel: HTMLElement) => void): void {
		this.toolsPanel.empty();
		render(this.toolsPanel);
	}

	isToolsOpen(): boolean {
		return !this.toolsPanel.hidden;
	}

	openTools(): void {
		if (this.toolsPanel.hidden) this.toggleTools();
	}

	updateHeader(title: string, position = ""): void {
		this.titleEl.setText(title);
		this.positionEl.setText(position);
	}

	updateContext(context: ServiceContext | null, currentIndex: number): void {
		this.options.context = context;
		this.options.currentIndex = currentIndex;
		this.renderDrawers();
	}

	updateCurrent(currentIndex: number): void {
		this.options.currentIndex = currentIndex;
		this.orderDrawer.querySelectorAll<HTMLElement>("[data-entry]").forEach((row) => {
			row.toggleClass("is-current", Number(row.dataset.entry) === currentIndex);
		});
		this.songsDrawer.querySelectorAll<HTMLElement>("[data-entry]").forEach((row) => {
			row.toggleClass("is-current", Number(row.dataset.entry) === currentIndex);
		});
	}

	private renderDrawers(): void {
		this.renderDrawer(this.orderDrawer, "Order of service", false);
		this.renderDrawer(this.songsDrawer, "Song set", true);
	}

	private renderDrawer(drawer: HTMLElement, title: string, filesOnly: boolean): void {
		drawer.empty();
		const head = drawer.createDiv({ cls: "sb-stage-drawer-head" });
		const heading = head.createDiv({ cls: "sb-stage-drawer-heading" });
		const copy = heading.createDiv();
		copy.createDiv({ cls: "sb-stage-eyebrow", text: this.options.surface === "performance" ? "Performance" : "Chart preview" });
		copy.createEl("h2", { text: title });
		const close = this.iconButton(heading, "x", `Close ${title.toLowerCase()}`);
		close.addEventListener("click", () => this.closeAll());
		const picker = head.createEl("select", { cls: "dropdown sb-stage-service-picker" });
		picker.setAttribute("aria-label", "Choose service from Setlists folder");
		picker.createEl("option", { text: "Choose service…", value: "" });
		for (const file of this.options.services) picker.createEl("option", { text: file.basename, value: file.path });
		picker.value = this.options.context?.source.path ?? "";
		picker.addEventListener("change", () => {
			const file = this.options.services.find((candidate) => candidate.path === picker.value);
			if (file) this.options.onChooseService(file);
		});

		const list = drawer.createDiv({ cls: "sb-stage-drawer-list" });
		const context = this.options.context;
		if (!context) {
			list.createDiv({ cls: "sb-stage-empty", text: "Choose a service to populate this panel." });
			return;
		}
		if (context.entries.length === 0) {
			list.createDiv({ cls: "sb-stage-empty", text: "No service items found." });
			return;
		}
		if (filesOnly) {
			context.entries.filter((entry) => entry.file).forEach((entry) => this.appendEntry(list, context, entry));
			return;
		}
		for (const row of context.rows) {
			if (row.kind === "divider") {
				list.createDiv({ cls: "sb-stage-drawer-divider", text: row.title });
			} else {
				this.appendEntry(list, context, row);
			}
		}
	}

	private appendEntry(list: HTMLElement, context: ServiceContext, entry: ServiceEntry): void {
		const index = context.entries.indexOf(entry);
		const button = list.createEl("button", { cls: "sb-stage-drawer-row" });
		button.dataset.entry = String(index);
		button.toggleClass("is-current", index === this.options.currentIndex);
		button.createSpan({ cls: "sb-stage-row-time", text: serviceEntryTime(context, entry) });
		button.createSpan({ cls: "sb-stage-row-title", text: entry.title });
		button.createSpan({ cls: "sb-stage-row-kind", text: entry.fileKind ?? "Service item" });
		button.createSpan({ cls: "sb-stage-row-duration", text: serviceEntryDuration(entry) });
		button.createSpan({ cls: "sb-stage-row-host", text: entry.item.people.join(", ") });
		if (entry.kind === "card" && !this.options.cardsSelectable) {
			button.disabled = true;
			button.setAttribute("aria-label", `${entry.title}, informational service item`);
		} else {
			button.addEventListener("click", () => {
				this.closeAll();
				this.options.onSelectEntry(entry, index);
			});
		}
	}

	private toggleTools(): void {
		const open = this.toolsPanel.hidden;
		this.closeAll();
		if (!open) return;
		this.restoreFocus = this.toolsBtn;
		this.toolsPanel.hidden = false;
		this.toolsPanel.addClass("is-open");
		this.toolsBtn.setAttribute("aria-expanded", "true");
		this.options.main.inert = false;
		this.toolsPanel.querySelector<HTMLElement>("button,select,input")?.focus();
	}

	private toggleDrawer(which: "order" | "songs", trigger: HTMLElement): void {
		const drawer = which === "order" ? this.orderDrawer : this.songsDrawer;
		const open = !drawer.hasClass("is-open");
		this.closeAll();
		if (!open) return;
		this.restoreFocus = trigger;
		drawer.addClass("is-open");
		drawer.inert = false;
		drawer.setAttribute("aria-hidden", "false");
		this.scrim.addClass("is-open");
		this.options.main.inert = true;
		this.topbar.inert = true;
		this.orderBtn.setAttribute("aria-expanded", String(which === "order"));
		this.songsBtn.setAttribute("aria-expanded", String(which === "songs"));
		drawer.querySelector<HTMLElement>("select,button:not(:disabled)")?.focus();
	}

	closeTopLayer(): boolean {
		if (!this.toolsPanel.hidden || this.orderDrawer.hasClass("is-open") || this.songsDrawer.hasClass("is-open")) {
			this.closeAll();
			return true;
		}
		return false;
	}

	closeAll(): void {
		this.toolsPanel.hidden = true;
		this.toolsPanel.removeClass("is-open");
		this.orderDrawer.removeClass("is-open");
		this.songsDrawer.removeClass("is-open");
		this.orderDrawer.inert = true;
		this.songsDrawer.inert = true;
		this.orderDrawer.setAttribute("aria-hidden", "true");
		this.songsDrawer.setAttribute("aria-hidden", "true");
		this.scrim.removeClass("is-open");
		this.orderBtn.setAttribute("aria-expanded", "false");
		this.songsBtn.setAttribute("aria-expanded", "false");
		this.toolsBtn.setAttribute("aria-expanded", "false");
		this.options.main.inert = false;
		this.topbar.inert = false;
		this.restoreFocus?.focus();
		this.restoreFocus = null;
	}
}
