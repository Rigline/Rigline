/**
 * The mark `restore` leaves in `RIGLINE_HOME`. While it is there the companion injects nothing, and
 * the first injection a person runs takes it away (D111).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function markRestored(path: string, now: Date = new Date()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${now.toISOString()}\n`);
}

/** When `restore` took Rigline out, or null when nothing is holding it out. */
export function restoredSince(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8").trim() || "an unrecorded time";
  } catch {
    return "an unrecorded time";
  }
}

/** Takes the mark away, and answers whether there was one. */
export function clearRestored(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
