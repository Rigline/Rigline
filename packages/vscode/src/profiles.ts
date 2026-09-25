/**
 * The companion into this editor's other profiles, wherever Claude Code is and it is not (D100).
 *
 * The engine reads the profiles and installs; this hands it the editor and says what came back. It
 * never throws, since it follows a run that has already reported.
 */
import type { Editor } from "./editor.ts";

/** The failure this profile last said *needs you* about, so that a repeat of it stays quiet. */
export const PROFILES_KEY = "rigline.profiles";

export interface ProfilesAnswer {
  readonly lines: readonly string[];
  readonly failed: boolean;
}

/** `companion-profiles`' JSON, checked: a shape this companion does not know is a problem. */
export function parseAdditions(stdout: string): ProfilesAnswer | { readonly problem: string } {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return { problem: "the engine's answer was not JSON" };
  }
  const { v, lines, failed } = (answer ?? {}) as Record<string, unknown>;
  if (v !== 1) {
    return {
      problem: `the engine answered in a shape this companion does not know (v ${String(v)})`,
    };
  }
  if (
    !Array.isArray(lines) ||
    !lines.every((line) => typeof line === "string") ||
    typeof failed !== "boolean"
  ) {
    return { problem: "the engine's answer was missing what this companion needs" };
  }
  return { lines, failed };
}

export interface AddOptions {
  readonly editor: Editor;
  /** `companion-profiles` for this editor: its exit code and stdout. */
  readonly ask: () => Promise<{ readonly code: number; readonly stdout: string }>;
  /** Whether the status line is green, the only one a failure here may replace. */
  readonly green: boolean;
}

export type AddOutcome = "done" | "failed" | "skipped";

export async function addToProfiles(options: AddOptions): Promise<AddOutcome> {
  const { editor } = options;
  let answer: ProfilesAnswer | { readonly problem: string };
  try {
    const { code, stdout } = await options.ask();
    answer = code === 0 ? parseAdditions(stdout) : { problem: `the engine exited ${code}` };
  } catch (error) {
    answer = { problem: error instanceof Error ? error.message : String(error) };
  }
  if ("problem" in answer) {
    editor.log(`did not look for profiles without the companion: ${answer.problem}`);
    return "skipped";
  }

  for (const line of answer.lines) editor.log(line);
  if (!answer.failed) {
    if (editor.remembered(PROFILES_KEY) !== undefined) {
      await editor.remember(PROFILES_KEY, undefined);
    }
    return "done";
  }
  const failure = answer.lines.join("\n");
  if (options.green && editor.remembered(PROFILES_KEY) !== failure) {
    await editor.remember(PROFILES_KEY, failure);
    editor.status("attention", "Rigline: needs you", failure);
  }
  return "failed";
}
