/**
 * The Node floor, asked before anything else loads: below it the engine dies part-way through a
 * command, naming nothing. The one module that runs on an old Node, so it stays plain.
 *
 * The wrapper reads `engines.node` the same way in `packages/cli/src/floor.ts` (D69).
 */
import { readFileSync } from "node:fs";

/** Why `running` cannot run the engine, given `engines.node` as `>=MAJOR.MINOR.PATCH`, or null. */
export function nodeFloorProblem(running: string, range: string | undefined): string | null {
  const floor = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec((range ?? "").trim());
  if (floor === null) return null;
  const have = running.split(".").map(Number);
  for (let at = 0; at < 3; at++) {
    const want = Number(floor[at + 1]);
    const got = have[at] ?? 0;
    if (got > want) return null;
    if (got < want) {
      return `this engine needs Node ${floor.slice(1).join(".")} or newer, and this is Node ${running}`;
    }
  }
  return null;
}

/** `engines.node` from this package's own manifest, which the floor is declared in once. */
export function enginesNode(): string | undefined {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  return manifest?.engines?.node;
}
