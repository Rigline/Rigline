/**
 * Finding a Node, because the companion is not running one.
 *
 * The wrapper never needs this: it *is* a Node process, so `process.execPath` is the answer and
 * `findNpmCli` pairs npm to it. In the extension host `process.execPath` is VS Code's Electron
 * binary — no npm beside it, and unable to run the engine's entry — so the pairing has to start
 * from a Node we go and find (D80).
 *
 * D73's rule survives intact. It says npm must belong to the Node that will run it, not that PATH
 * is untouchable; PATH is used here to find the *Node*, and `findNpmCli` then takes the npm beside
 * that one. A corepack or fnm shim on PATH is still never taken for npm itself.
 */
import { delimiter, isAbsolute, join } from "node:path";

/** Where a resolved Node came from, so a refusal and a diagnostic can say. */
export type NodeSource = "setting" | "path";

export interface FoundNode {
  readonly path: string;
  readonly source: NodeSource;
}

export interface FindNodeOptions {
  /** `rigline.nodePath`, when somebody has set it. Absolute, and taken without searching. */
  readonly setting?: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected by the tests; the real one is `existsSync`. */
  readonly exists: (path: string) => boolean;
  /** `process.platform`. Decides the executable's name, nothing else. */
  readonly platform?: NodeJS.Platform;
}

/** The names a Node executable goes by, most specific first. */
function executableNames(platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? ["node.exe", "node.cmd", "node"] : ["node"];
}

/**
 * PATH, as directories worth looking in.
 *
 * Two entries are dropped rather than searched. An empty one means the working directory on
 * Windows, which is a place an executable should never be taken from; and a relative one is the
 * same hazard wearing a name, since what it resolves against is whatever directory VS Code happened
 * to start in. Windows also lets an entry be quoted, and the quotes are not part of the path.
 */
export function searchPath(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = env.PATH ?? env.Path ?? env.path ?? "";
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const entry of raw.split(delimiter)) {
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");
    if (dir === "" || !isAbsolute(dir) || seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs;
}

/**
 * The refusal, when there is nothing to run npm with.
 *
 * Loud and repairable (P8): it says what was looked for and names the setting, because the common
 * case is not "no Node on this machine" but "a GUI-launched VS Code did not inherit the login
 * shell's PATH", which is a macOS default and invisible from inside the process.
 */
export class NoNodeError extends Error {
  readonly searched: readonly string[];

  constructor(searched: readonly string[]) {
    super(
      "Rigline could not find a Node to run npm and the engine with. " +
        `Looked on PATH in ${searched.length} director${searched.length === 1 ? "y" : "ies"}. ` +
        "Set `rigline.nodePath` to a Node executable, or launch VS Code from a shell that has one " +
        "on PATH.",
    );
    this.name = "NoNodeError";
    this.searched = searched;
  }
}

export function findNode(options: FindNodeOptions): FoundNode {
  const { setting, exists, env = process.env, platform = process.platform } = options;

  // Taken without searching and without checking it is named `node`: somebody who sets this has a
  // reason, and second-guessing it would only refuse the cases it exists for — a version manager's
  // shim, a wrapper script, a Node under a name we would not have guessed.
  if (setting !== undefined && setting.trim() !== "") {
    const path = setting.trim();
    if (!exists(path)) {
      throw new NoNodeError([`${path} (from \`rigline.nodePath\`, which does not exist)`]);
    }
    return { path, source: "setting" };
  }

  const dirs = searchPath(env);
  for (const dir of dirs) {
    for (const name of executableNames(platform)) {
      const candidate = join(dir, name);
      if (exists(candidate)) return { path: candidate, source: "path" };
    }
  }
  throw new NoNodeError(dirs);
}
