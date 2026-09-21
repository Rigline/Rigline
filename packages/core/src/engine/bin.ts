#!/usr/bin/env node
/**
 * `rigline-engine`: the bin the wrapper spawns.
 *
 * Two lines, because everything it does is `runEngine`'s. It is a separate file from `main.ts` for
 * one reason that matters: a module with a bootstrap at its top level runs that bootstrap on import,
 * so a library that exported the command surface from the same file would drive a command every
 * time something read it.
 *
 * `process.exitCode` rather than `process.exit`, so stdout written by the command has drained before
 * the process goes. A `rigline doctor > report.md` that exits first writes an empty file.
 */
import { runEngine } from "./main.ts";

runEngine(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
