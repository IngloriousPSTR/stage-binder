export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;

	constructor(path: string) {
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		const dot = this.name.lastIndexOf(".");
		this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
		this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
	}
}

export class WorkspaceLeaf {
	constructor(public app: any) {}
}

export class Component {
	load(): void {}
	unload(): void {}
}

export class ItemView extends Component {
	app: any;
	contentEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.app = leaf.app;
		this.contentEl = document.createElement("div");
	}

	registerEvent(): void {}

	registerDomEvent(el: EventTarget, type: string, callback: EventListener): void {
		el.addEventListener(type, callback);
	}
}

export class Notice {
	constructor(public message: string) {}
}

export class App {}

export class Modal {
	contentEl = document.createElement("div");

	constructor(public app: unknown) {}

	open(): void {}

	close(): void {}
}

export class Setting {
	constructor(public containerEl: HTMLElement) {}
}

export async function requestUrl(): Promise<never> {
	throw new Error("requestUrl is unavailable in the UI harness");
}

export async function loadPdfJs(): Promise<unknown> {
	const mock = (globalThis as { __pdfjsMock?: unknown }).__pdfjsMock;
	if (!mock) throw new Error("PDF.js mock is unavailable in the UI harness");
	return mock;
}

export class MarkdownRenderer {
	static async render(_app: unknown, source: string, el: HTMLElement): Promise<void> {
		el.textContent = source;
	}
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute("data-icon", icon);
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
	const template = document.createElement("template");
	template.innerHTML = html;
	return template.content;
}
