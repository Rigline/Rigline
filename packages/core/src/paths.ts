/**
 * Where Rigline keeps a user's state (decisions.md, D30, D32).
 *
 * A clone of this repo is for developing Rigline; using it leaves nothing in the clone. Config,
 * installed plugins, the anchor-table override and the harvest baseline live under one directory in
 * the user's home, overridable for tests and for anyone who keeps dotfiles elsewhere.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const RIGLINE_HOME_VARIABLE = "RIGLINE_HOME";

/** `$RIGLINE_HOME`, else `~/.rigline`. */
export function riglineHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[RIGLINE_HOME_VARIABLE];
  return override && override.length > 0 ? override : join(homedir(), ".rigline");
}

export interface RiglinePaths {
  readonly home: string;
  /** Enabled and disabled plugins, per-plugin settings. */
  readonly config: string;
  /** Plugins installed for this user, one directory each, discovered like any other plugin root. */
  readonly plugins: string;
  /** The last harvest, as a scan, for "what changed" after an extension update. */
  readonly baseline: string;
}

export function riglinePaths(home = riglineHome()): RiglinePaths {
  return {
    home,
    config: join(home, "config.json"),
    plugins: join(home, "plugins"),
    baseline: join(home, "baseline.json"),
  };
}
