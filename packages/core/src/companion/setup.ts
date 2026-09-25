/**
 * Installing the companion extension, from the VSIX the engine already carries.
 *
 * Nothing is downloaded. `dist/bundled/rigline.vsix` ships with the engine (D71), so it is the
 * version this engine was built with and moves when the engine moves — a companion and an engine
 * that came from one package cannot disagree about what they are.
 *
 * Every editor found rather than one. A machine may have VS Code, Insiders, VSCodium, Cursor and
 * Windsurf, each with its own CLI and its own extensions directory, and somebody running Claude
 * Code in two of them wants the companion in both.
 */
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { bundledDir } from "../assets.ts";
import { UserError } from "../errors.ts";
import type { CompanionSettings } from "../plugins/config.ts";
import {
  cliProfile,
  DEFAULT_PROFILE,
  editorDirs,
  installArgv,
  type ProductDirs,
  type ProfilesRead,
  readProfiles,
  setupTargets,
  uninstallArgv,
} from "./profiles.ts";

/** The VSIX inside `dist/bundled`, beside the payload and the plugins. */
export const COMPANION_VSIX = "rigline.vsix";

/**
 * The editor CLIs worth looking for, as names rather than paths, with the names each derives its
 * directories from. Only VS Code's have been read on a machine; a wrong one reads as no profiles,
 * and `vscode-setup` then uses the default profile.
 */
export const EDITOR_CLIS = [
  { cli: "code", label: "VS Code", product: "Code", dataFolder: ".vscode" },
  {
    cli: "code-insiders",
    label: "VS Code Insiders",
    product: "Code - Insiders",
    dataFolder: ".vscode-insiders",
  },
  { cli: "codium", label: "VSCodium", product: "VSCodium", dataFolder: ".vscode-oss" },
  { cli: "cursor", label: "Cursor", product: "Cursor", dataFolder: ".cursor" },
  { cli: "windsurf", label: "Windsurf", product: "Windsurf", dataFolder: ".windsurf" },
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
 */
export function editorSpawn(
  command: string,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string = process.env.ComSpec ?? "cmd.exe",
): [string, string[], { stdio: ["ignore", "pipe", "pipe"]; windowsVerbatimArguments?: boolean }] {
  const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return [command, [...argv], { stdio }];
  }
  const line = [command, ...argv].map((part) => `"${part}"`).join(" ");
  return [comspec, ["/d", "/s", "/c", `"${line}"`], { stdio, windowsVerbatimArguments: true }];
}

export interface ProfileOutcome {
  readonly profile: string;
  readonly code: number;
  readonly output: string;
}

export interface SetupOutcome {
  readonly editor: FoundEditor;
  readonly results: readonly ProfileOutcome[];
  /** Left out by `companion.skipProfiles`. */
  readonly skipped: readonly string[];
  /** Profiles with neither Claude Code nor the companion, counted rather than named. */
  readonly others: number;
  /** Why the profiles could not be read, when they could not; the default profile was used. */
  readonly unread?: string;
  /** Set when `--profile` named a profile this editor does not have. */
  readonly absent?: string;
}

export interface SetupOptions {
  readonly remove?: boolean;
  readonly editors?: readonly FoundEditor[];
  readonly vsix?: string;
  /** One profile, by name, rather than every profile the settings pick. */
  readonly profile?: string;
  readonly settings: CompanionSettings;
  /** An editor's profiles. Defaults to reading them where `editorDirs` says they are. */
  readonly profilesOf?: (editor: FoundEditor) => ProfilesRead;
  run(command: string, argv: readonly string[]): Promise<{ code: number; output: string }>;
}

/** Where the bundled VSIX is, refusing by name when an engine was built without one. */
export function companionVsix(): string {
  const path = join(bundledDir(), COMPANION_VSIX);
  if (!existsSync(path)) {
    throw new UserError(
      `this engine carries no companion extension at ${path}. ` +
        "It was built without one; a newer engine will have it.",
    );
  }
  return path;
}

