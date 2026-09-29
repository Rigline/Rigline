/**
 * What `rigline` does once its Node is known to be new enough: `index.ts` imports this only then.
 */
import { notice, updateCommand, versionCommand } from "./commands.ts";
import { ensureEngine } from "./engine.ts";
import { UserError } from "./errors.ts";

/** One invocation, answered with its exit code. A `UserError` is said; anything else is thrown. */
export async function runWrapper(argv: readonly string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    console.error(`rigline: ${error.message}`);
    return 1;
  }
}

async function dispatch(argv: readonly string[]): Promise<number> {
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
