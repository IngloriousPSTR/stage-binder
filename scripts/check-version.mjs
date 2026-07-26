// Assert the version is consistent across package.json, package-lock.json,
// manifest.json, and versions.json, and (on a release) that the pushed tag matches. Obsidian
// requires the GitHub release tag to equal the manifest version EXACTLY, with
// no "v" prefix, so a stray "v1.0.1" tag would ship a broken release. This
// runs in CI (files agree) and in the release workflow (tag agrees too).
//
//   node scripts/check-version.mjs            # files only
//   node scripts/check-version.mjs 1.0.1      # files + this tag
import { readFileSync } from "node:fs";

function read(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

const pkg = read("package.json");
const lock = read("package-lock.json");
const manifest = read("manifest.json");
const versions = read("versions.json");
const version = manifest.version;

const problems = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) {
	problems.push(`manifest.json version "${version}" is not a plain x.y.z (no "v" prefix, no suffix).`);
}
if (pkg.version !== version) {
	problems.push(`package.json version "${pkg.version}" != manifest.json "${version}".`);
}
if (lock.version !== version || lock.packages?.[""]?.version !== version) {
	problems.push(`package-lock.json root version does not match manifest.json "${version}".`);
}
if (!(version in versions)) {
	problems.push(`versions.json has no entry for "${version}".`);
}

const tag = process.argv[2];
if (tag !== undefined) {
	if (/^v/i.test(tag)) {
		problems.push(`release tag "${tag}" must not start with "v"; Obsidian expects "${version}".`);
	} else if (tag !== version) {
		problems.push(`release tag "${tag}" != manifest.json version "${version}".`);
	}
}

if (problems.length > 0) {
	console.error("Version check failed:");
	for (const p of problems) console.error("  - " + p);
	process.exit(1);
}

console.log(`Version check passed: ${version}${tag !== undefined ? ` (tag ${tag})` : ""}.`);
