/**
 * Pure verdict logic for every check the probe runs.
 *
 * Every function here takes the raw state (diagnostics fields, ctx-observed values, DOM facts
 * already reduced to plain data) and returns a verdict and a one-line detail. Nothing here touches
 * the DOM, `ctx`, or `globalThis.__rigline`: that wiring lives in index.ts, which calls these and
 * feeds the result through one `report()` path, so the badge count and the panel text cannot
 * disagree about what a check found.
 *
 * `n/a` is a real state, never a failure: a check that cannot apply on this surface, or has had no
 * opportunity yet, says so instead of guessing pass or fail.
 */

export type Verdict = "pass" | "fail" | "n/a";

export interface CheckResult {
  readonly name: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

/** The message of a thrown value, for a detail string. `Error` when it is one, `String()` otherwise. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One line of the panel report: the verdict tag, the check's name, and its detail. */
export function formatLine(check: CheckResult): string {
  const tag = check.verdict === "pass" ? "PASS" : check.verdict === "fail" ? "FAIL" : "N/A ";
  return check.detail.length > 0
    ? `${tag}  ${check.name} — ${check.detail}`
    : `${tag}  ${check.name}`;
}

/** How many checks are failing, which is what the badge count must agree with. */
export function failingCount(checks: readonly CheckResult[]): number {
  return checks.filter((c) => c.verdict === "fail").length;
}

/** Check 1: the pre hook's static import ran, and ran before the app rendered anything. */
export function preHookOrderVerdict(
  rootChildrenAtPre: number,
  rootChildrenAtPost: number | null,
): { verdict: Verdict; detail: string } {
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

/** Check 2: the app's single `acquireVsCodeApi` call went through the pre hook's wrapper. */
export function acquireVerdict(
  wrapped: boolean,
  called: boolean,
): { verdict: Verdict; detail: string } {
  return {
    verdict: wrapped && called ? "pass" : "fail",
    detail: `wrapped=${wrapped} called=${called}`,
  };
}

/** Check 3: the bus tap sees traffic in both directions. */
export function busTrafficVerdict(
  outboundCount: number,
  inboundCount: number,
): { verdict: Verdict; detail: string } {
  return {
    verdict: outboundCount > 0 && inboundCount > 0 ? "pass" : "fail",
    detail: `out=${outboundCount} in=${inboundCount}`,
  };
}

/** Check 4: the boot replay buffer sealed once every plugin had its chance to register. */
export function bufferSealedVerdict(
  sealed: boolean,
  buffered: number,
): { verdict: Verdict; detail: string } {
  return { verdict: sealed ? "pass" : "fail", detail: `buffered=${buffered}` };
}

/** Check 5: the identifier tables the kernel checks declarations against are loaded. */
export function tablesLoadedVerdict(identifiersFor: string | null): {
  verdict: Verdict;
  detail: string;
} {
  return {
    verdict: identifiersFor !== null ? "pass" : "fail",
    detail: identifiersFor ?? "no tables loaded",
  };
}

/** One plugin's status, as far as check 6 needs it. */
export interface PluginStatusLike {
  readonly name: string;
  readonly status: "loaded" | "refused" | "error" | "inactive";
  readonly reason?: string;
}

/**
 * Check 6: every plugin in the registry loaded or was legitimately inactive. There is no list of
 * expected refusals here (D17): the fixtures that exist to be refused are never installed, so any
 * `refused` or `error` entry names a real problem.
 */
export function pluginStatusVerdict(plugins: readonly PluginStatusLike[]): {
  verdict: Verdict;
  detail: string;
} {
  const bad = plugins.filter((p) => p.status === "refused" || p.status === "error");
  if (bad.length === 0) {
    return { verdict: "pass", detail: `${plugins.length} plugin(s) loaded or inactive` };
  }
  const detail = bad
    .map((p) => `${p.name} ${p.status}${p.reason ? `: ${p.reason}` : ""}`)
    .join("; ");
  return { verdict: "fail", detail };
}

/** Check 7: no error has landed in `diagnostics.errors`. */
export function hostErrorsVerdict(errors: readonly string[]): { verdict: Verdict; detail: string } {
  if (errors.length === 0) return { verdict: "pass", detail: "0" };
  return { verdict: "fail", detail: errors.slice(0, 3).join("; ") };
}

/** Check 8: the React devtools hook is installed and the renderer is known. */
export function reactVerdict(react: {
  readonly hook: "installed" | "chained";
  readonly version: string | null;
  readonly commits: number;
  readonly notified: number;
}): { verdict: Verdict; detail: string } {
  return {
    verdict: react.version !== null ? "pass" : "fail",
    detail: `${react.hook}, ${react.version ?? "no version"}, ${react.commits} -> ${react.notified}`,
  };
}

/** Check 10: a tap's payload, and once seen, its nested `request` object, are frozen. */
export function immutabilityVerdict(
  nestedSeen: boolean,
  topFrozen: boolean,
  nestedFrozen: boolean,
): { verdict: Verdict; detail: string } {
  if (!nestedSeen) return { verdict: "n/a", detail: "no request with a nested object yet" };
  if (topFrozen && nestedFrozen) return { verdict: "pass", detail: "top+nested" };
  const broken = !topFrozen && !nestedFrozen ? "top and nested" : !topFrozen ? "top" : "nested";
  return { verdict: "fail", detail: `${broken} not frozen` };
}

/** Check 11: `ctx.anchor()` resolved a non-empty class for the anchor this plugin mounts against. */
export function anchorResolvesVerdict(
  resolved: string | null,
  thrown: string | null,
): { verdict: Verdict; detail: string } {
  if (thrown !== null) return { verdict: "fail", detail: `threw: ${thrown}` };
  if (resolved === null || resolved.length === 0) {
    return { verdict: "fail", detail: "resolved to an empty string" };
  }
  return { verdict: "pass", detail: resolved };
}

/**
 * Check 13: the node this plugin mounted is still in the document. `mounted` is whether `build()`
 * has run at least once; a node the host has since rebuilt (after its anchor's children were wholly
 * replaced) is a different element, so the caller passes the *current* one, not the first.
 */
export function mountSurvivesVerdict(
  mounted: boolean,
  connected: boolean,
): { verdict: Verdict; detail: string } {
  if (!mounted) return { verdict: "n/a", detail: "not mounted yet" };
  return { verdict: connected ? "pass" : "fail", detail: connected ? "connected" : "detached" };
}

/**
 * Check 14: whether a shared anchor's `data-rigline-mount` siblings, read in DOM order and mapped to
 * their registry index, come out non-decreasing (D23). `n/a` with fewer than two nodes: nothing
 * about ordering is proven by one node sharing an anchor with itself, which is the ordinary case
 * until another plugin decorates the same anchor.
 */
export function mountOrderVerdict(indices: readonly number[]): {
  verdict: Verdict;
  detail: string;
} {
  if (indices.length < 2) {
    return { verdict: "n/a", detail: `${indices.length} node(s) on the anchor` };
  }
  for (let i = 1; i < indices.length; i++) {
    const prev = indices[i - 1] as number;
    const curr = indices[i] as number;
    if (curr < prev) {
      return {
        verdict: "fail",
        detail: `registry order ${indices.join(",")} is not non-decreasing`,
      };
    }
  }
  return { verdict: "pass", detail: `registry order ${indices.join(",")}` };
}

/**
 * Check 15: the two-rewriter chain on `rename_tab` composes. `composed` latches true the first time
 * the second rewriter sees the first's mark; once true it stays true, because the claim being
 * proved is "we have been seen to compose", which a later message cannot un-observe.
 */
export function chainComposeVerdict(
  crossed: boolean,
  composed: boolean,
): { verdict: Verdict; detail: string } {
  if (composed) return { verdict: "pass", detail: "second rewriter saw the first's mark" };
  if (!crossed) return { verdict: "n/a", detail: "no rename_tab has crossed yet" };
  return { verdict: "fail", detail: "second rewriter did not see the first's mark" };
}

/** Check 16: a read tap on `rename_tab` never saw the chain's own mark on the wire. */
export function leakVerdict(
  seen: boolean,
  leaked: boolean,
  lastTitle: string | null,
): { verdict: Verdict; detail: string } {
  if (!seen) return { verdict: "n/a", detail: "no rename_tab tapped yet" };
  if (leaked) return { verdict: "fail", detail: `title carried the mark: ${lastTitle}` };
  return { verdict: "pass", detail: "clean" };
}

/** One rewrite bookkeeping record, as far as check 17 needs it. */
export interface RewriteRecordLike {
  readonly plugin: string;
  readonly type: string;
  readonly applied: number;
  readonly ran: number;
  readonly missed: number;
}

/** Check 17: `diagnostics.rewrites` carries exactly the probe's own two registrations. */
export function rewriteBookkeepingVerdict(
  records: readonly RewriteRecordLike[],
  pluginName: string,
): { verdict: Verdict; detail: string } {
  const mine = records.filter((r) => r.plugin === pluginName);
  if (mine.length !== 2) {
    return {
      verdict: "fail",
      detail: `expected 2 rewrite entries for "${pluginName}", found ${mine.length}`,
    };
  }
  const detail = mine
    .map((r) => `${r.type} ran=${r.ran} applied=${r.applied} missed=${r.missed}`)
    .join(", ");
  return { verdict: "pass", detail };
}

/** Check 18: at least one tool call has been observed through `ctx.onToolUse`. */
export function toolCallsVerdict(
  seen: number,
  lastName: string | null,
): { verdict: Verdict; detail: string } {
  if (seen === 0) return { verdict: "n/a", detail: "no tool calls yet" };
  return { verdict: "pass", detail: `${seen} seen, last "${lastName}"` };
}

/** Check 19: a session id has arrived through `ctx.onSessionId`. */
export function sessionIdVerdict(id: string | null): { verdict: Verdict; detail: string } {
  if (id === null) return { verdict: "n/a", detail: "no session" };
  return { verdict: "pass", detail: id.slice(0, 8) };
}

/**
 * Check 20: transcript rows are being identified and timed. `fail` only once entries have been
 * present for more than five seconds with nothing timed, which is the join being broken rather than
 * merely not yet caught up; an untimed row younger than that (a prompt just sent, a session still
 * loading) is ordinary.
 */
export function transcriptVerdict(
  entries: number,
  timed: number,
  msSinceEntriesUntimed: number | null,
): { verdict: Verdict; detail: string } {
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

/** Check 21: the host-managed stylesheet this plugin asked for is in the document. */
export function stylesheetVerdict(present: boolean): { verdict: Verdict; detail: string } {
  return { verdict: present ? "pass" : "fail", detail: present ? "present" : "missing" };
}

/**
 * Check 22: what the mount service is doing about re-placement, and the number D52 turns on.
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
 */
export function mountReplacementVerdict(
  driver: string,
  active: number,
  replaced: number,
  lost: number,
): { verdict: Verdict; detail: string } {
  const where = `${active} active, on ${driver}`;
  if (lost > 0) return { verdict: "fail", detail: `${lost} still detached, ${where}` };
  if (replaced > 0) return { verdict: "pass", detail: `${replaced} re-placed, ${where}` };
  return { verdict: "n/a", detail: `nothing detached yet, ${where}` };
}
