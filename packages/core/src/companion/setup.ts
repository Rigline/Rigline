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
 */
export function setupArgv(vsix: string, remove: boolean): readonly string[] {
  return remove
    ? ["--uninstall-extension", "rigline.rigline"]
    : ["--install-extension", vsix, "--force"];
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
    const { code, output } = await options.run(editor.path, setupArgv(vsix, remove));
    outcomes.push({ editor, code, output });
  }
  return outcomes;
}

/** What the command prints. One line per editor, and a reload reminder when anything changed. */
export function formatSetup(outcomes: readonly SetupOutcome[], remove: boolean): string {
  const lines = outcomes.map(({ editor, code, output }) =>
    code === 0
      ? `  ${editor.label}: ${remove ? "removed" : "installed"}`
      : `  ${editor.label}: failed (${editor.cli} exited ${code})\n${indent(output.trim())}`,
  );
  const changed = outcomes.some((o) => o.code === 0);
  return [
    `${remove ? "Removing" : "Installing"} the companion in ${outcomes.length} editor${outcomes.length === 1 ? "" : "s"}:`,
    ...lines,
    ...(changed ? ["", "Reload the window for it to take effect: Developer: Reload Window."] : []),
  ].join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
