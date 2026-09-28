#!/usr/bin/env node
/**
 * `rigline-engine`: the bin the wrapper spawns.
 *
 * Everything it does is `runEngine`'s. It is a separate file from `main.ts` for one reason that
 * matters: a module with a bootstrap at its top level runs that bootstrap on import, so a library
 * that exported the command surface from the same file would drive a command every time something
 * read it. `main.ts` is imported only after the Node floor is checked, since a static import would
 * load it on a Node too old to run it.
 *
 * `process.exitCode` rather than `process.exit`, so stdout written by the command has drained before
 * the process goes. A `rigline doctor > report.md` that exits first writes an empty file.
 */
import { enginesNode, nodeFloorProblem } from "./floor.ts";

const problem = nodeFloorProblem(process.versions.node, enginesNode());
if (problem === null) {
  const { runEngine } = await import("./main.ts");
  process.exitCode = await runEngine(process.argv.slice(2));
} else {
  console.error(`rigline: ${problem}; https://nodejs.org has one.`);
  process.exitCode = 1;
}
