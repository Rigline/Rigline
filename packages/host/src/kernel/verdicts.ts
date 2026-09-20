/**
 * Pure verdict logic for every check the host contributes under `core`.
 *
 * Every function here takes state already reduced to plain data and returns a verdict and a line of
 * detail. Nothing here touches the DOM, the bridge or a kernel service: that wiring is in checks.ts
 * and in each capability module, which is what keeps this file testable in Node and keeps a verdict
 * arguable without a browser.
 *
 * These were the probe's, and most of them are unchanged. What changed is who owns them: a check
 * about the kernel belongs to the kernel and a check about a capability belongs to that capability,
 * so that a plugin's failure and the host's failure are attributable to different lines.
 */
import type { CheckVerdict } from "@rigline/plugin-api";

/** One plugin's status, as far as the plugin check needs it. */
export interface PluginStatusLike {
  readonly name: string;
  readonly status: "loaded" | "refused" | "error" | "inactive";
  readonly reason?: string;
  readonly missingOptional?: readonly string[];
}

/** The pre hook's static import ran, and ran before the app rendered anything. */
export function preHookOrderVerdict(
  rootChildrenAtPre: number,
  rootChildrenAtPost: number | null,
): CheckVerdict {
  if (rootChildrenAtPre === -1 || rootChildrenAtPost === null || rootChildrenAtPost === -1) {
    return {
      verdict: "n/a",
      detail: `pre=${rootChildrenAtPre} post=${rootChildrenAtPost ?? "null"}`,
    };
  }
  const ok = rootChildrenAtPre === 0 && rootChildrenAtPost > 0;
  return {
    verdict: ok ? "pass" : "fail",
    detail: `#root kids ${rootChildrenAtPre} -> ${rootChildrenAtPost}`,
  };
}

/** The app's single `acquireVsCodeApi` call went through the pre hook's wrapper. */
export function acquireVerdict(wrapped: boolean, called: boolean): CheckVerdict {
  return {
    verdict: wrapped && called ? "pass" : "fail",
    detail: `wrapped=${wrapped} called=${called}`,
  };
}

/** The bus tap sees traffic in both directions. */
export function busTrafficVerdict(outboundCount: number, inboundCount: number): CheckVerdict {
  return {
    verdict: outboundCount > 0 && inboundCount > 0 ? "pass" : "fail",
    detail: `out=${outboundCount} in=${inboundCount}`,
  };
}

/** The boot replay buffer sealed once every plugin had its chance to register. */
export function bufferSealedVerdict(sealed: boolean, buffered: number): CheckVerdict {
  return { verdict: sealed ? "pass" : "fail", detail: `buffered=${buffered}` };
}

/** The identifier tables the kernel checks declarations against are loaded. */
export function tablesLoadedVerdict(identifiersFor: string | null): CheckVerdict {
  return {
    verdict: identifiersFor !== null ? "pass" : "fail",
    detail: identifiersFor ?? "no tables loaded",
  };
}

/**
 * Every plugin in the registry loaded or was legitimately inactive. There is no list of expected
 * refusals here (D17): the fixtures that exist to be refused are never installed, so any `refused`
 * or `error` entry names a real problem.
 *
 * A loaded plugin missing an optional declaration rides along in the pass line, because nothing
 * else says so. It is not a failure — the plugin works, and going without is what optional means
 * (D41) — but it is the reason one of its decorations is not on screen, and a person looking for
 * that decoration has no other way to find out.
 */
export function pluginStatusVerdict(plugins: readonly PluginStatusLike[]): CheckVerdict {
  const bad = plugins.filter((p) => p.status === "refused" || p.status === "error");
  if (bad.length > 0) {
    return {
      verdict: "fail",
      detail: bad.map((p) => `${p.name} ${p.status}${p.reason ? `: ${p.reason}` : ""}`).join("; "),
    };
  }
  const without = plugins.filter((p) => (p.missingOptional?.length ?? 0) > 0);
  const going = without.map((p) => `${p.name} without ${p.missingOptional?.length}`).join(", ");
  return {
    verdict: "pass",
    detail:
      without.length === 0
        ? `${plugins.length} plugin(s) loaded or inactive`
        : `${plugins.length} loaded or inactive; ${going} optional declaration(s)`,
  };
}

