/**
 * Finding VS Code's CLI and running it, and taking the companion out of every profile for `uninstall`.
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
  type EditorDirs,
  type ProductDirs,
  type Profile,
  profilesNamed,
  type RunCli,
  readDefaultProfile,
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

export interface UninstallOptions {
  /** Where VS Code keeps its profiles and extensions. */
  readonly dirs: EditorDirs;
  /** VS Code's CLI on `PATH`, asked for only when a profile has the companion. */
  readonly findCli: () => readonly FoundEditor[];
  readonly run: RunCli;
}

export interface Uninstalled {
  /** What was done, and what is left to do by hand, for the report. */
  readonly lines: readonly string[];
  /** The profiles that still list the companion. */
  readonly kept: readonly string[];
  /** Whether some profile could not be read, so whether it still has the companion is unknown. */
  readonly unknown: boolean;
}

interface Holding {
  readonly profiles: readonly Profile[];
  /** Why some profiles could not be read; the default profile alone was looked at, if it could be. */
  readonly unread?: string;
  /** Whether even the default profile could not be read. */
  readonly blind?: boolean;
}

/** The profiles that list the companion, or the default profile alone where they cannot be read. */
function holding(dirs: EditorDirs): Holding {
  const read = readProfiles(dirs.userData, dirs.extensionsDir);
  if (read.kind === "read") {
    return { profiles: read.profiles.filter((p) => !p.sharesDefault && p.companion !== null) };
  }
  const found = readDefaultProfile(dirs.extensionsDir);
  if ("why" in found) return { profiles: [], unread: found.why, blind: true };
  return {
    profiles: found.companion === null ? [] : [found],
    ...(read.kind === "unreadable" ? { unread: read.why } : {}),
  };
}

const BY_HAND = "uninstall Rigline from the Extensions view";

/**
 * Take the companion out of every profile that lists it, for `uninstall` (D143). What is gone is
 * decided by reading `extensions.json` again, as the ensure step decides what landed.
 */
export async function uninstallCompanion(options: UninstallOptions): Promise<Uninstalled> {
  const before = holding(options.dirs);
  if (before.blind) {
    return {
      lines: [
        `VS Code's profiles could not be read: ${before.unread}; ${BY_HAND} in each that has it`,
      ],
      kept: [],
      unknown: true,
    };
  }
  const unknown = before.unread !== undefined;
  const head = unknown
    ? [
        `VS Code's profiles could not be read, so this looked at the default profile alone: ${before.unread}`,
      ]
    : [];
  const tail = unknown ? [`${BY_HAND} in any other profile that has it`] : [];
  if (before.profiles.length === 0) {
    const none = unknown
      ? "the default profile has no companion"
      : "the companion is in no VS Code profile";
    return { lines: [...head, none, ...tail], kept: [], unknown };
  }
  const [editor] = options.findCli();
  if (editor === undefined) {
    const where = before.profiles.length === 1 ? "there" : "in each";
    return {
      lines: [
        ...head,
        `${profilesNamed(before.profiles)} still ${before.profiles.length === 1 ? "has" : "have"} ` +
          `the companion, and no VS Code command-line tool was found on PATH to remove it: ${BY_HAND} ${where}`,
        ...tail,
      ],
      kept: before.profiles.map((p) => p.name),
      unknown,
    };
  }

  const cli = { command: editor.path, prefix: [] };
  const said = new Map<string, { readonly code: number; readonly output: string }>();
  for (const profile of before.profiles) {
    said.set(profile.name, await options.run(cli, uninstallArgv(cliProfile(profile))));
  }
  const left = new Set(holding(options.dirs).profiles.map((p) => p.name));
  const lines = [...head];
  for (const profile of before.profiles) {
    if (!left.has(profile.name)) {
      lines.push(`removed the companion from profile "${profile.name}"`);
      continue;
    }
    const run = said.get(profile.name);
    const why =
      run !== undefined && run.code !== 0
        ? run.output.trim().split(/\r?\n/).at(-1)?.replace(/\.$/, "") || `it exited ${run.code}`
        : `${editor.path} said it removed it, so that \`code\` is another editor`;
    lines.push(`profile "${profile.name}" still has the companion: ${why}; ${BY_HAND} there`);
  }
  return {
    lines: [...lines, ...tail],
    kept: before.profiles.filter((p) => left.has(p.name)).map((p) => p.name),
    unknown,
  };
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
