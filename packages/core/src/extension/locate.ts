/**
 * Locating installed Claude Code extension directories and ordering them by their real version,
 * never lexically: "2.1.59" sorts above "2.1.263" as a string, and both can be on disk at once
 * during the window an update is installing (D4 — every installed version gets patched, because
 * VS Code keeps serving the old directory to a window that was already open).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DamagedExtensionError, UserError } from "../errors.ts";

/**
 * VS Code's own, and the only one injected. The companion's copy is `injectedDir` in
 * `packages/vscode/src/scope.ts`.
 */
export const EXTENSIONS_DIR = join(homedir(), ".vscode", "extensions");
/** The URL scheme of the product whose extensions `EXTENSIONS_DIR` holds. */
export const URL_SCHEME = "vscode";
export const EXTENSION_NAME_PREFIX = "anthropic.claude-code-";

/** The first three numeric groups in a directory name, which are always the version. */
function versionKey(name: string): readonly number[] {
  return (name.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

/** Numeric comparison of directory names; a missing component sorts lower than any real one. */
function compareVersions(a: string, b: string): number {
  const keyA = versionKey(a);
  const keyB = versionKey(b);
  for (let i = 0; i < 3; i++) {
    const diff = (keyA[i] ?? -1) - (keyB[i] ?? -1);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Every directory named as a Claude Code version, oldest first. */
function versionDirs(extensionsDir: string): string[] {
  if (!existsSync(extensionsDir)) {
    return [];
  }
  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(EXTENSION_NAME_PREFIX))
    .map((entry) => entry.name)
    .sort(compareVersions)
    .map((name) => join(extensionsDir, name));
}

/**
 * Whether `dir` holds nothing but Rigline's own `webview/rigline/`: what an install leaves in a
 * version VS Code deleted under it (D113).
 */
export function isLeftover(dir: string): boolean {
  try {
    const top = readdirSync(dir);
    if (top.length !== 1 || top[0] !== "webview") return false;
    const webview = readdirSync(join(dir, "webview"), { withFileTypes: true });
    return webview.length === 1 && webview[0]?.name === "rigline" && webview[0].isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every installed Claude Code extension directory, oldest version first, leftovers aside. `[]` when
 * the extensions directory does not exist, rather than throwing: a machine with nothing installed
 * yet is not an error until something asks for one by name.
 */
export function installedExtensions(extensionsDir = EXTENSIONS_DIR): string[] {
  return versionDirs(extensionsDir).filter((dir) => !isLeftover(dir));
}

/** The directories `installedExtensions` passes over, which `install` and `restore` remove. */
export function leftoverExtensions(extensionsDir = EXTENSIONS_DIR): string[] {
  return versionDirs(extensionsDir).filter(isLeftover);
}

/** The newest installed extension directory. */
export function findExtension(extensionsDir = EXTENSIONS_DIR): string {
  const newest = installedExtensions(extensionsDir).at(-1);
  if (newest === undefined) {
    throw new UserError(`no Claude Code extension found under ${extensionsDir}`);
  }
  return newest;
}

/** Every installed extension directory except the newest — the ones an update left behind. */
export function supersededExtensions(extensionsDir = EXTENSIONS_DIR): string[] {
  return installedExtensions(extensionsDir).slice(0, -1);
}

/**
 * The version an extension directory reports of itself, read from its `package.json` rather than
 * parsed from the directory name: a VSIX extracted for reference has a plain version directory,
 * while the installed one carries a platform suffix, and `package.json` is where both agree.
 */
export function extensionVersion(ext: string): string {
  const manifestPath = join(ext, "package.json");
  if (!existsSync(manifestPath)) throw new DamagedExtensionError(ext, "package.json is missing");
  let manifest: { version?: unknown };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
  } catch {
    throw new DamagedExtensionError(ext, "package.json is not valid JSON");
  }
  if (typeof manifest?.version !== "string") {
    throw new DamagedExtensionError(ext, "package.json has no version");
  }
  return manifest.version;
}
