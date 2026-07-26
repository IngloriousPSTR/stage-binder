import { Window } from "happy-dom";

type CreateOptions = {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string>;
	type?: string;
	href?: string;
};

const testWindow = new Window({ url: "https://chordpro.test" });
const exposed = [
	"Node",
	"Element",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLCanvasElement",
	"HTMLInputElement",
	"HTMLOptionElement",
	"HTMLSelectElement",
	"SVGElement",
	"DocumentFragment",
	"DOMParser",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"MutationObserver"
] as const;

Object.defineProperty(globalThis, "window", { value: testWindow, configurable: true });
Object.defineProperty(globalThis, "document", { value: testWindow.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: testWindow.navigator, configurable: true });
for (const name of exposed) {
	Object.defineProperty(globalThis, name, { value: testWindow[name], configurable: true });
}
Object.defineProperty(globalThis, "getComputedStyle", {
	value: testWindow.getComputedStyle.bind(testWindow),
	configurable: true
});
Object.defineProperty(testWindow.HTMLCanvasElement.prototype, "getContext", {
	value: () => ({}),
	configurable: true
});

function applyOptions(el: HTMLElement, options: CreateOptions = {}): void {
	const classes = Array.isArray(options.cls) ? options.cls : options.cls?.split(/\s+/);
	if (classes) el.classList.add(...classes.filter(Boolean));
	if (options.text !== undefined) el.textContent = options.text;
	if (options.type !== undefined) el.setAttribute("type", options.type);
	if (options.href !== undefined) el.setAttribute("href", options.href);
	for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
}

const proto = testWindow.HTMLElement.prototype as unknown as Record<string, (...args: any[]) => unknown>;
proto.empty = function (this: HTMLElement): void {
	this.replaceChildren();
};
proto.addClass = function (this: HTMLElement, ...classes: string[]): void {
	this.classList.add(...classes.flatMap((name) => name.split(/\s+/)).filter(Boolean));
};
proto.removeClass = function (this: HTMLElement, ...classes: string[]): void {
	this.classList.remove(...classes.flatMap((name) => name.split(/\s+/)).filter(Boolean));
};
proto.hasClass = function (this: HTMLElement, name: string): boolean {
	return this.classList.contains(name);
};
proto.toggleClass = function (this: HTMLElement, name: string, value?: boolean): void {
	this.classList.toggle(name, value);
};
proto.setText = function (this: HTMLElement, text: string): void {
	this.textContent = text;
};
proto.createEl = function (this: HTMLElement, tag: string, options?: CreateOptions): HTMLElement {
	const el = document.createElement(tag);
	applyOptions(el, options);
	this.append(el);
	return el;
};
proto.createDiv = function (this: HTMLElement, options?: CreateOptions): HTMLDivElement {
	return this.createEl("div", options) as HTMLDivElement;
};
proto.createSpan = function (this: HTMLElement, options?: CreateOptions): HTMLSpanElement {
	return this.createEl("span", options) as HTMLSpanElement;
};

Object.defineProperty(globalThis, "createDiv", {
	value: (options?: CreateOptions) => {
		const el = document.createElement("div");
		applyOptions(el, options);
		return el;
	},
	configurable: true
});

export function resetDom(): void {
	document.body.replaceChildren();
}
