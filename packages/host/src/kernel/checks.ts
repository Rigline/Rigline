/**
 * The check registry: who has contributed a diagnostic line, and what those lines say right now.
 *
 * Three contributors, two paths. The kernel and the capability modules contribute through
 * `kernelChecks` and `CapabilityModule.checks`, and are handed the `Kernel`, because they are host
 * code and their checks are readings of state they already own. A plugin contributes through
 * `ctx.check` and is handed nothing. That asymmetry is not an exception: what a contributor gets
 * follows from where it sits in the trust model, and a check is not the thing that moves it.
 *
 * **Pull, not push.** A check is a question the panel asks, not an event a contributor emits. There
 * is no `report()` anybody has to remember to call, so a verdict cannot go stale — which is the
 * failure mode that matters, because a stale `pass` is indistinguishable from a fresh one. The cost
 * of that is a rule the contributor must hold up: a check reads state it already keeps, and does not
 * compute one.
 *
 * The renderer owns the cadence. The host owns the registry and the running, so that every reader
 * gets the same answers and a throw is attributed the same way wherever it is read from.
 */
import type { CheckVerdict, Teardown, Verdict } from "@rigline/plugin-api";
import type { Diagnostics } from "./bridge.ts";
import type { Kernel } from "./types.ts";
import {
  acquireVerdict,
  bufferSealedVerdict,
  busTrafficVerdict,
  type ElementLike,
  elementsVerdict,
  hostErrorsVerdict,
  pluginStatusVerdict,
  preHookOrderVerdict,
  reactVerdict,
  tablesLoadedVerdict,
} from "./verdicts.ts";

/** The contributor name the host's own checks are grouped under, and the one that sorts first. */
export const CORE = "core";

/** One check, as a contributor hands it over. */
export interface Check {
  readonly name: string;
  run(): CheckVerdict;
}

