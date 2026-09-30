/**
 * What Diagnostics shows and what Copy report puts on the clipboard, as text (D53, D119). Pure, so
 * the formatting is argued about in Node; the one reading of the host's shape is `reportFacts`.
 */
import type { Surface } from "@rigline/plugin-api/internal";
import type { Diagnostics } from "../kernel/bridge.ts";
import type { CheckGroup, CheckResult } from "../kernel/checks.ts";

/** One line of the panel: the verdict tag, the check's name, and its detail. */
export function formatLine(check: Pick<CheckResult, "name" | "verdict" | "detail">): string {
  const tag = check.verdict === "pass" ? "PASS" : check.verdict === "fail" ? "FAIL" : "N/A ";
  return check.detail.length > 0
    ? `${tag}  ${check.name} — ${check.detail}`
    : `${tag}  ${check.name}`;
}

/**
 * A header per contributor, then its lines indented under it, in the registry's order: a list that
 * reorders as verdicts change slides a line out from under a pointer mid-click (D66).
 *
 * A header carries a count only when it is not zero, so a count is itself the finding, as the
 * abandoned-mounts line is absent rather than empty (D54).
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

/** Everything the copied report carries beyond the check lines (D53). */
export interface ReportFacts {
  readonly extension: string | null;
  /** The engine that wrote this payload (D75), or null for one injected before the stamp. */
  readonly engine: string | null;
  /** When the report was taken, which is what tells a live rate from a frozen one. */
  readonly at: number;
  readonly surface: string;
  readonly preAt: number;
  readonly postAt: number | null;
  readonly react: {
    readonly hook: string;
    readonly version: string | null;
    readonly commits: number;
    readonly notified: number;
    readonly foreign: number;
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
  readonly meters: Readonly<
    Record<
      string,
      {
        readonly peak: number;
        readonly peakAt: number | null;
        readonly recent: number;
        readonly recentAt: number | null;
      }
    >
  >;
  readonly plugins: readonly {
    readonly name: string;
    readonly status: string;
    readonly reason?: string;
    readonly missingOptional?: readonly string[];
  }[];
  readonly rewrites: readonly {
    readonly plugin: string;
    readonly type: string;
    readonly ran: number;
    readonly applied: number;
    readonly missed: number;
  }[];
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

/** The facts, read off the bridge's diagnostics. */
export function reportFacts(d: Diagnostics, surface: Surface, at: number): ReportFacts {
  return {
    extension: d.identifiersFor,
    engine: d.engine,
    at,
    surface,
    preAt: d.preAt,
    postAt: d.postAt,
    react: d.react,
    mounts: d.mounts,
    storage: d.storage,
    bus: {
      outbound: d.outboundCount,
      inbound: d.inboundCount,
      clones: d.tapClones,
      cloneMs: d.tapCloneMs,
      cloneMaxMs: d.tapCloneMaxMs,
      cloneMaxType: d.tapCloneMaxType,
    },
    meters: d.meters,
    plugins: d.plugins,
    rewrites: d.rewrites,
    hostPatches: d.hostPatches,
    previous: d.previous,
    errors: d.errors,
  };
}

/** Wall-clock `HH:MM:SS`, local, to line up against VS Code's own logs. */
function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

/** A byte count in whichever unit keeps it to three or four characters. */
function bytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

/**
 * How long a closed window stays a description of now. Two seconds rather than one: a window closes
 * when the next event arrives, so a steady one per second closes slightly late, and one second would
 * flap on exactly the traffic that is fine.
 */
const RATE_IS_STALE_MS = 2000;

/**
 * What a meter is doing now. `recent` is the last window that closed, and only an event closes one,
 * so a meter that stops keeps its last value for the life of the panel; a window that closed a
 * while ago is a meter gone quiet, and quiet is zero (D53).
 */
export function currentRate(
  meter: { readonly recent: number; readonly recentAt: number | null },
  now: number,
): number {
  if (meter.recentAt === null) return 0;
  return now - meter.recentAt > RATE_IS_STALE_MS ? 0 : meter.recent;
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
 * The whole report, for somebody diagnosing a panel from cold: rich where the menu is lean, and
 * the peaks most of all, since a peak says when and so lines up with VS Code's own logs.
 *
 * It carries no message content, no titles, no transcript text and no identifier of the user's, by
 * construction rather than by filtering (D53): the facts are counts and versions, and a check's
 * detail says what its contributor believes, never the value it holds. A third-party plugin is
 * asked the same in authoring.md, and nothing enforces it.
 */
export function formatReport(facts: ReportFacts, groups: readonly CheckGroup[]): string {
  const out: string[] = ["rigline report"];

  out.push("");
  out.push(`  extension  ${facts.extension ?? "unknown"}, surface ${facts.surface}`);
  out.push(`  engine     ${facts.engine ?? "unstamped, so older than the stamp"}`);
  const post = facts.postAt === null ? "not reported" : `${facts.postAt}ms`;
  out.push(`  boot       pre ${facts.preAt}ms, post ${post}`);
  out.push(
    `  react      ${facts.react.version ?? "no renderer"}, hook ${facts.react.hook}, ` +
      `${facts.react.commits} commits / ${facts.react.notified} notified` +
      (facts.react.foreign > 0 ? `, ${facts.react.foreign} other renderer(s) ignored` : ""),
  );
  out.push(
    `  mounts     ${facts.mounts.active} active, ${facts.mounts.replaced} re-placed, ` +
      `${facts.mounts.lost} lost, on ${facts.mounts.driver}`,
  );
  // Only when there is one: a line that appears at all is the finding (D54).
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
    out.push(
      `  ${name.padEnd(10)} ${String(m.peak).padStart(6)}/s${at}, now ${currentRate(m, facts.at)}/s`,
    );
  }

  out.push("", "plugins");
  for (const p of facts.plugins) {
    const without =
      (p.missingOptional?.length ?? 0) > 0 ? ` — without ${p.missingOptional?.join("; ")}` : "";
    out.push(`  ${p.name.padEnd(16)} ${p.status}${p.reason ? ` — ${p.reason}` : ""}${without}`);
  }

  if (facts.rewrites.length > 0) {
    out.push("", "rewrites");
    for (const r of facts.rewrites) {
      out.push(
        `  ${r.plugin.padEnd(16)} ${r.type}: ran ${r.ran}, applied ${r.applied}, missed ${r.missed}`,
      );
    }
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
