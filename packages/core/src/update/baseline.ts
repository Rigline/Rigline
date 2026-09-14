/**
 * The baseline a harvest is compared against: "what moved since the version my plugins were built
 * for" (decisions.md, D29).
 *
 * D29 gives that as two sentences — the committed `generated.ts` for this repo, and
 * `~/.rigline/baseline.json` on a user's machine — and in code it is one rule, because the two
 * cases are the same case. A directory holding a `generated.ts` is somebody's plugin repository,
 * this one included, and that file is by definition the harvest its plugins were built and tested
 * against. A directory without one is a machine that merely runs plugins, and its baseline is
 * whatever the last update recorded. The old extension directory is never the baseline: it is
 * deleted by the time anything notices the update, and it answers a less useful question anyway.
 *
 * `generated.ts` is read as text rather than imported. It is a TypeScript module carrying a module
 * augmentation, so importing it would need a compiler; and it is written by `renderSource` in one
 * known shape, so the value can be lifted out by position. The marker is required to occur exactly
 * once, which turns a file that is not ours — or one an author has edited by hand — into a named
 * error rather than a silently wrong baseline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UserError } from "../errors.ts";
import { type Scan, type ScanJson, scanFromJson, scanToJson } from "../layers/diff.ts";

export const GENERATED_FILE = "generated.ts";

/** The marker `renderSource` writes before the scan. Changing one without the other breaks this. */
const SCAN_MARKER = "\nexport const SCAN = ";

export interface BaselineSource {
  readonly scan: Scan;
  /** The file it came from, for a report that says what it is comparing against. */
  readonly path: string;
  readonly kind: "generated" | "recorded";
}

function parseScan(json: unknown, path: string): Scan {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new UserError(`${path}: the baseline is not an object`);
  }
  const { version, views } = json as { version?: unknown; views?: unknown };
  if (typeof version !== "string" || typeof views !== "object" || views === null) {
    throw new UserError(`${path}: the baseline has no "version" and "views"`);
  }
  return scanFromJson(json as ScanJson);
}

/** The `SCAN` value out of a `generated.ts`, or a named error when the file is not one of ours. */
export function readGeneratedScan(path: string): Scan {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(SCAN_MARKER);
  if (first === -1) {
    throw new UserError(
      `${path} carries no SCAN; regenerate it with "rigline codegen" (a file written before SCAN existed will not have one)`,
    );
  }
  if (source.indexOf(SCAN_MARKER, first + 1) !== -1) {
    throw new UserError(
      `${path} carries more than one SCAN, so which is the baseline is not clear`,
    );
  }
  const open = source.indexOf("{", first);
  const close = source.lastIndexOf("}");
  if (open === -1 || close <= open) {
    throw new UserError(`${path}: SCAN is not an object literal`);
  }
  let value: unknown;
  try {
    value = JSON.parse(source.slice(open, close + 1));
  } catch (error) {
    throw new UserError(`${path}: SCAN is not readable as JSON (${(error as Error).message})`);
  }
  return parseScan(value, path);
}

/**
 * The baseline for `dir`, or null when there is nothing to compare against yet — a first run,
 * which is a normal state and not an error. `dir` is the directory the command was run from.
 */
export function readBaseline(dir: string, recordedPath: string): BaselineSource | null {
  const generated = join(dir, GENERATED_FILE);
  if (existsSync(generated)) {
    return { scan: readGeneratedScan(generated), path: generated, kind: "generated" };
  }
  if (existsSync(recordedPath)) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(recordedPath, "utf8"));
    } catch (error) {
      throw new UserError(`${recordedPath} is not valid JSON: ${(error as Error).message}`);
    }
    return { scan: parseScan(value, recordedPath), path: recordedPath, kind: "recorded" };
  }
  return null;
}

/**
 * Record `scan` as what the next update will compare against. Always written, even in a repository
 * with a `generated.ts`: the recorded file costs nothing and is the only baseline a person who
 * later deletes their generated file has left.
 */
export function writeBaseline(path: string, scan: Scan): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(scanToJson(scan), null, 2)}\n`);
}
