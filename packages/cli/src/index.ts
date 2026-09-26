#!/usr/bin/env node
/**
 * `rigline`: the command a person installs.
 *
 * It installs the engine under `<RIGLINE_HOME>/engine` and runs it, forwarding every verb verbatim —
 * including one neither package knows, because the wrapper holds no verb list and the engine prints
 * the usage for all of it. `update` moves the engine first and then hands over (D69, D73, D106).
 */
import { notice, updateCommand, versionCommand } from "./commands.ts";
import { ensureEngine } from "./engine.ts";
import { UserError } from "./errors.ts";

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "--version":
    case "-v":
      return versionCommand();
    case "update":
      return await updateCommand(rest);
    default: {
      const engine = await ensureEngine();
      notice(engine.version);
      return await engine.run(argv);
    }
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UserError) {
      console.error(`rigline: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  },
);
