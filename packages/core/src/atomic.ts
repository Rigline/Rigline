/** Writes a crash cannot leave half done. Everything Rigline writes into an extension goes here (D114). */
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { sleepSync } from "./extension/bundles.ts";

/** The rename refusals a Windows scanner or indexer holding the new file causes for a moment. */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);
const ATTEMPTS = 10;

/**
 * `path` holding `data` whole, or as it was: written beside it and renamed over it, so a process
 * stopped part-way leaves the old bytes and a stray temporary file rather than a truncated target.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const temporary = `${path}.rigline-${process.pid}.tmp`;
  writeFileSync(temporary, data);
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !TRANSIENT.has(code) || attempt === ATTEMPTS) {
        rmSync(temporary, { force: true });
        throw error;
      }
      sleepSync(50 * attempt);
    }
  }
}