/**
 * Install (or remove) the companion in every editor found, and in each, every profile that has
 * Claude Code or the companion, less the skipped (D100).
 *
 * Finding none is a refusal rather than a silent success, and it names the alternative: a person
 * with no CLI on PATH can still do this from the Command Palette, and telling them so is cheaper
 * than us writing into an extensions directory ourselves — which would be patching VS Code's own
 * state to install a patcher.
 */
export async function setupCompanion(options: SetupOptions): Promise<readonly SetupOutcome[]> {
  const remove = options.remove ?? false;
  const editors = options.editors ?? findEditors();
  if (editors.length === 0) {
    throw new UserError(
      "no VS Code command-line tool was found on PATH, so the companion cannot be installed for " +
        "you. Install it from the Command Palette with “Extensions: Install from VSIX…” " +
        `and pick ${remove ? "the Rigline extension to uninstall" : companionVsix()}. ` +
        "On macOS the CLI is added by “Shell Command: Install 'code' command in PATH”.",
    );
  }

  const vsix = remove ? "" : (options.vsix ?? companionVsix());
  const profilesOf =
    options.profilesOf ??
    ((editor: FoundEditor) => {
      const dirs = editorDirs(editor);
      return readProfiles(dirs.userData, dirs.extensionsDir);
    });

  const reads = editors.map((editor) => ({ editor, read: profilesOf(editor) }));
  const plans = reads.map(({ editor, read }) => ({ editor, ...planFor(read, options) }));
  const named = options.profile;
  if (named !== undefined && plans.every((p) => p.absent !== undefined)) {
    const known = new Set(
      reads.flatMap(({ read }) => (read.kind === "read" ? read.profiles.map((p) => p.name) : [])),
    );
    const list = [...known].map((n) => `"${n}"`).join(", ");
    throw new UserError(`no editor has a profile called "${named}". Its profiles are ${list}`);
  }

  const outcomes: SetupOutcome[] = [];
  for (const { editor, targets, ...rest } of plans) {
    const results: ProfileOutcome[] = [];
    for (const target of targets) {
      const argv = remove ? uninstallArgv(target) : installArgv(vsix, target, true);
      const { code, output } = await options.run(editor.path, argv);
      results.push({ profile: target ?? DEFAULT_PROFILE, code, output });
    }
    outcomes.push({ editor, results, ...rest });
  }
  return outcomes;
}

/** One editor's part: the CLI's profile names to act on, null being the default profile. */
function planFor(
  read: ProfilesRead,
  options: SetupOptions,
): {
  targets: (string | null)[];
  skipped: string[];
  others: number;
  unread?: string;
  absent?: string;
} {
  const profiles = read.kind === "read" ? read.profiles : null;
  const none = { skipped: [], others: 0, ...(read.kind === "read" ? {} : { unread: read.why }) };

  const named = options.profile;
  if (named !== undefined) {
    if (profiles !== null && !profiles.some((p) => p.name === named)) {
      return { ...none, targets: [], absent: named };
    }
    return { ...none, targets: [named === DEFAULT_PROFILE ? null : named] };
  }
  if (profiles === null) return { ...none, targets: [null] };
  if (options.remove) {
    const holding = profiles.filter((p) => !p.sharesDefault && p.companion);
    return { ...none, targets: holding.map(cliProfile) };
  }
  const { targets, skipped } = setupTargets(profiles, options.settings);
  const own = profiles.filter((p) => !p.sharesDefault).length;
  return {
    ...none,
    targets: targets.map(cliProfile),
    skipped: skipped.map((p) => p.name),
    others: own - targets.length - skipped.length,
  };
}

