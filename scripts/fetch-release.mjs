// Download published release artifacts into .release-artifacts/
//
//   node scripts/fetch-release.mjs          latest release
//   node scripts/fetch-release.mjs 1.0.0    a specific tag
//
// This exists so the release vault verifies what people actually download,
// not a second copy of whatever you last built locally. If those two ever
// disagree, that is exactly the bug worth catching before submission.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const OUT = ".release-artifacts";
const FILES = ["main.js", "manifest.json", "styles.css"];
const tag = process.argv[2];

function hasGh() {
	try {
		execFileSync("gh", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

if (!hasGh()) {
	console.error(
		"The GitHub CLI (gh) is not available, so the published release cannot be\n" +
			"downloaded. Either install gh, or place main.js, manifest.json, and\n" +
			`styles.css into ${OUT}/ by hand and run:\n` +
			"  node scripts/install-vault.mjs release"
	);
	process.exit(1);
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const args = ["release", "download"];
if (tag) args.push(tag);
for (const file of FILES) args.push("--pattern", file);
args.push("--dir", OUT);

try {
	execFileSync("gh", args, { stdio: "inherit" });
} catch {
	console.error(`\nCould not download ${tag ? `release ${tag}` : "the latest release"}.`);
	process.exit(1);
}

const missing = FILES.filter((file) => !existsSync(join(OUT, file)));
if (missing.length > 0) {
	console.error(`Release is missing expected artifacts: ${missing.join(", ")}`);
	process.exit(1);
}

console.log(`\nDownloaded ${FILES.join(", ")} into ${OUT}/`);
