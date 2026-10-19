/**
 * The ensure step: every VS Code profile with Claude Code gets a current companion before a person's
 * injection, and it refuses only where a change is needed and cannot be made (D143).
 *
 * It reads VS Code's own files and starts the CLI only to install, so the steady state costs reads.
 * What landed is decided by reading `extensions.json` again, never from the CLI's exit code: another
 * editor answering to `code` exits 0 having installed somewhere else.
 */
import { resolve, sep } from "node:path";
import { UserError } from "../errors.ts";
import { type CarriedCompanion, installedFingerprint } from "./fingerprint.ts";
import {
  cliProfile,
  DEFAULT_PROFILE,
  type EditorDirs,
  installArgv,
  type Profile,
  profilesNamed,
  readDefaultProfile,
  readProfiles,
  type RunCli,
} from "./profiles.ts";
import type { FoundEditor } from "./setup.ts";

export interface LookOptions {
  /** Where VS Code keeps its profiles and extensions. */
  readonly dirs: EditorDirs;
  /** The companion this engine carries, or null where it was built without one. */
  readonly carried: CarriedCompanion | null;
  /** Whether the companion runs this engine, so that only the build it carries is current. */
  readonly own: boolean;
}

export interface EnsureOptions extends LookOptions {
  /** VS Code's CLI on `PATH`, asked for only when a profile needs an install. */
  readonly findCli: () => readonly FoundEditor[];
  readonly run: RunCli;
  readonly platform?: NodeJS.Platform;
}

export interface Ensured {
  /** What was installed and where, said before the injection report; empty when nothing changed. */
  readonly lines: readonly string[];
  /** Each profile still without a current companion, for *Needs you*. */
  readonly needs: readonly string[];
  /** The profiles a companion went into, each of which wants a window reload. */
  readonly installed: readonly string[];
}

interface Survey {
  readonly targets: readonly Profile[];
  /** Why the default profile alone was looked at, said only beside a change. */
  readonly fallback: string | null;
  /** Why VS Code's profiles could not be read, said every time. */
  readonly unread: string | null;
}

/** The profiles with Claude Code, or the default profile where none can be found to list it. */
function survey(dirs: EditorDirs): Survey {
  const read = readProfiles(dirs.userData, dirs.extensionsDir);
  if (read.kind === "read") {
    const wanted = read.profiles.filter((p) => !p.sharesDefault && p.claudeCode);
    if (wanted.length > 0) return { targets: wanted, fallback: null, unread: null };
    return {
      targets: read.profiles.filter((p) => p.location === null),
      fallback: "no VS Code profile lists Claude Code, so this looked at the default profile alone",
      unread: null,
    };
  }
  const found = readDefaultProfile(dirs.extensionsDir);
  const fallback =
    "why" in found
      ? {
          name: DEFAULT_PROFILE,
          location: null,
          sharesDefault: false,
          claudeCode: true,
          companion: null,
        }
      : found;
  const unread =
    read.kind === "unreadable" || "why" in found
      ? `VS Code's profiles could not be read, so this looked at the default profile alone: ${
          "why" in found ? found.why : read.why
        }`
      : null;
  return {
    targets: [fallback],
    fallback: unread === null ? `${read.why}, so this looked at the default profile alone` : null,
    unread,
  };
}

/** By D99's fingerprint for the engine the companion runs, and by presence for any other (D143). */
function isCurrent(profile: Profile, options: LookOptions): boolean {
  const { companion } = profile;
  if (companion === null) return false;
  if (!options.own) return true;
  return (
    options.carried !== null &&
    companion.dir !== null &&
    installedFingerprint(companion.dir) === options.carried.fingerprint
  );
}

/** `check`'s half: what the ensure step would do, installing nothing. */
export function lookAtCompanion(options: LookOptions): Omit<Ensured, "installed"> {
  const { targets, fallback, unread } = survey(options.dirs);
  const needs = targets
    .filter((p) => !isCurrent(p, options))
    .map((p) =>
      p.companion === null
        ? `profile "${p.name}" has no companion, which \`rigline install\` puts in`
        : `profile "${p.name}" has a companion this engine does not carry, which \`rigline install\` replaces`,
    );
  const notes = [
    ...(unread === null ? [] : [unread]),
    ...(fallback !== null && needs.length > 0 ? [fallback] : []),
  ];
  return { lines: notes, needs };
}

