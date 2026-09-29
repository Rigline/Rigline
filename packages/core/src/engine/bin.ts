#!/usr/bin/env node
/**
 * `rigline-engine`: the bin the wrapper spawns.
 *
 * Everything it does is `runEngine`'s. It is a separate file from `main.ts` for one reason that
 * matters: a module with a bootstrap at its top level runs that bootstrap on import, so a library
 * that exported the command surface from the same file would drive a command every time something
 * read it. `main.ts` is imported only after the Node floor is checked, since a static import would
 * load it on a Node too old to run it, and a dependency missing from the engine's install fails
 * that import rather than a command.
 *
 * `process.exitCode` rather than `process.exit`, so stdout written by the command has drained before
 * the process goes. A `rigline doctor > report.md` that exits first writes an empty file.
 */
import { fileURLToPath } from "node:url";
import { riglineHome } from "../paths.ts";
import { enginesNode, nodeFloorProblem } from "./floor.ts";
import { incompleteEngine } from "./incomplete.ts";

const problem = nodeFloorProblem(process.versions.node, enginesNode());
if (problem === null) {
  let engine: typeof import("./main.ts") | null = null;
  try {
    engine = await import("./main.ts");
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ERR_MODULE_NOT_FOUND") throw error;
    const bin = fileURLToPath(import.meta.url);
    console.error(`rigline: ${incompleteEngine(error as Error, bin, riglineHome())}`);
    process.exitCode = 1;
  }
  if (engine !== null) process.exitCode = await engine.runEngine(process.argv.slice(2));
} else {
  console.error(`rigline: ${problem}; https://nodejs.org has one.`);
  process.exitCode = 1;
}