/** No error has landed in `diagnostics.errors`. */
export function hostErrorsVerdict(errors: readonly string[]): CheckVerdict {
  if (errors.length === 0) return { verdict: "pass", detail: "0" };
  return { verdict: "fail", detail: errors.slice(0, 3).join("; ") };
}

/** The React devtools hook is installed and the renderer is known. */
export function reactVerdict(react: {
  readonly hook: "installed" | "chained";
  readonly version: string | null;
  readonly commits: number;
  readonly notified: number;
}): CheckVerdict {
  return {
    verdict: react.version !== null ? "pass" : "fail",
    detail: `${react.hook}, ${react.version ?? "no version"}, ${react.commits} -> ${react.notified}`,
  };
}

/**
 * Every anchor in the curated table resolved against this extension.
 *
 * The table is Rigline's claim about a version, and an entry that does not resolve is that claim
 * having expired — which is a failure of ours, not of whoever is reading the panel. It is named
 * here because naming it is the whole repair path: `~/.rigline/anchors.json` overrides one entry
 * without waiting for a release (D44), and [anchors.md](../../../../docs/anchors.md) is written for
 * the person who has just read this line.
 *
 * Which plugin goes without as a result is a different question, answered by the plugin check's
 * optional-declaration tail. This one is about the table.
 */
export function anchorsResolveVerdict(
  anchors: Readonly<Record<string, string | null>>,
  unresolved: Readonly<Record<string, string>>,
): CheckVerdict {
  const names = Object.keys(anchors);
  const gone = names.filter((name) => !anchors[name]).sort();
  if (names.length === 0) return { verdict: "fail", detail: "the anchor table is empty" };
  if (gone.length === 0) return { verdict: "pass", detail: `${names.length} of ${names.length}` };
  const named = gone
    .slice(0, 3)
    .map((name) => `${name} (${unresolved[name] ?? "not in this extension"})`)
    .join("; ");
  const more = gone.length > 3 ? `, and ${gone.length - 3} more` : "";
  return {
    verdict: "fail",
    detail: `${names.length - gone.length} of ${names.length}: ${named}${more}`,
  };
}

/** One mount, as far as the mount checks need it. */
export interface MountLike {
  readonly owner: string;
  readonly anchorConnected: boolean;
  readonly positioned: boolean;
  readonly abandoned: boolean;
}

/** One watch, as far as the mount checks need it. */
export interface WatchLike {
  readonly owner: string;
  readonly anchor: string;
  readonly found: boolean;
  readonly abandoned: boolean;
  /** How long it has been looking. A watch that has found nothing for a frame is not a fault. */
  readonly lookingMs: number;
}

/**
 * How long a watch may find nothing before that counts as a failure rather than as boot.
 *
 * The same five seconds the transcript check waits, and for the same reason: an anchor that renders
 * a frame or two after the plugin registered is the ordinary case, and a check with no "not yet"
 * state fails at boot and corrects itself a second later. A badge that goes red and then green
 * teaches the reader that red is noise, which costs more than the second of silence buys.
 */
const SETTLING_MS = 5000;

/**
 * Every mount whose anchor is still in the document is where the host means it to be.
 *
 * This is the generalisation of two of the probe's checks, and it is better than either because it
 * asks the mount service its own question. `positioned` is the predicate the per-commit pass uses
 * to decide whether to act, so it already encodes both halves the probe tested separately: that a
 * node is attached at all, and that it sits in registry order among the peers sharing its anchor.
 * Asking it of every mount replaces a DOM walk around one anchor that only ever proved something
 * once a second plugin happened to decorate the same one.
 *
 * A mount whose anchor has left the document is not counted. That is the app's business and
 * `watch`'s question, not a fault (see `replaceLost`).
 */