/** Make every target current, or refuse with the report (D143). */
export async function ensureCompanion(options: EnsureOptions): Promise<Ensured> {
  const before = survey(options.dirs);
  const unread = before.unread === null ? [] : [before.unread];
  const stale = before.targets.filter((p) => !isCurrent(p, options));
  if (stale.length === 0) return { lines: unread, needs: [], installed: [] };

  const named = profilesNamed(stale);
  const needVerb = stale.length === 1 ? "needs" : "need";
  const { carried } = options;
  if (carried === null) {
    throw new UserError(
      `${named} ${needVerb} the companion, and this engine was built without one, so nothing was injected`,
    );
  }
  const [editor] = options.findCli();
  if (editor === undefined) {
    throw new UserError(
      `${named} ${needVerb} the companion this engine carries, and no VS Code command-line tool ` +
        `was found on PATH to install it, so nothing was injected. ${addCli(options.platform)} ` +
        `Or install ${carried.vsix} with Extensions: Install from VSIX… in ` +
        `${stale.length === 1 ? "that profile" : "each of them"}. Then run this again.`,
    );
  }

  const cli = { command: editor.path, prefix: [] };
  const said = new Map<string, { readonly code: number; readonly output: string }>();
  for (const profile of stale) {
    const argv = installArgv(carried.vsix, cliProfile(profile), profile.companion !== null);
    said.set(profile.name, await options.run(cli, argv));
  }

  const after = survey(options.dirs);
  const now = (profile: Profile): boolean => {
    const again = after.targets.find((p) => p.name === profile.name);
    return again !== undefined && isCurrent(again, options);
  };
  const landed = stale.filter(now);
  const left = stale.filter((p) => !now(p));
  const needs = left.map((p) => notLanded(p, said.get(p.name), editor.path, carried.vsix));

  if (!before.targets.some(now)) {
    throw new UserError(
      `the companion could not be put into any profile that needs it, so nothing was injected:\n${needs
        .map((line) => `  ${line}`)
        .join("\n")}`,
    );
  }
  return {
    lines: [
      ...unread,
      ...(before.fallback === null ? [] : [before.fallback]),
      ...landed.map((p) => installedLine(p, carried)),
    ],
    needs,
    installed: landed.map((p) => p.name),
  };
}

function installedLine(profile: Profile, carried: CarriedCompanion): string {
  const old = profile.companion;
  if (old === null) {
    return `installed the companion, ${carried.version}, into profile "${profile.name}", which had none`;
  }
  const was =
    old.version === carried.version ? `${old.version} of another build` : (old.version ?? "one");
  return `replaced profile "${profile.name}"'s companion, ${was}, with this engine's, ${carried.version}`;
}

/** Why a profile still has no current companion, and the way round it by hand. */
function notLanded(
  profile: Profile,
  run: { readonly code: number; readonly output: string } | undefined,
  cli: string,
  vsix: string,
): string {
  const byHand = `Extensions: Install from VSIX… in that profile, with ${vsix}, does it by hand`;
  if (run !== undefined && run.code !== 0) {
    const last =
      run.output.trim().split(/\r?\n/).at(-1)?.replace(/\.$/, "") || `it exited ${run.code}`;
    return `the companion could not be installed into profile "${profile.name}": ${last}. ${byHand}`;
  }
  return (
    `${cli} said it installed the companion into profile "${profile.name}", and that profile does ` +
    `not list it, so that \`code\` is another editor. ${byHand}`
  );
}

/** How to put VS Code's CLI on `PATH`, which only the person can. */
function addCli(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin"
    ? "Add it with Shell Command: Install 'code' command in PATH, from VS Code's Command Palette."
    : "VS Code's installer adds it to PATH when its option to is ticked.";
}

/** Whether `entry` is the engine acquired into `home`, which is the one the companion runs (D143). */
export function isAcquiredEngine(
  entry: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const engine = resolve(home, "engine") + sep;
  const at = resolve(entry);
  return platform === "win32" || platform === "darwin"
    ? at.toLowerCase().startsWith(engine.toLowerCase())
    : at.startsWith(engine);
}
