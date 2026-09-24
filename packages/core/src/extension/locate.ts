/**
 * Locating installed Claude Code extension directories and ordering them by their real version,
 * never lexically: "2.1.59" sorts above "2.1.263" as a string, and both can be on disk at once
 * during the window an update is installing (D4 — every installed version gets patched, because
 * VS Code keeps serving the old directory to a window that was already open).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UserError } from "../errors.ts";

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

/**
 * Every installed Claude Code extension directory, oldest version first. `[]` when the extensions
 * directory does not exist, rather than throwing: a machine with nothing installed yet is not an
 * error until something asks for one by name.
 */
export function installedExtensions(extensionsDir = EXTENSIONS_DIR): string[] {
  if (!existsSync(extensionsDir)) {
    return [];
  }
  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(EXTENSION_NAME_PREFIX))
    .map((entry) => entry.name)
    .sort(compareVersions)
    .map((name) => join(extensionsDir, name));
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
  if (!existsSync(manifestPath)) {
    throw new UserError(`${ext} has no package.json; it is not an extension directory`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new UserError(`${manifestPath} has no "version" field`);
  }
  return manifest.version;
}
