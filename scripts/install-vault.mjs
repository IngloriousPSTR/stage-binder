// Copy a built plugin into one of the project's Obsidian vaults.
//
//   node scripts/install-vault.mjs dev       from ./ after a build
//   node scripts/install-vault.mjs release   from ./.release-artifacts
//
// Two targets, two jobs:
//   dev      the vault you test unreleased work in. Break things here.
//   release  a clean vault holding only what the public actually downloads.
//
// Vault paths never live in this repo. Resolution order per target:
//   1. STAGE_BINDER_VAULT_DEV / STAGE_BINDER_VAULT_RELEASE
//   2. .vault-paths.json  ->  { "dev": "...", "release": "..." }
//   3. dev only, legacy:  CHORDPRO_VAULT, then .vault-path
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ID = "stage-binder";
const FILES = ["main.js", "manifest.json", "styles.css"];
const TARGETS = ["dev", "release"];
const DEV_SUFFIX = " (dev)";

const target = (process.argv[2] || "dev").trim();
if (!TARGETS.includes(target)) {
	console.error(`Unknown target "${target}". Use one of: ${TARGETS.join(", ")}`);
	process.exit(1);
}

// Release installs verify the published artifacts, not whatever you last built.
const sourceDir = target === "release" ? ".release-artifacts" : ".";

function readJson(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		console.error(`Could not parse ${path}: ${error.message}`);
		process.exit(1);
	}
}

function targetVault() {
	const envKey = `STAGE_BINDER_VAULT_${target.toUpperCase()}`;
	if (process.env[envKey]) return process.env[envKey].trim();

	const configured = readJson(".vault-paths.json");
	if (configured && typeof configured[target] === "string" && configured[target].trim()) {
		return configured[target].trim();
	}

	if (target === "dev") {
		if (process.env.CHORDPRO_VAULT) return process.env.CHORDPRO_VAULT.trim();
		if (existsSync(".vault-path")) {
			const legacy = readFileSync(".vault-path", "utf8").trim();
			if (legacy.length > 0) return legacy;
		}
	}

	return null;
}

const vault = targetVault();
if (!vault) {
	console.error(
		`No ${target} vault configured. Either set the environment variable:\n` +
			`  STAGE_BINDER_VAULT_${target.toUpperCase()}="$HOME/Vaults/My Vault" node scripts/install-vault.mjs ${target}\n` +
			`or create .vault-paths.json next to package.json:\n` +
			`  { "dev": "/path/to/dev vault", "release": "/path/to/release vault" }`
	);
	process.exit(1);
}

if (!existsSync(vault)) {
	console.error(`Configured ${target} vault does not exist:\n  ${vault}`);
	process.exit(1);
}

for (const file of FILES) {
	const from = join(sourceDir, file);
	if (!existsSync(from)) {
		const hint =
			target === "release"
				? "Run npm run install:release, which downloads the published release first."
				: "Run npm run build first.";
		console.error(`Missing ${from}. ${hint}`);
		process.exit(1);
	}
}

const pluginDir = join(vault, ".obsidian", "plugins", PLUGIN_ID);
mkdirSync(pluginDir, { recursive: true });
for (const file of FILES) {
	copyFileSync(join(sourceDir, file), join(pluginDir, file));
	console.log(`Copied ${file} -> ${pluginDir}`);
}

// Mark dev installs in Obsidian's plugin list so it is obvious at a glance
// which vault is running unreleased work. The name is cosmetic; the plugin ID
// and version are untouched, and the repo's own manifest.json is never
// modified. Release installs stay verbatim: that vault must show exactly what
// a user downloading from GitHub would see.
if (target === "dev") {
	const manifestPath = join(pluginDir, "manifest.json");
	const manifest = readJson(manifestPath);
	if (manifest && !manifest.name.endsWith(DEV_SUFFIX)) {
		manifest.name += DEV_SUFFIX;
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
		console.log(`Marked as "${manifest.name}" in the plugin list`);
	}
}

// Make sure the vault has the plugin switched on, without disturbing others.
const enabledPath = join(vault, ".obsidian", "community-plugins.json");
const enabled = readJson(enabledPath);
const list = Array.isArray(enabled) ? enabled : [];
if (!list.includes(PLUGIN_ID)) {
	list.push(PLUGIN_ID);
	writeFileSync(enabledPath, `${JSON.stringify(list, null, "\t")}\n`);
	console.log(`Enabled ${PLUGIN_ID} in ${enabledPath}`);
}

console.log(`\nInstalled to the ${target} vault: ${vault}`);
if (target === "release") {
	console.log("This vault should hold nothing but published artifacts and examples/ content.");
}

// data.json (your settings) is deliberately never copied: installing a build
// must not overwrite settings you already have in the vault.
