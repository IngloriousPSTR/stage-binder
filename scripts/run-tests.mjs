// Bundle the core tests with esbuild (same pipeline as the plugin build) and
// run them under node:test. Core modules have no Obsidian imports, so this
// needs no mocks.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync(".test-build", { recursive: true });

await build({
	entryPoints: ["test/core.test.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "es2020",
	outfile: ".test-build/core.test.cjs",
	external: ["node:*"],
	logLevel: "warning"
});

const result = spawnSync(process.execPath, ["--test", ".test-build/core.test.cjs"], {
	stdio: "inherit"
});
process.exit(result.status ?? 1);
