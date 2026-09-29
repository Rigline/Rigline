/**
 * What the wrapper does itself: `--version`, `update`'s first half, and the notice (D69, D106).
 * Apart from the entry, which runs a command when it is imported.
 */
import {
  ENGINE_PACKAGE,
  type EngineOptions,
  engineDir,
  ensureEngine,
  formatEngineUpdate,
  handOffProblem,
  newerWrapper,
  readEngineState,
  riglineHome,
  updateEngine,
  wrapperVersion,
} from "./engine.ts";
import { UserError } from "./errors.ts";

/** `update`'s arguments: `--tag` is the wrapper's, and the rest go to the engine as typed. */
export function splitUpdateArgs(args: readonly string[]): {
  readonly tag?: string;
  readonly now: boolean;
  readonly forward: readonly string[];
} {
  let tag: string | undefined;
  let now = false;
  const forward: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      forward.push(...args.slice(i));
      break;
    }
    if (arg === "--tag" || arg.startsWith("--tag=")) {
      tag = arg === "--tag" ? args[++i] : arg.slice("--tag=".length);
      if (tag === undefined || tag === "") throw new UserError("--tag needs a dist-tag");
      continue;
    }
    if (arg === "--now") now = true;
    forward.push(arg);
  }
  return { ...(tag === undefined ? {} : { tag }), now, forward };
}

/**
 * The engine, then everything else, which is the engine's own `update` (D106). The new engine does
 * the plugins and the injection, so a stale injection cannot outlive the run (D75).
 */
export async function updateCommand(
  args: readonly string[],
  options: EngineOptions = {},
): Promise<number> {
  const { tag, now, forward } = splitUpdateArgs(args);
  const given: EngineOptions = {
    ...options,
    registry: { ...options.registry, ignoreReleaseAge: now },
  };

  const moved = await updateEngine({ ...given, ...(tag === undefined ? {} : { tag }) });
  console.log(formatEngineUpdate(moved, options.home ?? riglineHome()));

  const engine = await ensureEngine(given);
  const wrapper = options.version ?? wrapperVersion();
  const problem = handOffProblem(wrapper, engine.version);
  if (problem !== null) throw new UserError(problem);
  notice(engine.version, wrapper);
  const code = await engine.run(["update", ...forward]);
  // A Node below the new engine's floor needs you; a release too young only needs waiting (D115).
  const needsYou =
    moved.outcome === "failed" || (moved.outcome === "withheld" && moved.by === "node");
  return needsYou ? 1 : code;
}

/** On stderr, before the engine writes, so the report's tail stays last (D98). */
export function notice(engine: string, wrapper: string = wrapperVersion()): void {
  const line = newerWrapper(wrapper, engine);
  if (line !== null) console.error(line);
}

/**
 * The one question the wrapper answers itself (D69).
 *
 * What is on this machine, which it can read from the manifest it already reads to find the bin —
 * where a usage is what the tool can do, which only the engine knows. It installs nothing, because
 * a version query is what somebody runs when something is already wrong.
 */
export function versionCommand(): number {
  const prefix = engineDir();
  const state = readEngineState(prefix);
  const wrapper = wrapperVersion();
  console.log(`rigline ${wrapper}`);
  console.log(
    state.kind === "none"
      ? `engine: none in ${prefix} — the next command installs one`
      : `engine: ${ENGINE_PACKAGE} ${state.version} in ${prefix}` +
          (state.kind === "unusable" ? ` (unusable: ${state.why})` : ""),
  );
  const newer = state.kind === "none" ? null : newerWrapper(wrapper, state.version);
  if (newer !== null) console.log(newer);
  return 0;
}
