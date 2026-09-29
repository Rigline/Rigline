#!/usr/bin/env node
/**
 * `rigline`: the command a person installs.
 *
 * It installs the engine under `<RIGLINE_HOME>/engine` and runs it, forwarding every verb verbatim —
 * including one neither package knows, because the wrapper holds no verb list and the engine prints
 * the usage for all of it. `update` moves the engine first and then hands over (D69, D73, D106).
 *
 * `main.ts` is imported only after the Node floor is checked, as the engine's `bin.ts` does, so a
 * Node too old for the rest never loads it.
 */
import { belowFloor, enginesNode } from "./floor.ts";

const floor = belowFloor(process.versions.node, enginesNode());
if (floor === null) {
  const { runWrapper } = await import("./main.ts");
  process.exitCode = await runWrapper(process.argv.slice(2));
} else {
  console.error(
    `rigline: Rigline needs Node ${floor} or newer, and ${process.execPath} is Node ` +
      `${process.versions.node}; https://nodejs.org has one.`,
  );
  process.exitCode = 1;
}