export function mountsInPlaceVerdict(mounts: readonly MountLike[]): CheckVerdict {
  const live = mounts.filter((m) => m.anchorConnected && !m.abandoned);
  if (live.length === 0) {
    return { verdict: "n/a", detail: `${mounts.length} mount(s), none with a live anchor` };
  }
  const adrift = live.filter((m) => !m.positioned);
  if (adrift.length === 0) return { verdict: "pass", detail: `${live.length} in place` };
  const owners = [...new Set(adrift.map((m) => m.owner))].sort().join(", ");
  return { verdict: "fail", detail: `${adrift.length} of ${live.length} out of place: ${owners}` };
}

/**
 * Every watch has an element. A watch that has never found one is a decoration that has never
 * appeared, which is the silence P8 exists to refuse — and it reads as an ordinary loaded plugin
 * from every other line in the panel.
 *
 * An optional anchor this extension has not got never reaches the mount service, so it cannot show
 * up here: `ctx.watch` returns a no-op teardown instead of registering (D41). What a name here
 * means is therefore always the harder case — the anchor is in the table, it resolved, and nothing
 * on screen matches it.
 */
export function watchesFoundVerdict(watches: readonly WatchLike[]): CheckVerdict {
  if (watches.length === 0) return { verdict: "n/a", detail: "no watches on this surface" };
  const empty = watches.filter((w) => !w.found && !w.abandoned);
  if (empty.length === 0) return { verdict: "pass", detail: `${watches.length} anchored` };
  const named = [...new Set(empty.map((w) => `${w.owner}/${w.anchor}`))].sort().join(", ");
  // Still settling is not the same claim as never appeared, and this is the one place that can tell
  // them apart: the host owns the watch and has a clock, where the plugin waiting on the element has
  // neither. That is why a plugin's own check says `n/a` until it is handed something and leaves
  // this question here, rather than keeping a timer of its own and answering it worse.
  if (empty.every((w) => w.lookingMs < SETTLING_MS)) {
    return {
      verdict: "n/a",
      detail: `${empty.length} of ${watches.length} still looking: ${named}`,
    };
  }
  return {
    verdict: "fail",
    detail: `${empty.length} of ${watches.length} found nothing: ${named}`,
  };
}

/**
 * What the mount service is doing about re-placement, and the number D52 turns on.
 *
 * `lost` is the only failure here — a node detached from an anchor still in the document, retried
 * every frame and visible to nobody. A non-zero `replaced` is the opposite of a failure: it is the
 * mechanism working, and the only evidence that will keep it in the codebase. Both at zero is the
 * quiet state the 0.x prototype measured across all three surfaces, and `n/a` reports it as what it
 * is rather than claiming a pass for something that never had to happen.
 *
 * `driver` rides along because the fallback is otherwise silent: "observer" against the real
 * extension means no React renderer injected, which is a much larger problem than re-placement and
 * would otherwise only show up as an empty transcript two lines further down the panel.
 *
 * `abandoned` outranks `lost` and is reported by name rather than by count (D54). It means the host
 * kept re-placing something and kept being undone, concluded it was losing, and stopped — so the
 * decoration is gone and, before it went, the panel was flickering at frame rate. A count would say
 * how bad; the name says which plugin and which anchor, which is the thing anyone reading this
 * needs next.
 */
export function mountReplacementVerdict(
  driver: string,
  active: number,
  replaced: number,
  moved: number,
  lost: number,
  abandoned: readonly string[] = [],
): CheckVerdict {
  const where = `${active} active, on ${driver}`;
  const work = [
    replaced > 0 ? `${replaced} re-placed` : null,
    moved > 0 ? `${moved} moved` : null,
  ].filter((part) => part !== null);
  if (abandoned.length > 0) {
    return { verdict: "fail", detail: `gave up on ${abandoned.join("; ")}, ${where}` };
  }
  if (lost > 0) return { verdict: "fail", detail: `${lost} still detached, ${where}` };
  if (work.length > 0) return { verdict: "pass", detail: `${work.join(", ")}, ${where}` };
  return { verdict: "n/a", detail: `nothing detached or moved yet, ${where}` };
}

