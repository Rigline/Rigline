/**
 * Where Rigline keeps a user's state (decisions.md, D30, D32).
 *
 * A clone of this repo is for developing Rigline; using it leaves nothing in the clone. Settings,
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
  /** What a person decides: plugins switched off, the layout (D91). */
  readonly config: string;
  /** Where `add` brought each plugin from (D49, D91). */
  readonly sources: string;
  /** `config.json`, which held both before D91, and is split into them once. */
  readonly legacyConfig: string;
  /** Plugins installed for this user, one directory each, discovered like any other plugin root. */
  readonly plugins: string;
  /** Local overrides and additions to the curated anchor table (D44). */
  readonly anchors: string;
  /** The last harvest, as a scan, for "what changed" after an extension update. */
  readonly baseline: string;
}

export function riglinePaths(home = riglineHome()): RiglinePaths {
  return {
    home,
    config: join(home, "config.yaml"),
    sources: join(home, "sources.json"),
    legacyConfig: join(home, "config.json"),
    plugins: join(home, "plugins"),
    anchors: join(home, "anchors.json"),
    baseline: join(home, "baseline.json"),
  };
}
