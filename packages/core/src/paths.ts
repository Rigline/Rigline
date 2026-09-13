/**
 * Where Prototype keeps a user's state (decisions.md, D30, D32).
 *
 * A clone of this repo is for developing Prototype; using it leaves nothing in the clone. Config,
 * installed plugins, the harvest baseline and class-map snapshots live under one directory in the
 * user's home, overridable for tests and for anyone who keeps dotfiles elsewhere.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const PROTOTYPE_HOME_VARIABLE = "PROTOTYPE_HOME";

/** `$PROTOTYPE_HOME`, else `~/.prototype`. */
export function prototypeHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PROTOTYPE_HOME_VARIABLE];
  return override && override.length > 0 ? override : join(homedir(), ".prototype");
}

export interface PrototypePaths {
  readonly home: string;
  /** Enabled and disabled plugins, per-plugin settings. */
  readonly config: string;
  /** Plugins installed for this user, one directory each, discovered like any other plugin root. */
  readonly plugins: string;
  /** The last harvest, as a scan, for "what changed" after an extension update. */
  readonly baseline: string;
  /** Class-map snapshots per extension version, for cross-version diffing. */
  readonly snapshots: string;
}

export function prototypePaths(home = prototypeHome()): PrototypePaths {
  return {
    home,
    config: join(home, "config.json"),
    plugins: join(home, "plugins"),
    baseline: join(home, "baseline.json"),
    snapshots: join(home, "snapshots"),
  };
}
