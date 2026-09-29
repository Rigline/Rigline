/**
 * What `rigline` does once its Node is known to be new enough: `index.ts` imports this only then.
 */
import { parseArgs } from "node:util";
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
      noArguments(rest);
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

/**
 * Strict, as the engine's verbs are, and refused in its words: nothing updates a wrapper, so one
 * that took extra arguments at 1.0 could never refuse them within the major.
 */
function noArguments(args: readonly string[]): void {
  try {
    parseArgs({ args: [...args], options: {}, strict: true, allowPositionals: false });
  } catch (error) {
    throw new UserError(
      `${(error as Error).message}\n\`rigline --help\` lists what each command takes.`,
    );
  }
}