/** One check, run. `detail` is always a string here; a contributor may omit it. */
export interface CheckResult {
  readonly contributor: string;
  readonly name: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

/** One contributor's lines, and how many of them are failing. */
export interface CheckGroup {
  readonly contributor: string;
  readonly results: readonly CheckResult[];
  readonly failing: number;
}

export interface CheckService {
  /** Register one check. The teardown removes it, and is what a disabled plugin's checks go through. */
  add(contributor: string, name: string, run: () => CheckVerdict): Teardown;
  /** Register several at once, under one contributor. One teardown removes them all. */
  addAll(contributor: string, checks: readonly Check[]): Teardown;
  /** Run every check now, grouped: `core` first, then contributors in the order they first appeared. */
  run(): readonly CheckGroup[];
}

interface Entry {
  readonly contributor: string;
  readonly name: string;
  readonly run: () => CheckVerdict;
}

const VERDICTS: readonly Verdict[] = ["pass", "fail", "n/a"];

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Run one check and turn anything it does into a line.
 *
 * Deliberately not wrapped in the kernel's `guard`, which is the one place a plugin callback is
 * called without it. `guard` disables because a throw inside the app's message flow or a React
 * commit means the plugin is broken at its job and has left the host somewhere nobody can reason
 * about. A throw here means the *diagnostic* is broken. Tearing down a working decoration on that
 * evidence would inflict the failure the panel is reporting, and the disable would then be reported
 * too — one bug in the least important code a plugin has, rendered as two red lines and no feature.
 *
 * Nothing is pushed to `diagnostics.errors` either: that list feeds core's own *no host errors*
 * check, so recording it there would render one fault twice and one of the two would name the wrong
 * layer. This line is the whole report.
 *
 * A check that never returns is not contained and cannot be. It is synchronous by construction, and
 * a plugin can hang the panel from `setup` or any handler it registers; this is not a sandbox.
 */
function runOne(entry: Entry): CheckResult {
  const { contributor, name } = entry;
  let answer: CheckVerdict;
  try {
    answer = entry.run();
  } catch (e) {
    return { contributor, name, verdict: "fail", detail: `check threw: ${message(e)}` };
  }
  if (!answer || typeof answer !== "object" || !VERDICTS.includes(answer.verdict)) {
    return {
      contributor,
      name,
      verdict: "fail",
      detail: `check returned ${JSON.stringify(answer)}, not a verdict`,
    };
  }
  return { contributor, name, verdict: answer.verdict, detail: answer.detail ?? "" };
}

export function createCheckService(): CheckService {
  const entries: Entry[] = [];

  function remove(entry: Entry): void {
    const i = entries.indexOf(entry);
    if (i !== -1) entries.splice(i, 1);
  }

  function add(contributor: string, name: string, run: () => CheckVerdict): Teardown {
    const entry: Entry = { contributor, name, run };
    entries.push(entry);
    return () => remove(entry);
  }

  return {
    add,
    addAll(contributor, checks) {
      const offs = checks.map((check) => add(contributor, check.name, () => check.run()));
      return () => {
        for (const off of offs) off();
      };
    },
    run() {
      // Copied before running: a check may register or remove one, and a plugin disabled by
      // something else mid-run splices its own out from under the walk.
      const snapshot = [...entries];
      const groups = new Map<string, CheckResult[]>();
      for (const entry of snapshot) {
        const results = groups.get(entry.contributor);
        if (results) results.push(runOne(entry));
        else groups.set(entry.contributor, [runOne(entry)]);
      }
      // `core` first, then first-appearance order, which for plugins is registry order because
      // setup runs in it. First-appearance rather than insertion so a check registered late — from
      // a message handler, say — joins its own group instead of starting a second one, and so the
      // list a person is reading does not reorder underneath them.
      const names = [...groups.keys()].sort((a, b) => (a === CORE ? -1 : b === CORE ? 1 : 0));
      return names.map((contributor) => {
        const results = groups.get(contributor) as CheckResult[];
        return {
          contributor,
          results,
          failing: results.filter((r) => r.verdict === "fail").length,
        };
      });
    },
  };
}

/**
 * The kernel's own lines: the boot sequence, the bus, the tables, the registry and the renderer.
 *
 * Everything here is a reading of `diagnostics`, which is the kernel's to read and nobody else's.
 * The checks that are about one capability are not here — they are contributed by that capability's
 * module, so that "which part of this is broken" is answered by the name on the line.
 */
export function kernelChecks(kernel: Kernel): readonly Check[] {
  const d: Diagnostics = kernel.diagnostics;
  return [
    {
      name: "surface",
      // Always a pass: it is not a claim, it is what every n/a below is relative to.
      run: () => ({ verdict: "pass", detail: kernel.surface }),
    },
    {
      name: "pre hook ran before render",
      run: () => preHookOrderVerdict(d.rootChildrenAtPre, d.rootChildrenAtPost),
    },
    {
      name: "acquireVsCodeApi wrapped and called",
      run: () => acquireVerdict(d.acquireWrapped, d.acquireCalled),
    },
    {
      name: "bus traffic in both directions",
      run: () => busTrafficVerdict(d.outboundCount, d.inboundCount),
    },
    { name: "replay buffer sealed", run: () => bufferSealedVerdict(d.bufferSealed, d.buffered) },
    { name: "tables loaded", run: () => tablesLoadedVerdict(d.identifiersFor) },
    { name: "every plugin loaded", run: () => pluginStatusVerdict(d.plugins) },
    { name: "no host errors", run: () => hostErrorsVerdict(d.errors) },
    { name: "React renderer injected", run: () => reactVerdict(d.react) },
    { name: "elements are placed", run: () => elementsVerdict(d.bufferSealed, elements(kernel)) },
  ];
}

/** Every element a loaded plugin declares, and what the shell made of it. */
function elements(kernel: Kernel): ElementLike[] {
  const loaded = new Set(
    kernel.diagnostics.plugins.filter((p) => p.status === "loaded").map((p) => p.name),
  );
  return kernel.plugins
    .filter((p) => loaded.has(p.name))
    .flatMap((p) =>
      Object.keys(p.elements).map((id): ElementLike => {
        const name = `${p.name}/${id}`;
        const reading = kernel.shell.bound.get(name);
        return reading
          ? { name, ...reading }
          : { name, state: "unbound", detail: "declared, and setup never bound it" };
      }),
    );
}
