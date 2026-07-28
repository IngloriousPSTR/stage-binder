// Copy examples/ into the release vault.
//
//   node scripts/seed-release-vault.mjs
//   node scripts/seed-release-vault.mjs --force
//
// The release vault is a mirror of what a new user sees, so its content is
// generated from examples/ rather than authored by hand. Anything written
// directly in that vault is unversioned and cannot be recreated.
//
// Existing files are left alone unless their content differs, in which case
// the script stops and names them. --force overwrites.
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE = "examples";
const force = process.argv.includes("--force");

function readJson(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function releaseVault() {
	if (process.env.STAGE_BINDER_VAULT_RELEASE) return process.env.STAGE_BINDER_VAULT_RELEASE.trim();
	const configured = readJson(".vault-paths.json");
	if (configured && typeof configured.release === "string" && configured.release.trim()) {
		return configured.release.trim();
	}
	return null;
}

const vault = releaseVault();
if (!vault) {
	console.error(
		"No release vault configured. Set STAGE_BINDER_VAULT_RELEASE or add a\n" +
			'"release" key to .vault-paths.json next to package.json.'
	);
	process.exit(1);
}
if (!existsSync(vault)) {
	console.error(`Release vault does not exist:\n  ${vault}`);
	process.exit(1);
}
if (!existsSync(SOURCE)) {
	console.error(`No ${SOURCE}/ directory found. Run this from the project root.`);
	process.exit(1);
}

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		if (entry === ".DS_Store") continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

const files = walk(SOURCE);
const conflicts = [];
const planned = [];

for (const from of files) {
	const rel = relative(SOURCE, from);
	const to = join(vault, rel);
	if (existsSync(to)) {
		const same = readFileSync(from).equals(readFileSync(to));
		if (same) continue;
		if (!force) {
			conflicts.push(rel);
			continue;
		}
	}
	planned.push({ from, to, rel });
}

if (conflicts.length > 0) {
	console.error("These files differ in the release vault and would be overwritten:");
	for (const rel of conflicts) console.error(`  ${rel}`);
	console.error("\nNothing was copied. Re-run with --force to overwrite.");
	process.exit(1);
}

if (planned.length === 0) {
	console.log(`Release vault is already up to date with ${SOURCE}/.`);
	process.exit(0);
}

for (const { from, to, rel } of planned) {
	mkdirSync(join(to, ".."), { recursive: true });
	copyFileSync(from, to);
	console.log(`Copied ${rel}`);
}

console.log(`\nSeeded ${planned.length} file(s) into ${vault}`);
