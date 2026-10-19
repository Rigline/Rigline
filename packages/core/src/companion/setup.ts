/**
 * Finding VS Code's CLI and running it, and taking the companion out of every profile with it.
 *
 * The VSIX ships with the engine in `dist/bundled` (D71), so the companion this engine installs is
 * the one it was built with, and nothing is downloaded (D143).
 *
 * Written for several editors, each with its own CLI and extensions directory, and given one: the
 * engine injects VS Code's extensions directory alone, so a companion anywhere else would have
 * nothing to do. Other editors are deferred in plan.md.
 */
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import {
  cliProfile,
  DEFAULT_PROFILE,
  editorDirs,
  type ProductDirs,
  type ProfilesRead,
  readProfiles,
  uninstallArgv,
} from "./profiles.ts";

/** The VSIX inside `dist/bundled`, beside the payload and the plugins. */
export const COMPANION_VSIX = "rigline.vsix";

/**
 * The editor CLIs to look for, as names rather than paths, with the names each derives its
 * directories from. VS Code's alone, since its extensions directory is the one the engine injects
 * (`EXTENSIONS_DIR`).
 */
export const EDITOR_CLIS = [
  { cli: "code", label: "VS Code", product: "Code", dataFolder: ".vscode" },
] as const;

export interface FoundEditor extends ProductDirs {
  readonly cli: string;
  readonly label: string;
  readonly path: string;
}

export interface FindEditorsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly exists?: (path: string) => boolean;
}

/** On Windows the CLI is a shim; the extensionless name is what POSIX has. */
function namesFor(cli: string, platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? [`${cli}.cmd`, `${cli}.exe`, cli] : [cli];
}

/**
 * Every editor CLI on `PATH`.
 *
 * Unlike the companion's search for a Node (D80, D73), taking the shim here is correct: a shim is
 * how VS Code ships its CLI, and there is no pairing to preserve — we are launching a program, not
 * choosing a runtime for something else to execute.
 */
export function findEditors(options: FindEditorsOptions = {}): readonly FoundEditor[] {
  const { env = process.env, platform = process.platform, exists = existsSync } = options;
  const dirs = (env.PATH ?? env.Path ?? env.path ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((dir) => dir !== "" && isAbsolute(dir));

  const found: FoundEditor[] = [];
  for (const { cli, label, product, dataFolder } of EDITOR_CLIS) {
    for (const dir of dirs) {
      const hit = namesFor(cli, platform)
        .map((name) => join(dir, name))
        .find(exists);
      if (hit !== undefined) {
        found.push({ cli, label, product, dataFolder, path: hit });
        break;
      }
    }
  }
  return found;
}

/**
 * How to spawn an editor CLI, which on Windows is not "just spawn it".
 *
 * VS Code ships its CLI as `code.cmd`, and since the BatBadBut fix (CVE-2024-27980) Node refuses to
 * spawn a `.cmd` or `.bat` directly: it throws `EINVAL` before the process exists, because the only
 * way Windows runs a batch file is through a command interpreter, and passing arguments to one
 * safely is not something `spawn` can do on the caller's behalf.
 *
 * So a batch file goes through `cmd.exe` explicitly. `/d` skips AutoRun scripts, `/s` fixes how the
 * remainder is parsed, and `windowsVerbatimArguments` stops Node quoting a string that is already
 * quoted. Everything is wrapped in one outer pair of quotes, which is what `/s` then strips — the
 * shape `npm` and `cross-spawn` both use, and arrived at for the same reason rather than by taste.
 *
 * Exported and pure so a test can assert the argv on either platform. The spawn itself belongs to
 * the caller; this only says what to spawn, which is the part that was wrong.
 *
 * Hidden, because the engine may be running under the companion, which has no console to lend.
 */
export function editorSpawn(
  command: string,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string = process.env.ComSpec ?? "cmd.exe",
): [
  string,
  string[],
  { stdio: ["ignore", "pipe", "pipe"]; windowsHide: true; windowsVerbatimArguments?: boolean },
] {
  const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return [command, [...argv], { stdio, windowsHide: true }];
  }
  const line = [command, ...argv].map((part) => `"${part}"`).join(" ");
  return [
    comspec,
    ["/d", "/s", "/c", `"${line}"`],
    { stdio, windowsHide: true, windowsVerbatimArguments: true },
  ];
}

export interface ProfileOutcome {
  readonly profile: string;
  readonly code: number;
  readonly output: string;
}

export interface RemovalOutcome {
  readonly editor: FoundEditor;
  readonly results: readonly ProfileOutcome[];
  /** Why the profiles could not be read, when they could not; the default profile was used. */
  readonly unread?: string;
}

export interface RemovalOptions {
  readonly editors: readonly FoundEditor[];
  /** An editor's profiles. Defaults to reading them where `editorDirs` says they are. */
  readonly profilesOf?: (editor: FoundEditor) => ProfilesRead;
  run(command: string, argv: readonly string[]): Promise<{ code: number; output: string }>;
}

/** Take the companion out of every profile that lists it, in each editor given (D143). */
export async function removeCompanion(options: RemovalOptions): Promise<readonly RemovalOutcome[]> {
  const profilesOf =
    options.profilesOf ??
    ((editor: FoundEditor) => {
      const dirs = editorDirs(editor);
      return readProfiles(dirs.userData, dirs.extensionsDir);
    });
  const outcomes: RemovalOutcome[] = [];
  for (const editor of options.editors) {
    const read = profilesOf(editor);
    const targets =
      read.kind === "read"
        ? read.profiles.filter((p) => !p.sharesDefault && p.companion !== null).map(cliProfile)
        : [null];
    const results: ProfileOutcome[] = [];
    for (const target of targets) {
      const { code, output } = await options.run(editor.path, uninstallArgv(target));
      results.push({ profile: target ?? DEFAULT_PROFILE, code, output });
    }
    outcomes.push({ editor, results, ...(read.kind === "read" ? {} : { unread: read.why }) });
  }
  return outcomes;
}

/**
 * What a removal prints. It names the binary it used, because one machine can hold several editors
 * answering to `code`, and the path is the whole diagnosis when the wrong one answered.
 */
export function formatRemoval(outcomes: readonly RemovalOutcome[]): string {
  return outcomes
    .flatMap(({ editor, results, unread }) => [
      `${editor.label}, via ${editor.path}:`,
      ...(unread === undefined
        ? []
        : [`  its profiles could not be read, so this tried the default profile: ${unread}`]),
      ...(results.length === 0 ? ["  the companion is in none of its profiles"] : []),
      ...results.flatMap(({ profile, code, output }) =>
        code === 0
          ? [`  ${profile}: removed`]
          : [`  ${profile}: failed (${editor.cli} exited ${code})`, indent(output.trim())],
      ),
    ])
    .join("\n");
}

/** The reload a newly installed companion needs, since it starts only in a reloaded window. */
export const COMPANION_RELOAD =
  "Reload the window for the companion to start: Developer: Reload Window.";

/**
 * What `install` adds when this engine is a checkout: the setting that has the companion run it
 * rather than the released engine (D94). Printed, since VS Code's settings are not ours to write.
 */
export function checkoutEngineNote(entry: string): string {
  return [
    "",
    "This engine is a checkout. For the companion to run it rather than the released engine, add",
    "this to VS Code's user settings in every profile the companion is in, since each one writes",
    "the same Claude Code directories:",
    `  "rigline.enginePath": ${JSON.stringify(entry)}`,
  ].join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
