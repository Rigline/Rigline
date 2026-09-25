/**
 * The companion updating itself from the engine it runs (D99).
 *
 * The engine says whether this companion is the one it carries; this decides whether installing
 * that one would change anything, and says what happened. It never throws, since it follows a run
 * that has already reported, and it never restarts anything (D82).
 */
import type { Editor } from "./editor.ts";

/**
 * The last carried companion this profile tried to install, in the profile's own state: what stops
 * a reinstall at every run until extensions restart, and a second window repeating the first's.
 */
export const SELF_UPDATE_KEY = "rigline.selfUpdate";

export interface Carried {
  readonly version: string;
  readonly fingerprint: string;
  readonly vsix: string;
}

/** `companion-status`'s answer, or why there is none. */
export type CompanionStatus =
  | { readonly current: boolean; readonly carried: Carried | null }
  | { readonly problem: string };

interface Attempt {
  readonly fingerprint: string;
  readonly installed: boolean;
  /** Whether a failure at this fingerprint has already set the status. */
  readonly told: boolean;
}

function isCarried(value: unknown): value is Carried {
  if (value === null || typeof value !== "object") return false;
  const { version, fingerprint, vsix } = value as Record<string, unknown>;
  return typeof version === "string" && typeof fingerprint === "string" && typeof vsix === "string";
}

/** The engine's JSON, checked: a shape this companion does not know is a problem, never a guess. */
export function parseStatus(stdout: string): CompanionStatus {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return { problem: "the engine's answer was not JSON" };
  }
  const { v, current, carried } = (answer ?? {}) as Record<string, unknown>;
  if (v !== 1) {
    return {
      problem: `the engine answered in a shape this companion does not know (v ${String(v)})`,
    };
  }
  if (typeof current !== "boolean" || (carried !== null && !isCarried(carried))) {
    return { problem: "the engine's answer was missing what this companion needs" };
  }
  return { current, carried };
}

function attemptOf(value: unknown): Attempt | null {
  if (value === null || typeof value !== "object") return null;
  const { fingerprint, installed, told } = value as Record<string, unknown>;
  return typeof fingerprint === "string"
    ? { fingerprint, installed: installed === true, told: told === true }
    : null;
}

export interface SelfUpdateOptions {
  readonly editor: Editor;
  /** This companion's version, from the manifest VS Code read. */
  readonly version: string;
  /** `companion-status` for this companion's directory: its exit code and stdout. */
  readonly ask: () => Promise<{ readonly code: number; readonly stdout: string }>;
  /** Whether the status line is green, the only one a failure here may replace. */
  readonly green: boolean;
}

export type SelfUpdateOutcome = "current" | "installed" | "pending" | "skipped" | "failed";

export async function selfUpdate(options: SelfUpdateOptions): Promise<SelfUpdateOutcome> {
  const { editor, version } = options;

  let status: CompanionStatus;
  try {
    const { code, stdout } = await options.ask();
    status = code === 0 ? parseStatus(stdout) : { problem: `the engine exited ${code}` };
  } catch (error) {
    status = { problem: error instanceof Error ? error.message : String(error) };
  }
  if ("problem" in status) {
    editor.log(`did not check for a newer companion: ${status.problem}`);
    return "skipped";
  }
  const { carried } = status;
  if (status.current || carried === null) return "current";

  if (carried.version === version) {
    // VS Code would delete this companion's own directory and extract over it (D99).
    editor.log(
      `this companion differs from the one the engine carries at the same version, ${version}, so it is left alone`,
    );
    return "skipped";
  }

  const last = attemptOf(editor.remembered(SELF_UPDATE_KEY));
  const same = last !== null && last.fingerprint === carried.fingerprint;
  if (same && last.installed) {
    editor.log(`companion ${carried.version} is installed and takes over when extensions restart`);
    return "pending";
  }

  try {
    await editor.installExtension(carried.vsix);
  } catch (error) {
    const told = same && last.told;
    const tell = options.green && !told;
    await editor.remember(SELF_UPDATE_KEY, {
      fingerprint: carried.fingerprint,
      installed: false,
      told: told || tell,
    });
    const message =
      `could not update the Rigline companion to ${carried.version}: ` +
      `${error instanceof Error ? error.message : String(error)}. ` +
      `Extensions: Install from VSIX… with ${carried.vsix} does it by hand.`;
    editor.log(message);
    if (tell) editor.status("attention", "Rigline: needs you", message);
    return "failed";
  }

  await editor.remember(SELF_UPDATE_KEY, {
    fingerprint: carried.fingerprint,
    installed: true,
    told: false,
  });
  editor.log(
    `updated the Rigline companion to ${carried.version}; it takes over when extensions next restart`,
  );
  return "installed";
}
