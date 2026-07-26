// Copy the built plugin into a development vault.
//
// Point it at your vault (the vault folder itself, not the plugins folder) in
// either of two ways:
//   1. CHORDPRO_VAULT="$HOME/Vaults/Dev" npm run install:vault
//   2. put the path in a .vault-path file next to package.json (gitignored),
//      then just: npm run install:vault
//
// Use a scratch vault, not the one you actually gig with.
import { mkdirSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FILES = ["main.js", "manifest.json", "styles.css"];

function targetVault() {
	if (process.env.CHORDPRO_VAULT) return process.env.CHORDPRO_VAULT.trim();
	if (existsSync(".vault-path")) {
		const path = readFileSync(".vault-path", "utf8").trim();
		if (path.length > 0) return path;
	}
	return null;
}

const vault = targetVault();
if (!vault) {
	console.error(
		"No development vault configured. Either set CHORDPRO_VAULT:\n" +
			'  CHORDPRO_VAULT="$HOME/Vaults/Dev" npm run install:vault\n' +
			"or write the vault path into a .vault-path file next to package.json."
	);
	process.exit(1);
}

for (const file of FILES) {
	if (!existsSync(file)) {
		console.error(`Missing ${file}. Run npm run build first.`);
		process.exit(1);
	}
}

const pluginDir = join(vault, ".obsidian", "plugins", "chordpro-studio");
mkdirSync(pluginDir, { recursive: true });
for (const file of FILES) {
	copyFileSync(file, join(pluginDir, file));
	console.log(`Copied ${file} -> ${pluginDir}`);
}
// data.json (your settings) is deliberately never copied: installing a build
// must not overwrite settings you already have in the vault.