/**
 * Every anchor this panel watches that claims to name one element matched exactly one.
 *
 * The build-time count and this one answer different questions and neither subsumes the other
 * (D7). The harvest counts how many *places the bundle applies* a class, which is where an
 * ambiguity is caught before anyone runs anything; this counts how many *elements are on screen*,
 * which is the only thing that can tell you a refinement stopped refining — a class applied at one
 * site inside a list renders many, and a selector that matched one control last week can match two
 * after a release that never touched the class at all.
 *
 * `multiple` carries only the anchors that have failed the claim, so empty is the pass, and the
 * verdict is `pass` rather than `n/a` when nothing is in it: the host has been looking on every
 * commit since boot, which is a measurement and not an absence of one.
 */
export function anchorUniqueVerdict(multiple: Readonly<Record<string, number>>): CheckVerdict {
  const names = Object.keys(multiple).sort();
  if (names.length === 0) return { verdict: "pass", detail: "one element each" };
  return {
    verdict: "fail",
    detail: names.map((name) => `${name} matched ${multiple[name]}`).join(", "),
  };
}

/**
 * Every stylesheet a plugin asked for is still in the document.
 *
 * The generalisation of the probe's own one-element query, and worth having for the same reason the
 * mount checks are: a `<style>` the host placed and something removed is a plugin whose every rule
 * silently stopped applying, with nothing else in the panel that would say so.
 */
export function stylesheetsVerdict(
  sheets: readonly { readonly owner: string; readonly present: boolean }[],
): CheckVerdict {
  if (sheets.length === 0) return { verdict: "n/a", detail: "no plugin asked for one" };
  const gone = sheets.filter((s) => !s.present);
  if (gone.length === 0) return { verdict: "pass", detail: `${sheets.length} present` };
  const owners = [...new Set(gone.map((s) => s.owner))].sort().join(", ");
  return { verdict: "fail", detail: `${gone.length} of ${sheets.length} removed: ${owners}` };
}

/** At least one tool call has been observed, once some plugin on this surface is watching for them. */
export function toolCallsVerdict(
  used: boolean,
  seen: number,
  lastName: string | null,
): CheckVerdict {
  if (!used) return { verdict: "n/a", detail: "no plugin here uses tool calls" };
  if (seen === 0) return { verdict: "n/a", detail: "no tool calls yet" };
  return { verdict: "pass", detail: `${seen} seen, last "${lastName}"` };
}

/** A session id has arrived, once some plugin on this surface is following one. */
export function sessionIdVerdict(used: boolean, id: string | null): CheckVerdict {
  if (!used) return { verdict: "n/a", detail: "no plugin here follows the session" };
  if (id === null) return { verdict: "n/a", detail: "no session" };
  return { verdict: "pass", detail: id.slice(0, 8) };
}

/**
 * Transcript rows are being identified and timed. `fail` only once entries have been present for
 * more than five seconds with nothing timed, which is the join being broken rather than merely not
 * yet caught up; an untimed row younger than that (a prompt just sent, a session still loading) is
 * ordinary.
 */
export function transcriptVerdict(
  used: boolean,
  entries: number,
  timed: number,
  msSinceEntriesUntimed: number | null,
): CheckVerdict {
  if (!used) return { verdict: "n/a", detail: "no plugin here decorates the transcript" };
  if (entries === 0) return { verdict: "n/a", detail: "no transcript rows yet" };
  if (timed > 0) return { verdict: "pass", detail: `entries=${entries} timed=${timed}` };
  if (msSinceEntriesUntimed !== null && msSinceEntriesUntimed > 5000) {
    return {
      verdict: "fail",
      detail: `entries=${entries} timed=0 after ${Math.round(msSinceEntriesUntimed)}ms`,
    };
  }
  return { verdict: "n/a", detail: `entries=${entries} timed=0, waiting` };
}
