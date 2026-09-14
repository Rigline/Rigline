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
export function mountOrderVerdict(
  indices: readonly number[],
  anchored = false,
): {
  verdict: Verdict;
  detail: string;
} {
  // `anchored` is the drift check, and it is why this is not simply an ordering assertion. This
  // plugin's own badge is mounted beside the anchor, so when it is on screen there must be a
  // host-placed node adjacent to the anchor; finding none means every decoration on that anchor
  // has been left behind by a re-render that moved it. Without this the failure reads as
  // "n/a, 0 nodes", which is what it read as when it actually happened.
  if (anchored && indices.length === 0) {
    return {
      verdict: "fail",
      detail: "no host-placed node beside the anchor: mounts have drifted",
    };
  }
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
): { verdict: Verdict; detail: string } {
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
 * Check 22: every anchor this panel watches that claims to name one element matched exactly one.
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
export function anchorUniqueVerdict(multiple: Readonly<Record<string, number>>): {
  verdict: Verdict;
  detail: string;
} {
  const names = Object.keys(multiple).sort();
  if (names.length === 0) return { verdict: "pass", detail: "one element each" };
  return {
    verdict: "fail",
    detail: names.map((name) => `${name} matched ${multiple[name]}`).join(", "),
  };
}

/** Wall-clock `HH:MM:SS` for a report meant to be lined up against VS Code's own logs, which are
 * local time. An ISO string would be unambiguous and three times as wide for no gain here. */
function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

/** A byte count in whichever unit keeps it to three or four characters. */
function bytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

/**
 * Everything the copied report carries beyond the check lines (D53).
 *
 * A plain facts object rather than the diagnostics bridge itself, so this file stays free of the
 * host's shape and the formatting stays unit-testable. The caller does the one narrow translation.
 */
export interface ReportFacts {
  readonly extension: string | null;
  readonly surface: string;
  readonly preAt: number;
  readonly postAt: number | null;
  readonly react: {
    readonly hook: string;
    readonly version: string | null;
    readonly commits: number;
    readonly notified: number;
  };
  readonly mounts: {
    readonly driver: string;
    readonly active: number;
    readonly replaced: number;
    readonly lost: number;
    readonly abandoned: readonly string[];
  };
  readonly storage: {
    readonly available: boolean;
    readonly writes: number;
    readonly failures: number;
    readonly bytes: number;
    readonly lastError: string | null;
  };
  readonly bus: {
    readonly outbound: number;
    readonly inbound: number;
    readonly clones: number;
    readonly cloneMs: number;
    readonly cloneMaxMs: number;
    readonly cloneMaxType: string | null;
  };
  readonly meters: Record<
    string,
    { readonly peak: number; readonly peakAt: number | null; readonly recent: number }
  >;
  readonly plugins: readonly PluginStatusLike[];
  readonly hostPatches: readonly {
    readonly plugin: string;
    readonly applied: boolean;
    readonly required: boolean;
    readonly reason?: string;
  }[];
  readonly previous: {
    readonly from: number;
    readonly to: number;
    readonly entries: readonly Record<string, unknown>[];
  } | null;
  readonly errors: readonly string[];
}

/** One snapshot row of the previous run, as `key=value` pairs in a stable order. */
function previousRow(entry: Record<string, unknown>): string {
  const at = entry.at;
  const when = typeof at === "number" ? clock(at) : "--:--:--";
  const pairs = Object.entries(entry)
    .filter(([k, v]) => k !== "at" && k !== "peaks" && typeof v === "number" && v !== 0)
    .map(([k, v]) => `${k}=${String(v)}`);
  return `  ${when}  ${pairs.join(" ") || "(all zero)"}`;
}

/**
 * The whole report, for the clipboard.
 *
 * Rich where the panel is lean, and deliberately so: the panel is a list you scan for a red line,
 * while this is what somebody pastes into an issue and a stranger has to diagnose from cold. The
 * peaks block is the part that is new and the part that matters — a total says a panel has been busy
 * and a peak says when, which is the difference between a report that can be correlated with VS
 * Code's own logs and one that cannot.
 *
 * It carries no message content, no titles and no transcript text, by construction rather than by
 * filtering (D53). The session id is the one identifier present, already truncated to eight
 * characters by its own check, and already on screen in the panel.
 */
export function formatReport(facts: ReportFacts, checks: readonly CheckResult[]): string {
  const out: string[] = ["rigline probe report"];

  out.push("");
  out.push(`  extension  ${facts.extension ?? "unknown"}, surface ${facts.surface}`);
  const post = facts.postAt === null ? "not reported" : `${facts.postAt}ms`;
  out.push(`  boot       pre ${facts.preAt}ms, post ${post}`);
  out.push(
    `  react      ${facts.react.version ?? "no renderer"}, hook ${facts.react.hook}, ` +
      `${facts.react.commits} commits / ${facts.react.notified} notified`,
  );
  out.push(
    `  mounts     ${facts.mounts.active} active, ${facts.mounts.replaced} re-placed, ` +
      `${facts.mounts.lost} lost, on ${facts.mounts.driver}`,
  );
  // Only when there is one, and then by name: an empty line here would be the usual case and would
  // train the eye to skip it, where a line that appears at all is the finding (D54).
  if (facts.mounts.abandoned.length > 0) {
    out.push(`  abandoned  ${facts.mounts.abandoned.join("; ")}`);
  }
  const storage = facts.storage.available
    ? `${facts.storage.writes} writes, ${bytes(facts.storage.bytes)}, ${facts.storage.failures} failures`
    : "unavailable";
  out.push(
    `  storage    ${storage}${facts.storage.lastError ? ` — ${facts.storage.lastError}` : ""}`,
  );
  const worst = facts.bus.cloneMaxType ? ` worst ${facts.bus.cloneMaxType}` : "";
  out.push(
    `  bus        ${facts.bus.outbound} out / ${facts.bus.inbound} in, ${facts.bus.clones} clones ` +
      `(${Math.round(facts.bus.cloneMs)}ms, max ${facts.bus.cloneMaxMs.toFixed(1)}ms${worst})`,
  );

  const busy = Object.entries(facts.meters)
    .filter(([, m]) => m.peak > 0)
    .sort((a, b) => b[1].peak - a[1].peak);
  out.push("", "peaks (busiest one-second window, and when)");
  if (busy.length === 0) out.push("  (nothing has been counted yet)");
  for (const [name, m] of busy) {
    const at = m.peakAt === null ? "" : ` at ${clock(m.peakAt)}`;
    out.push(`  ${name.padEnd(10)} ${String(m.peak).padStart(6)}/s${at}, now ${m.recent}/s`);
  }

  out.push("", "plugins");
  for (const p of facts.plugins) {
    out.push(`  ${p.name.padEnd(16)} ${p.status}${p.reason ? ` — ${p.reason}` : ""}`);
  }

  if (facts.hostPatches.length > 0) {
    out.push("", "host patches");
    for (const p of facts.hostPatches) {
      const verdict = p.applied ? "applied" : `not applied (${p.reason ?? "no reason given"})`;
      out.push(`  ${p.plugin.padEnd(16)} ${p.required ? "required" : "optional"}, ${verdict}`);
    }
  }

  if (facts.previous) {
    out.push("", `previous run (${clock(facts.previous.from)} to ${clock(facts.previous.to)})`);
    for (const entry of facts.previous.entries) out.push(previousRow(entry));
  }

  out.push("", "checks");
  for (const check of checks) out.push(`  ${formatLine(check)}`);

  out.push("", `host errors (${facts.errors.length})`);
  if (facts.errors.length === 0) out.push("  (none)");
  for (const e of facts.errors) out.push(`  ${e}`);

  return out.join("\n");
}
