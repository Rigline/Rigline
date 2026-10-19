/**
 * The environment of a run that must reach no editor, shared by every test that runs an injecting
 * verb: `code` is on this machine's `PATH`, and VS Code's profiles are found through `APPDATA`,
 * `XDG_CONFIG_HOME` and the `VSCODE_*` variables, none of which a mocked `homedir` moves (D39).
 */
import { dirname, join } from "node:path";

/** Matched without case, since Windows spells `PATH` as `Path` and reads either. */
const DROPPED = /^(path|vscode_.*)$/i;

/** The variables set afresh: a `PATH` holding only this Node, and every home under `user`. */
function placed(user: string): Record<string, string> {
  return {
    PATH: dirname(process.execPath),
    HOME: user,
    USERPROFILE: user,
    APPDATA: join(user, "AppData", "Roaming"),
    XDG_CONFIG_HOME: join(user, ".config"),
  };
}

/** `env` with no editor reachable through it, for a child process. */
export function editorless(user: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => !DROPPED.test(key))),
    ...placed(user),
  };
}

/** The same, as the `vi.stubEnv` calls that make this process's environment so, in order. */
export function editorlessStubs(
  user: string,
  env: NodeJS.ProcessEnv = process.env,
): [string, string | undefined][] {
  return [
    ...Object.keys(env)
      .filter((key) => DROPPED.test(key))
      .map((key): [string, undefined] => [key, undefined]),
    ...Object.entries(placed(user)),
  ];
}