/**
 * What the command prints.
 *
 * **It names the binary it used, and the VSIX, and it does so on success.** One machine can hold
 * several editors that share the name `code` and share nothing else — a second install, Insiders
 * beside stable, a portable copy, a remote window whose extension host is somewhere else entirely —
 * and `--install-extension` will cheerfully succeed into the one you are not looking at. `installed`
 * on its own is then true and useless: the extension is listed by the CLI, absent from the editor,
 * and there is nothing on screen to suggest where to look. The path is the whole diagnosis, and it
 * costs one line.
 *
 * The VSIX path is printed for the same reason. When the CLI has picked the wrong editor the repair
 * is *Extensions: Install from VSIX…* in the right one, and that needs a file the user would
 * otherwise have to be told how to find.
 *
 * **And it names every profile it touched or left out**, since a profile without the companion is a
 * window where Rigline stops working with nothing on screen to say why (D100).
 */
export function formatSetup(
  outcomes: readonly SetupOutcome[],
  remove: boolean,
  vsix?: string,
  note?: string,
): string {
  const changed = outcomes.some((o) => o.results.some((r) => r.code === 0));
  const unread = outcomes.some((o) => o.unread !== undefined);
  return [
    `${remove ? "Removing" : "Installing"} the companion in ${outcomes.length} editor${outcomes.length === 1 ? "" : "s"}:`,
    ...outcomes.flatMap((outcome) => editorLines(outcome, remove)),
    ...(note === undefined ? [] : ["", note]),
    // An install's reload is the last line of the injection that follows it (D98).
    ...(changed && remove
      ? ["", "Reload the window for it to take effect: Developer: Reload Window."]
      : []),
    ...(changed && !remove && vsix !== undefined ? whyNotVisible(vsix, unread) : []),
  ].join("\n");
}

function editorLines(outcome: SetupOutcome, remove: boolean): string[] {
  const { editor, results, skipped, others, unread, absent } = outcome;
  const lines = [`  ${editor.label}, via ${editor.path}`];
  if (unread !== undefined) {
    lines.push(`    its profiles could not be read, so this used the default profile: ${unread}`);
  }
  if (absent !== undefined) lines.push(`    it has no profile called "${absent}"`);
  else if (results.length === 0) {
    lines.push(`    ${remove ? "the companion is in none of its profiles" : "nothing to install"}`);
  }
  for (const { profile, code, output } of results) {
    lines.push(
      code === 0
        ? `    ${profile}: ${remove ? "removed" : "installed"}`
        : `    ${profile}: failed (${editor.cli} exited ${code})`,
    );
    if (code !== 0) lines.push(indent(output.trim()));
  }
  for (const name of skipped) lines.push(`    ${name}: skipped, by companion.skipProfiles`);
  if (others > 0) {
    lines.push(`    ${others} other profile${others === 1 ? " has" : "s have"} no Claude Code`);
  }
  return lines;
}

/** The reload a newly installed companion needs, since it starts only in a reloaded window. */
export const COMPANION_RELOAD =
  "Reload the window for the companion to start: Developer: Reload Window.";

/**
 * The ways an install can succeed and leave nothing to see: a different editor answering to `code`,
 * and a profile, but only where the profiles could not be read.
 */
function whyNotVisible(vsix: string, unread: boolean): readonly string[] {
  if (!unread) {
    return [
      "",
      "Not in the Extensions view afterwards? Then that `code` was a different editor answering",
      "to the same name. Use Extensions: Install from VSIX… in the window you want, with:",
      `  ${vsix}`,
    ];
  }
  return [
    "",
    "Not in the Extensions view afterwards? Two causes, and they look identical.",
    "  A profile. Where the profiles could not be read, this went to the default one only, and a",
    "  workspace bound to another will not see it. Re-run with --profile NAME, using the name in",
    "  VS Code's profile switcher.",
    "  A different editor answering to the same `code`. Use Extensions: Install from VSIX… in",
    "  the window you actually want, with:",
    `    ${vsix}`,
  ];
}

/**
 * What `vscode-setup` adds when this engine is a checkout: the setting that has the companion run
 * it rather than the released engine (D94). Printed, since VS Code's settings are not ours to write.
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
    .map((line) => `      ${line}`)
    .join("\n");
}
