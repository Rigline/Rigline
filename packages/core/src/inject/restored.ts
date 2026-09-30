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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `restoredSince`'s answer as a sentence says it: "09:23 on 30 September", in local time, with the
 * year when it is not this one. Text that is not a time comes back as it was.
 */
export function restoredAt(since: string, now: Date = new Date()): string {
  const ms = Date.parse(since);
  if (Number.isNaN(ms)) return since;
  const at = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const year = at.getFullYear() === now.getFullYear() ? "" : ` ${at.getFullYear()}`;
  return `${pad(at.getHours())}:${pad(at.getMinutes())} on ${at.getDate()} ${MONTHS[at.getMonth()]}${year}`;
}

/** Takes the mark away, and answers whether there was one. */
export function clearRestored(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}
