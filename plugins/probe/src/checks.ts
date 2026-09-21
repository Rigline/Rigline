/**
 * The probe's own verdict logic, and the formatting for everything the panel and the clipboard show.
 *
 * Two jobs, and they used to be one. The probe is now a *renderer* of a registry it no longer owns —
 * the kernel and the capability modules contribute `core`, plugins contribute their own lines — and
 * separately one contributor among them, with the handful of checks nothing else can run.
 *
 * What stayed here is what is an experiment rather than a reading: register a tap and check the tap
 * saw the app's original, rewrite twice and check the chain composed. Those need something done to
 * the bus and then looked at, which no capability module is in a position to do to itself.
 *
 * Nothing here touches the DOM, `ctx`, or `globalThis.__rigline`: that wiring is in index.ts.
 */

export type Verdict = "pass" | "fail" | "n/a";

/** One line as the host's registry hands it back. See the host's kernel/checks.ts for the source. */
export interface CheckLine {
  readonly name: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

/** One contributor's lines. `core` first, then plugins in registry order. */
export interface CheckGroup {
  readonly contributor: string;
  readonly results: readonly CheckLine[];
  readonly failing: number;
}

/** The message of a thrown value, for a detail string. `Error` when it is one, `String()` otherwise. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One line of the panel report: the verdict tag, the check's name, and its detail. */
export function formatLine(check: CheckLine): string {
  const tag = check.verdict === "pass" ? "PASS" : check.verdict === "fail" ? "FAIL" : "N/A ";
  return check.detail.length > 0
    ? `${tag}  ${check.name} — ${check.detail}`
    : `${tag}  ${check.name}`;
}

/** How many checks are failing, which is what the badge count must agree with. */
export function failingCount(groups: readonly CheckGroup[]): number {
  return groups.reduce((total, group) => total + group.failing, 0);
}

/**
 * The panel's body: a header per contributor, then its lines indented under it.
 *
 * The count on a header appears only when it is not zero, so a header that carries one is itself the
 * finding and the eye is never trained to skip a `(0 failing)` on every group (the same reason the
 * abandoned-mounts line is absent rather than empty, D54).
 *
 * Order is the registry's, and it is the host that decides it. Nothing here sorts: a list that
 * reorders as verdicts change slides a line out from under a pointer mid-click, and a report that
 * rearranges itself while it is being read is worse than one that is merely long.
 */
export function formatGroups(groups: readonly CheckGroup[]): string {
  const out: string[] = [];
  for (const group of groups) {
    if (out.length > 0) out.push("");
    out.push(
      group.failing > 0 ? `${group.contributor}  (${group.failing} failing)` : group.contributor,
    );
    for (const line of group.results) out.push(`  ${formatLine(line)}`);
  }
  return out.length > 0 ? out.join("\n") : "(no checks registered)";
}

/** A tap's payload, and once seen, its nested `request` object, are frozen. */
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

/**
 * The node this plugin mounted is still in the document. `mounted` is whether `build()` has run at
 * least once; a node the host has since rebuilt (after its anchor's children were wholly replaced)
 * is a different element, so the caller passes the *current* one, not the first.
 *
 * The host's own `mount:` checks ask this of every mount and read the mount service's own idea of
 * where a node belongs. This one is deliberately the naive version, asked from outside: it is what a
 * plugin can see about itself with nothing but a DOM reference, and so it is the worked example of
 * the shape every third-party check will have.
 */
export function badgeMountedVerdict(
  mounted: boolean,
  connected: boolean,
): { verdict: Verdict; detail: string } {
  if (!mounted) return { verdict: "n/a", detail: "not mounted yet" };
  return { verdict: connected ? "pass" : "fail", detail: connected ? "connected" : "detached" };
}

/**
 * The two-rewriter chain on `rename_tab` composes. `composed` latches true the first time the
 * second rewriter sees the first's mark; once true it stays true, because the claim being proved is
 * "we have been seen to compose", which a later message cannot un-observe.
 */
export function chainComposeVerdict(
  crossed: boolean,
  composed: boolean,
): { verdict: Verdict; detail: string } {
  if (composed) return { verdict: "pass", detail: "second rewriter saw the first's mark" };
  if (!crossed) return { verdict: "n/a", detail: "no rename_tab has crossed yet" };
  return { verdict: "fail", detail: "second rewriter did not see the first's mark" };
}

/** A read tap on `rename_tab` never saw the chain's own mark on the wire. */
export function leakVerdict(
  seen: boolean,
  leaked: boolean,
  lastTitle: string | null,
): { verdict: Verdict; detail: string } {
  if (!seen) return { verdict: "n/a", detail: "no rename_tab tapped yet" };
  if (leaked) return { verdict: "fail", detail: `title carried the mark: ${lastTitle}` };
  return { verdict: "pass", detail: "clean" };
}

/** One rewrite bookkeeping record, as far as the bookkeeping check needs it. */
export interface RewriteRecordLike {
  readonly plugin: string;
  readonly type: string;
  readonly applied: number;
  readonly ran: number;
  readonly missed: number;
}

/** `diagnostics.rewrites` carries exactly the probe's own two registrations. */
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

/** One plugin's status, as far as the report needs it. */
export interface PluginStatusLike {
  readonly name: string;
  readonly status: "loaded" | "refused" | "error" | "inactive";
  readonly reason?: string;
  readonly missingOptional?: readonly string[];
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
  /** The engine that wrote this payload (D75), or null for one injected before the stamp. */
  readonly engine: string | null;
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
 * peaks block is the part that matters most — a total says a panel has been busy and a peak says
 * when, which is the difference between a report that can be correlated with VS Code's own logs and
 * one that cannot.
 *
 * It carries no message content, no titles and no transcript text, by construction rather than by
 * filtering (D53). The session id is the one identifier present, already truncated to eight
 * characters by its own check, and already on screen in the panel.
 */
export function formatReport(facts: ReportFacts, groups: readonly CheckGroup[]): string {
  const out: string[] = ["rigline probe report"];

  out.push("");
  out.push(`  extension  ${facts.extension ?? "unknown"}, surface ${facts.surface}`);
  out.push(`  engine     ${facts.engine ?? "unstamped, so older than the stamp"}`);
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
    const without =
      (p.missingOptional?.length ?? 0) > 0 ? ` — without ${p.missingOptional?.join("; ")}` : "";
    out.push(`  ${p.name.padEnd(16)} ${p.status}${p.reason ? ` — ${p.reason}` : ""}${without}`);
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
  for (const line of formatGroups(groups).split("\n")) out.push(line.length > 0 ? `  ${line}` : "");

  out.push("", `host errors (${facts.errors.length})`);
  if (facts.errors.length === 0) out.push("  (none)");
  for (const e of facts.errors) out.push(`  ${e}`);

  return out.join("\n");
}
