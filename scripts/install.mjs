#!/usr/bin/env node
/**
 * dsh-opencodego-multikey installer.
 *
 * Copies the package into the web profile's node_modules and adds the
 * cordis patch entry so the gateway mounts at the next `dsh web` start.
 *
 *   npx --yes github:<owner>/dsh-opencodego-multikey
 *   node scripts/install.mjs [--check|--dry-run|--no-enable|--help]
 *
 * Set DSH_HOME to override the default ~/.dsh location.
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const knownFlags = new Set(["--check", "--dry-run", "--no-enable", "--help"]);
const args = new Set(process.argv.slice(2));
for (const arg of args) {
	if (!knownFlags.has(arg)) {
		console.error(`Unknown option: ${arg}`);
		process.exit(2);
	}
}

if (args.has("--help")) {
	console.log(`dsh-opencodego-multikey installer

Usage:
  npx --yes github:<owner>/dsh-opencodego-multikey [options]

Options:
  --check      Verify the installed package and Cordis patch without changing them
  --dry-run    Print the resolved paths and planned changes
  --no-enable  Install files without editing cordis.patch.yml
  --help       Show this help

Set DSH_HOME to override the default ~/.dsh location.`);
	process.exit(0);
}

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePackage = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const target = join(dshHome, "profiles", "web", "node_modules", "dsh-opencodego-multikey");
const patchPath = join(dshHome, "profiles", "web", "cordis.patch.yml");
const pluginLine = /^\s+name:\s*dsh-opencodego-multikey\s*$/m;
const patchBlock = `# dsh-opencodego-multikey: OpenCode Go multi-key gateway (proxy + pool + usage)
- insert:
    - id: opencodego-multikey
      name: dsh-opencodego-multikey
`;

function enablePluginInPatch(text) {
	const base = String(text ?? "");
	if (pluginLine.test(base)) return base;
	return base.trim() === "" ? patchBlock : `${base.trimEnd()}\n\n${patchBlock}`;
}

async function readOptional(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

async function verify(expectEnabled) {
	const installedRaw = await readOptional(join(target, "package.json"));
	if (installedRaw === null) throw new Error(`package is not installed at ${target}`);
	const installed = JSON.parse(installedRaw);
	if (installed.name !== sourcePackage.name) {
		throw new Error(`installed package is ${installed.name ?? "unknown"}; expected ${sourcePackage.name}`);
	}
	if (expectEnabled) {
		const patch = await readOptional(patchPath);
		if (patch === null || !pluginLine.test(patch)) {
			throw new Error(`expected a dsh-opencodego-multikey entry in ${patchPath}`);
		}
	}
	console.log(`Verified ${sourcePackage.name}@${sourcePackage.version}`);
	console.log(`  package: ${target}`);
	if (expectEnabled) console.log(`  patch:   ${patchPath}`);
}

const enable = !args.has("--no-enable");
if (args.has("--dry-run")) {
	console.log(`Would install ${sourcePackage.name}@${sourcePackage.version}`);
	console.log(`  package: ${target}`);
	console.log(`  patch:   ${enable ? patchPath : "unchanged (--no-enable)"}`);
	process.exit(0);
}

if (args.has("--check")) {
	await verify(enable);
	process.exit(0);
}

await mkdir(target, { recursive: true });
for (const entry of ["lib", "cordis.patch.yml", "package.json", "README.md", "LICENSE", "SECURITY.md"]) {
	await cp(join(sourceRoot, entry), join(target, entry), { recursive: true, force: true });
}
await mkdir(join(target, "scripts"), { recursive: true });
await cp(fileURLToPath(import.meta.url), join(target, "scripts", "install.mjs"), { force: true });

if (enable) {
	await mkdir(dirname(patchPath), { recursive: true });
	const current = await readOptional(patchPath) ?? "";
	const enabledPatch = enablePluginInPatch(current);
	if (enabledPatch !== current) await writeFile(patchPath, enabledPatch, "utf8");
}

await verify(enable);
console.log("Installation complete. Restart `dsh web`, then hard-refresh the browser.");
console.log(`Next: add your OpenCode Go API keys from the sidebar "Go 多Key" panel, then`);
console.log(`point the opencode-go provider route's baseURL at http://127.0.0.1:19781`);
console.log(`(see README.md -> 配置 DSH 供应商).`);