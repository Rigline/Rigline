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

/** The VSIX inside `dist/bundled`, beside the payload and the plugins. */
export const COMPANION_VSIX = "rigline.vsix";

/**
 * The editor CLIs worth looking for, as names rather than paths.
 *
 * Forks of VS Code keep the extension API and rename the binary, so this is the whole of what
 * varies between them as far as installing a VSIX goes. A name here that nothing on the machine
 * answers to costs one `existsSync` per PATH entry.
 */
export const EDITOR_CLIS = [
  { cli: "code", label: "VS Code" },
  { cli: "code-insiders", label: "VS Code Insiders" },
  { cli: "codium", label: "VSCodium" },
  { cli: "cursor", label: "Cursor" },
  { cli: "windsurf", label: "Windsurf" },
] as const;

export interface FoundEditor {
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
  for (const { cli, label } of EDITOR_CLIS) {
    for (const dir of dirs) {
      const hit = namesFor(cli, platform)
        .map((name) => join(dir, name))
        .find(exists);
      if (hit !== undefined) {
        found.push({ cli, label, path: hit });
        break;
      }
    }
  }
  return found;
}

/**
 * The argv for one editor.
 *
 * `--force` so a re-run is a no-op rather than a refusal about a version already installed, which
 * matters because `update` will want to call this behind the user.
 *
 * `--profile` because without it the CLI installs into the *default* profile, and a workspace bound
 * to any other one never sees the companion while every check says it is installed.
 */
export function setupArgv(vsix: string, remove: boolean, profile?: string): readonly string[] {
  const forProfile = profile === undefined ? [] : ["--profile", profile];
  return remove
    ? ["--uninstall-extension", "rigline.rigline", ...forProfile]
    : ["--install-extension", vsix, "--force", ...forProfile];
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

export interface SetupOutcome {
  readonly editor: FoundEditor;
  readonly code: number;
  readonly output: string;
}

export interface SetupOptions {
  readonly remove?: boolean;
  readonly editors?: readonly FoundEditor[];
  readonly vsix?: string;
  /** The VS Code profile to install into. Absent means the default one, which is the CLI's own. */
  readonly profile?: string;
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
 * Install (or remove) the companion in every editor found.
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
  const outcomes: SetupOutcome[] = [];
  for (const editor of editors) {
    const argv = setupArgv(vsix, remove, options.profile);
    const { code, output } = await options.run(editor.path, argv);
    outcomes.push({ editor, code, output });
  }
  return outcomes;
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
 * **And it names profiles, because the other diagnosis is one a profile user will correctly
 * reject.** Told that `code` was a different install, somebody with profiles checks — same editor,
 * same binary, same extensions directory — finds it false, and is left with nothing. Every symptom
 * is identical and the cause is that the CLI installs into the default profile while their
 * workspace is bound to another.
 */
export function formatSetup(
  outcomes: readonly SetupOutcome[],
  remove: boolean,
  vsix?: string,
  profile?: string,
): string {
  const into = profile === undefined ? "the default profile" : `profile “${profile}”`;
  const lines = outcomes.flatMap(({ editor, code, output }) =>
    code === 0
      ? [
          `  ${editor.label}: ${remove ? "removed" : "installed"}, in ${into}`,
          `    via ${editor.path}`,
        ]
      : [`  ${editor.label}: failed (${editor.cli} exited ${code})`, indent(output.trim())],
  );
  const changed = outcomes.some((o) => o.code === 0);
  return [
    `${remove ? "Removing" : "Installing"} the companion in ${outcomes.length} editor${outcomes.length === 1 ? "" : "s"}:`,
    ...lines,
    ...(changed
      ? [
          "",
          "Reload the window for it to take effect: Developer: Reload Window.",
          ...(remove || vsix === undefined ? [] : whyNotVisible(vsix, profile)),
        ]
      : []),
  ].join("\n");
}

/**
 * The two ways an install can succeed and leave nothing to see, or the one that is left once a
 * profile has been named. Counted honestly: saying "two causes" and listing one is the kind of
 * small wrongness that makes a reader stop trusting the rest of the paragraph.
 */
function whyNotVisible(vsix: string, profile?: string): readonly string[] {
  if (profile !== undefined) {
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
    "  A profile. Extensions are per-profile and this went to the default one, so a workspace",
    "  bound to another will not see it. Re-run with --profile NAME, using the name in VS Code's",
    "  profile switcher, copied rather than typed — an unknown name creates a new empty profile",
    "  instead of failing.",
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
    .map((line) => `    ${line}`)
    .join("\n");
}
