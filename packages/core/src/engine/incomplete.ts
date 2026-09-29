/**
 * What to say when the engine's own files are incomplete, which Node reports as a module it cannot
 * find before any command runs. Imported ahead of the engine, so it depends on nothing but Node.
 */
import { isAbsolute, join, relative } from "node:path";

/**
 * The sentence for `error`, given where this bin is and Rigline's home. Deleting a directory is
 * advised only for the wrapper's own `engine` directory, which the next command fetches afresh.
 */
export function incompleteEngine(error: Error, bin: string, home: string): string {
  const engineDir = join(home, "engine");
  const inside = relative(engineDir, bin);
  const owned = inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  const fix = owned
    ? `Delete ${engineDir} and run the command again, which fetches it afresh.`
    : "Reinstall @rigline/core.";
  return `this engine is missing part of itself: ${error.message}. ${fix}`;
}
