import { App, TFile } from "obsidian";
import { detectKey, usedChords } from "../core/chordpro";
import { applyFrontmatter } from "../core/frontmatter";
import { displayText, formatClock, formatDuration, parseRunsheet, Runsheet, RunsheetItem } from "../core/runsheet";
import { isStageFileEnabled, KEY_OVERRIDE_RE } from "./render-song";
import type { StageFileTypes } from "./render-song";

export type ServiceFileKind = "song" | "prose" | "pdf" | "image";

export interface ServiceEntry {
	kind: "file" | "card";
	title: string;
	item: RunsheetItem;
	file: TFile | null;
	fileKind: ServiceFileKind | null;
	key: string | null;
	label: string | null;
	line: number;
	endCol?: number;
}

export interface ServiceDivider {
	kind: "divider";
	title: string;
	item: RunsheetItem;
}

export interface ServiceContext {
	source: TFile;
	runsheet: Runsheet;
	rows: Array<ServiceDivider | ServiceEntry>;
	entries: ServiceEntry[];
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

function supportedKind(file: TFile): ServiceFileKind | null {
	const ext = file.extension.toLowerCase();
	if (ext === "chordpro") return "song";
	if (ext === "md") return "prose";
	if (ext === "pdf") return "pdf";
	return IMAGE_EXTENSIONS.has(ext) ? "image" : null;
}

/** Markdown needs one read to distinguish a chart from spoken prose. */
async function classifyFile(app: App, file: TFile, kind: ServiceFileKind): Promise<ServiceFileKind> {
	if (kind !== "prose") return kind;
	try {
		return usedChords(applyFrontmatter(await app.vault.cachedRead(file))).length > 0 ? "song" : "prose";
	} catch {
		return "prose";
	}
}

/** Build the complete service order, including rows that have no linked file. */
export async function buildServiceContext(app: App, source: TFile, types?: StageFileTypes): Promise<ServiceContext> {
	const content = await app.vault.cachedRead(source);
	const runsheet = parseRunsheet(content);
	const lines = content.split(/\r?\n/);
	const refs = [...(app.metadataCache.getFileCache(source)?.links ?? []), ...(app.metadataCache.getFileCache(source)?.embeds ?? [])]
		.sort((a, b) => a.position.start.offset - b.position.start.offset);
	const linkedByLine = new Map<number, { file: TFile; endCol: number }>();
	for (const ref of refs) {
		if (linkedByLine.has(ref.position.start.line)) continue;
		const file = app.metadataCache.getFirstLinkpathDest(ref.link.split("#")[0], source.path);
		if (file instanceof TFile && supportedKind(file) && (!types || isStageFileEnabled(file, types))) {
			linkedByLine.set(ref.position.start.line, { file, endCol: ref.position.end.col });
		}
	}

	const rows: Array<ServiceDivider | ServiceEntry> = [];
	const entries: ServiceEntry[] = [];
	for (const item of runsheet.items) {
		if (item.kind === "divider") {
			rows.push({ kind: "divider", title: displayText(item.text), item });
			continue;
		}
		const linked = linkedByLine.get(item.line);
		const baseTitle = displayText(item.text);
		let entry: ServiceEntry;
		if (!linked) {
			entry = {
				kind: "card",
				title: baseTitle || "Service item",
				item,
				file: null,
				fileKind: null,
				key: null,
				label: null,
				line: item.line
			};
		} else {
			const initialKind = supportedKind(linked.file)!;
			const fileKind = await classifyFile(app, linked.file, initialKind);
			const after = (lines[item.line] ?? "").slice(linked.endCol);
			const override = after.match(KEY_OVERRIDE_RE);
			let key: string | null = override?.[1] ?? null;
			let label: string | null = override ? override[1] + (override[2] ? "m" : "") : null;
			if (!key && fileKind === "song") {
				try {
					const detected = detectKey(applyFrontmatter(await app.vault.cachedRead(linked.file)));
					key = detected?.tonic ?? null;
					label = detected ? detected.tonic + (detected.minor ? "m" : "") : null;
				} catch {
					// The renderer will surface an unreadable file if selected.
				}
			}
			entry = {
				kind: "file",
				title: baseTitle || linked.file.basename,
				item,
				file: linked.file,
				fileKind,
				key,
				label,
				line: item.line,
				endCol: linked.endCol
			};
		}
		rows.push(entry);
		entries.push(entry);
	}
	return { source, runsheet, rows, entries };
}

export function listSetlistFiles(app: App, folder: string): TFile[] {
	const root = (folder || "Setlists").trim().replace(/^\/+|\/+$/g, "") || "Setlists";
	const prefix = root + "/";
	const files = typeof app.vault.getMarkdownFiles === "function" ? app.vault.getMarkdownFiles() : [];
	return files
		.filter((file) => file.path.startsWith(prefix))
		.sort((a, b) => b.basename.localeCompare(a.basename, undefined, { numeric: true }));
}

export function serviceEntryTime(context: ServiceContext, entry: ServiceEntry): string {
	return formatClock(context.runsheet, entry.item.offsetSeconds);
}

export function serviceEntryDuration(entry: ServiceEntry): string {
	return entry.item.seconds === null ? "" : formatDuration(entry.item.seconds);
}
