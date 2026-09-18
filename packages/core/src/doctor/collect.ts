/**
 * Gathering Rigline's own install state for a bug report (D53).
 *
 * The scope is deliberately narrow and was once wider. This collector reads only files Rigline
 * wrote or patched: the extension directories, their backups, the payload, the baked registry.
 * VS Code's own logs are not read — see D53 for why that was cut — so there is no privacy surface
 * here to defend and nothing in a report that the person pasting it has not already seen in
 * `install`'s output.
 *
 * Nothing here throws for a condition a machine can be in. A user whose panel just froze runs this
 * once; a collector that aborts on an unreadable directory is one that answers nothing at all.
 * Every failure becomes a line in `problems` and the walk continues.
 */
import { homedir } from "node:os";
import { installedExtensions } from "../extension/locate.ts";
import { CORE_VERSION } from "../version.ts";
import { type InstallState, installStates } from "./install.ts";

export interface DoctorReport {
  readonly generatedAtMs: number;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly nodeVersion: string;
  readonly riglineVersion: string;
  readonly installs: readonly InstallState[];
  /** Problems with the collection itself, not with anything it found. */
  readonly problems: readonly string[];
}

export interface DoctorOptions {
  /** Extension directories to inspect. Defaults to every one installed for this user. */
  readonly exts?: readonly string[];
  readonly now?: number;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
}

export function collect(options: DoctorOptions = {}): DoctorReport {
  const problems: string[] = [];

  let exts: readonly string[] = options.exts ?? [];
  if (!options.exts) {
    try {
      exts = installedExtensions();
    } catch (error) {
      problems.push(
        `could not list installed extensions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const installs = installStates(exts);
  if (installs.length === 0) problems.push("no Claude Code extension directory was found");

  return {
    generatedAtMs: options.now ?? Date.now(),
    platform: options.platform ?? process.platform,
    home: options.home ?? homedir(),
    nodeVersion: process.version,
    riglineVersion: CORE_VERSION,
    installs,
    problems,
  };
}
