/**
 * What is on disk for each installed extension directory, gathered so that a bug report says which
 * build it is about before it says anything else (D53).
 *
 * This is the same question `rigline status` answers, asked in more detail and asked in a way that
 * cannot fail: `status` is run by a person who can read a thrown `UserError` and fix it, while
 * `doctor` is run by a person whose panel has just misbehaved, and a diagnostic that aborts on the
 * first odd directory is a diagnostic that never reaches the logs. Every failure here becomes a
 * line in `problems` and the walk continues.
 *
 * Whether a bundle is patched is judged against its backup and never against the marker comment
 * (D38), by calling the same `verdict` and `hostVerdict` the installer uses. Two answers to one
 * question is how a report and a repair come to disagree.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HOST_BACKUP, WEBVIEW_BACKUP } from "../extension/bundles.ts";
import { extensionVersion } from "../extension/locate.ts";
import type { PatchOutcome } from "../inject/hostpatch.ts";
import { hostVerdict, inspect, type Verdict, verdict } from "../inject/inject.ts";

/** A file's identity for a report: where it is, how big, and when it last changed. */
export interface FileFact {
  readonly path: string;
  readonly size: number;
  /** Epoch milliseconds. Rendered by the formatter, so the report has one time format, not two. */
  readonly modifiedMs: number;
}

/** One plugin as the loader will find it: read back out of the baked registry, not re-discovered. */
export interface BakedPlugin {
  readonly name: string;
  readonly surfaces: readonly string[];
  /** Why this plugin's host patch did not apply, as the installer recorded it, or null. */
  readonly patchRefusal: string | null;
}

export interface BakedRegistry {
  readonly plugins: readonly BakedPlugin[];
  readonly patches: readonly PatchOutcome[];
  /** Why the registry could not be read, or null. Never thrown: see the module comment. */
  readonly problem: string | null;
}

export interface InstallState {
  readonly ext: string;
  readonly version: string | null;
  readonly webview: Verdict;
  readonly host: Verdict;
  readonly markerPresent: boolean;
  readonly webviewBackup: FileFact | null;
  readonly hostBackup: FileFact | null;
  readonly payloadDir: string;
  /** The payload files as installed: `pre.js`, `post.js`, `generated.js`, `registry.js`. */
  readonly payload: readonly FileFact[];
  readonly registry: BakedRegistry;
  readonly problems: readonly string[];
}

/** `statSync` that answers null rather than throwing, for a path that may simply not be there. */
export function fileFact(path: string): FileFact | null {
  try {
    const stat = statSync(path);
    return { path, size: stat.size, modifiedMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

const PLUGINS_MARKER = "export const plugins = [";
const PATCHES_MARKER = "export const patches = ";

/**
 * Reads the `registry.js` the installer baked, without evaluating it.
 *
 * Importing it would be shorter and is the wrong shape twice over: it is generated JavaScript in a
 * directory a misbehaving install may have left half-written, and running it to find out what went
 * wrong is how a diagnostic becomes the second failure. So it is parsed as text, against the exact
 * shape `bakeRegistry` writes — one JSON object per line inside the array, and the whole patch
 * array on a single line because `JSON.stringify` never wraps. The test for this function round
 * trips through `bakeRegistry` itself, so the two cannot drift apart quietly.
 */
export function parseRegistry(source: string): BakedRegistry {
  const plugins: BakedPlugin[] = [];
  let patches: PatchOutcome[] = [];
  const problems: string[] = [];

  const pluginsAt = source.indexOf(PLUGINS_MARKER);
  if (pluginsAt === -1) {
    problems.push("no plugin list");
  } else {
    const rest = source.slice(pluginsAt + PLUGINS_MARKER.length);
    const end = rest.indexOf("\n];");
    const body = end === -1 ? rest : rest.slice(0, end);
    for (const line of body.split("\n")) {
      const text = line.trim().replace(/,$/, "");
      if (text.length === 0) continue;
      try {
        const entry = JSON.parse(text) as {
          name?: unknown;
          surfaces?: unknown;
          patchRefusal?: unknown;
        };
        plugins.push({
          name: typeof entry.name === "string" ? entry.name : "(unnamed)",
          surfaces: Array.isArray(entry.surfaces) ? entry.surfaces.map(String) : [],
          patchRefusal: typeof entry.patchRefusal === "string" ? entry.patchRefusal : null,
        });
      } catch {
        problems.push("a plugin entry is not valid JSON");
      }
    }
  }

  const patchesAt = source.indexOf(PATCHES_MARKER);
  if (patchesAt === -1) {
    problems.push("no patch list");
  } else {
    const rest = source.slice(patchesAt + PATCHES_MARKER.length);
    const lineEnd = rest.indexOf("\n");
    const line = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim().replace(/;$/, "");
    try {
      const parsed: unknown = JSON.parse(line);
      if (Array.isArray(parsed)) patches = parsed as PatchOutcome[];
      else problems.push("the patch list is not an array");
    } catch {
      problems.push("the patch list is not valid JSON");
    }
  }

  return { plugins, patches, problem: problems.length > 0 ? problems.join("; ") : null };
}

const PAYLOAD_FILES = ["pre.js", "post.js", "generated.js", "registry.js"];

/**
 * Everything one extension directory can say about itself, with no way to throw.
 *
 * A directory that is not an extension at all still produces a row, because the fact that
 * `~/.vscode/extensions` holds something named like Claude Code that is missing `webview/index.js`
 * is itself the answer to "why is the panel blank".
 */
export function installState(ext: string): InstallState {
  const problems: string[] = [];
  let version: string | null = null;
  try {
    version = extensionVersion(ext);
  } catch (error) {
    problems.push(`version unreadable: ${message(error)}`);
  }

  let payloadDir = join(ext, "webview", "rigline");
  let webview: Verdict = "unknown";
  let host: Verdict = "unknown";
  let markerPresent = false;
  try {
    const state = inspect(ext);
    payloadDir = state.payloadDir;
    markerPresent = state.markerPresent;
    webview = verdict(state);
    host = hostVerdict(state);
  } catch (error) {
    problems.push(message(error));
  }

  const payload: FileFact[] = [];
  for (const name of PAYLOAD_FILES) {
    const fact = fileFact(join(payloadDir, name));
    if (fact) payload.push(fact);
    else if (webview === "patched") problems.push(`the payload is missing ${name}`);
  }

  const registryPath = join(payloadDir, "registry.js");
  let registry: BakedRegistry = { plugins: [], patches: [], problem: "not installed" };
  if (existsSync(registryPath)) {
    try {
      registry = parseRegistry(readFileSync(registryPath, "utf8"));
    } catch (error) {
      registry = { plugins: [], patches: [], problem: message(error) };
    }
  }

  return {
    ext,
    version,
    webview,
    host,
    markerPresent,
    webviewBackup: fileFact(join(ext, WEBVIEW_BACKUP)),
    hostBackup: fileFact(join(ext, HOST_BACKUP)),
    payloadDir,
    payload,
    registry,
    problems,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every extension directory this machine has, in the order `installedExtensions` gives them, each
 * inspected independently. `exts` is taken rather than discovered so a maintainer can run the
 * collector over a copy of somebody else's install directory (D39 forbids a test pointing at a
 * live one, and the same escape hatch serves both).
 */
export function installStates(exts: readonly string[]): InstallState[] {
  return exts.map(installState);
}
