import { App, TFile, loadPdfJs, setIcon } from "obsidian";

type PdfLayout = "vertical" | "horizontal";

interface PdfViewport {
	width: number;
	height: number;
}

interface PdfPage {
	getViewport(options: { scale: number }): PdfViewport;
	render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
}

interface PdfDocument {
	numPages: number;
	getPage(number: number): Promise<PdfPage>;
	destroy?: () => Promise<void> | void;
}

interface PdfJs {
	getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

function isPdfJs(value: unknown): value is PdfJs {
	return typeof value === "object" && value !== null &&
		"getDocument" in value && typeof value.getDocument === "function";
}

export interface PdfPageStepDetail {
	delta: -1 | 1;
	found: boolean;
	moved: boolean;
}

const LAYOUT_KEY = "stage-binder-pdf-layout";

function preferredLayout(container: HTMLElement): PdfLayout {
	try {
		const saved = window.localStorage.getItem(LAYOUT_KEY);
		if (saved === "vertical" || saved === "horizontal") return saved;
	} catch {
		// Storage can be unavailable in restricted webviews.
	}
	return container.closest(".cps-perf-content") ? "horizontal" : "vertical";
}

/** Render a vault PDF as responsive pages instead of Obsidian's nested viewer. */
export async function renderPdfInto(
	container: HTMLElement,
	app: App,
	file: TFile,
	isCurrent: (() => boolean) | undefined
): Promise<void> {
	const reader = container.createDiv({ cls: "cps-pdf-reader" });
	const toolbar = reader.createDiv({ cls: "cps-pdf-toolbar" });
	const previous = toolbar.createEl("button", { cls: "cps-chart-btn" });
	const status = toolbar.createSpan({ cls: "cps-pdf-status", text: "Loading PDF..." });
	const next = toolbar.createEl("button", { cls: "cps-chart-btn" });
	const layoutButton = toolbar.createEl("button", { cls: "cps-chart-btn cps-pdf-layout" });
	setIcon(previous, "chevron-left");
	setIcon(next, "chevron-right");
	previous.setAttribute("aria-label", "Previous PDF page");
	next.setAttribute("aria-label", "Next PDF page");
	status.setAttribute("aria-live", "polite");
	const pages = reader.createDiv({ cls: "cps-pdf-pages" });
	pages.setAttribute("tabindex", "0");
	pages.setAttribute("aria-label", `${file.basename} PDF pages`);
	let layout = preferredLayout(container);
	let current = 0;
	const pageEls: HTMLElement[] = [];

	const sync = () => {
		const count = pageEls.length;
		status.setText(count > 0 ? `Page ${current + 1} of ${count}` : "Loading PDF...");
		previous.toggleAttribute("disabled", current <= 0);
		next.toggleAttribute("disabled", current >= count - 1);
	};
	const applyLayout = () => {
		reader.toggleClass("is-horizontal", layout === "horizontal");
		reader.toggleClass("is-vertical", layout === "vertical");
		setIcon(layoutButton, layout === "horizontal" ? "columns-3" : "rows-3");
		layoutButton.setAttribute("aria-label", `PDF layout: ${layout}. Switch layout`);
		layoutButton.setAttribute("aria-pressed", String(layout === "horizontal"));
	};
	const goTo = (index: number, smooth = true): boolean => {
		const target = Math.max(0, Math.min(pageEls.length - 1, index));
		if (target === current || !pageEls[target]) return false;
		current = target;
		const behavior = smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto";
		pages.scrollTo(layout === "horizontal"
			? { left: pageEls[target].offsetLeft, behavior }
			: { top: pageEls[target].offsetTop, behavior });
		sync();
		return true;
	};

	previous.addEventListener("click", () => goTo(current - 1));
	next.addEventListener("click", () => goTo(current + 1));
	layoutButton.addEventListener("click", () => {
		layout = layout === "horizontal" ? "vertical" : "horizontal";
		try { window.localStorage.setItem(LAYOUT_KEY, layout); } catch { /* Keep the session choice. */ }
		applyLayout();
		pages.scrollTo(layout === "horizontal"
			? { left: pageEls[current]?.offsetLeft ?? 0, top: 0, behavior: "auto" }
			: { left: 0, top: pageEls[current]?.offsetTop ?? 0, behavior: "auto" });
	});
	reader.addEventListener("cps-pdf-page", (event) => {
		const detail = (event as CustomEvent<PdfPageStepDetail>).detail;
		detail.found = true;
		detail.moved = goTo(current + detail.delta);
	});
	pages.addEventListener("scroll", () => {
		if (pageEls.length < 2) return;
		const offsets = pageEls.map((page) => layout === "horizontal" ? page.offsetLeft : page.offsetTop);
		if (new Set(offsets).size < 2) return;
		const position = layout === "horizontal" ? pages.scrollLeft : pages.scrollTop;
		const nearest = pageEls.reduce((best, page, index) => {
			const offset = layout === "horizontal" ? page.offsetLeft : page.offsetTop;
			const bestOffset = layout === "horizontal" ? pageEls[best].offsetLeft : pageEls[best].offsetTop;
			return Math.abs(offset - position) < Math.abs(bestOffset - position) ? index : best;
		}, 0);
		if (nearest !== current) { current = nearest; sync(); }
	}, { passive: true });
	pages.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });
	pages.addEventListener("touchend", (event) => event.stopPropagation(), { passive: true });
	applyLayout();
	sync();

	try {
		const binary = await app.vault.readBinary(file);
		const loadedPdfJs: unknown = await loadPdfJs();
		if (!isPdfJs(loadedPdfJs)) throw new Error("Obsidian PDF renderer is unavailable");
		if (isCurrent?.() === false) return;
		const loading = loadedPdfJs.getDocument({ data: new Uint8Array(binary) });
		const pdf = await loading.promise;
		for (let number = 1; number <= pdf.numPages; number++) {
			if (isCurrent?.() === false) { await pdf.destroy?.(); return; }
			const page = await pdf.getPage(number);
			const base = page.getViewport({ scale: 1 });
			const targetWidth = Math.max(900, Math.min(1800, (container.clientWidth || 900) * Math.min(window.devicePixelRatio || 1, 2)));
			const viewport = page.getViewport({ scale: targetWidth / base.width });
			const pageEl = pages.createDiv({ cls: "cps-pdf-page" });
			pageEl.setAttribute("aria-label", `Page ${number} of ${pdf.numPages}`);
			const canvas = pageEl.createEl("canvas");
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			canvas.setAttribute("role", "img");
			canvas.setAttribute("aria-label", `${file.basename}, page ${number}`);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas rendering is unavailable");
			await page.render({ canvasContext: context, viewport }).promise;
			pageEls.push(pageEl);
			sync();
		}
	} catch (error) {
		console.error("Stage Binder: PDF render failed", file.path, error);
		pages.empty();
		pages.createDiv({ cls: "cps-pdf-error", text: "This PDF could not be rendered. Open the source file to continue." });
		const open = pages.createEl("button", { cls: "cps-chart-btn", text: "Open original PDF" });
		open.addEventListener("click", () => void app.workspace.getLeaf(false).openFile(file));
		status.setText("PDF unavailable");
	}
}
