import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

export default defineConfig(
	globalIgnores([
		"node_modules",
		".test-build",
		"tmp",
		"main.js",
		"esbuild.config.mjs",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"versions.json",
		"examples"
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json"]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"]
			}
		}
	},
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", {
				brands: [
					"AirTurn", "AirTurns", "ChordPro", "ChordPro Studio", "Markdown", "Nashville",
					"PraiseCharts", "SongSelect", "Ultimate Guitar", "iA Writer Mono", "Menlo"
				],
				acronyms: ["CC", "CCLI", "MIDI", "PDF", "YAML", "YYYY-MM-DD"],
				enforceCamelCaseLower: true
			}]
		}
	},
	{
		files: ["src/ui/settings.ts"],
		rules: {
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
			"@typescript-eslint/no-deprecated": "off"
		}
	}
);
