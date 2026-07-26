// Bundle UI tests with the real plugin modules, replacing only Obsidian's
// runtime API. happy-dom supplies the browser DOM that Obsidian normally owns.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

mkdirSync(".test-build", { recursive: true });

const outfile = ".test-build/ui.test.mjs";
await build({
	entryPoints: ["test/ui.test.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	outfile,
	external: ["node:*", "happy-dom"],
	alias: { obsidian: resolve("test/ui/obsidian-mock.ts") },
	logLevel: "warning"
});

const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);
