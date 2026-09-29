/**
 * The Node floor, asked before anything else loads, and of an engine before moving to it.
 *
 * The same reading as the engine's, in `packages/core/src/engine/floor.ts`: the wrapper depends on no
 * Rigline package (D69). This one answers with the floor rather than a sentence, since each caller
 * names a different thing that needs it.
 */
import { readFileSync } from "node:fs";

/** The floor Node `running` falls below, given `range` as `>=MAJOR.MINOR.PATCH`, or null. */
export function belowFloor(running: string, range: string | undefined): string | null {
  const floor = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec((range ?? "").trim());
  if (floor === null) return null;
  const have = running.split(".").map(Number);
  for (let at = 0; at < 3; at++) {
    const want = Number(floor[at + 1]);
    const got = have[at] ?? 0;
    if (got > want) return null;
    if (got < want) return floor.slice(1).join(".");
  }
  return null;
}

/** `engines.node` from the wrapper's own manifest, which the floor is declared in once. */
export function enginesNode(): string | undefined {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return manifest?.engines?.node;
}
