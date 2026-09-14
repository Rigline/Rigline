/**
 * Rigline's own integration harness: proves every capability the host grants through the same
 * `ctx` any plugin gets, plus the kernel's own bookkeeping, and shows the result as a small badge
 * in the composer footer (or fixed to a corner on the session list, which has no composer).
 *
 * `globalThis.__rigline.diagnostics` is read directly below, which nothing else may do: this plugin
 * exists to diagnose the host, and the diagnostics it needs (pre/post timing, raw tap counts,
 * every plugin's load status, rewrite and patch bookkeeping) is not a capability a manifest could
 * sanely declare. Everything else here goes through `ctx` like any third-party plugin, which is
 * what makes an all-green badge proof that the plugin machinery itself works end to end.
 *
 * Every verdict passes through `report()`, so the badge's failing count and the panel's lines are
 * always built from the same map and cannot disagree.
 */
import { definePlugin } from "@rigline/plugin-api";
import {
  acquireVerdict,
  anchorResolvesVerdict,
  bufferSealedVerdict,
  busTrafficVerdict,
  type CheckResult,
  chainComposeVerdict,
  errorMessage,
  failingCount,
  formatLine,
  hostErrorsVerdict,
  immutabilityVerdict,
  leakVerdict,
  mountOrderVerdict,
  mountSurvivesVerdict,
  type PluginStatusLike,
  pluginStatusVerdict,
  preHookOrderVerdict,
  type RewriteRecordLike,
  reactVerdict,
  rewriteBookkeepingVerdict,
  sessionIdVerdict,
  stylesheetVerdict,
  tablesLoadedVerdict,
  toolCallsVerdict,
  transcriptVerdict,
  type Verdict,
} from "./checks.ts";

/** The mark the first rewriter adds and the second strips, so the net effect on the wire is nothing. */
const MARK = "[rigline-probe] ";

/** The check names, in report order. Seeded up front so the panel's line order never depends on
 * which event happens to fire first. */
const ORDER = [
  "pre hook ran before render",
  "acquireVsCodeApi wrapped and called",
  "bus traffic in both directions",
  "replay buffer sealed",
  "tables loaded",
  "every plugin loaded",
  "no host errors",
  "React renderer injected",
  "surface",
  "read taps are immutable",
  "anchor resolves",
  "anchor element found",
  "mount survives re-render",
  "mounts sharing an anchor keep registry order",
  "rewrite chain composes in order",
  "read taps see the app's original",
  "rewrite bookkeeping",
  "tool calls observed",
  "session id observed",
  "transcript rows identified and timed",
  "stylesheet applied",
] as const;

/** The fields of `globalThis.__rigline.diagnostics` this plugin reads. See bridge.ts for the full shape. */
interface ProbeDiagnostics {
  readonly rootChildrenAtPre: number;
  readonly rootChildrenAtPost: number | null;
  readonly acquireWrapped: boolean;
  readonly acquireCalled: boolean;
  readonly outboundCount: number;
  readonly inboundCount: number;
  readonly buffered: number;
  readonly bufferSealed: boolean;
  readonly identifiersFor: string | null;
  readonly plugins: readonly PluginStatusLike[];
  readonly rewrites: readonly RewriteRecordLike[];
  readonly errors: readonly string[];
  readonly react: {
    readonly hook: "installed" | "chained";
    readonly version: string | null;
    readonly commits: number;
    readonly notified: number;
  };
  readonly transcript: { readonly entries: number; readonly timed: number };
}

function readDiagnostics(): ProbeDiagnostics | null {
  const bridge = (globalThis as { __rigline?: { diagnostics: ProbeDiagnostics } }).__rigline;
  return bridge ? bridge.diagnostics : null;
}

const CSS = `
.rigline-probe-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 6px;
  font: 10px/1.4 monospace;
  color: #fff;
  background: #2d7d46;
  cursor: pointer;
  vertical-align: middle;
  user-select: none;
}
.rigline-probe-badge.rigline-probe-failing {
  background: #a3352f;
}
.rigline-probe-badge-fixed {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 2147483647;
  margin-left: 0;
}
.rigline-probe-panel {
  position: fixed;
  right: 8px;
  bottom: 32px;
  z-index: 2147483647;
  max-width: 480px;
  max-height: 60vh;
  overflow: auto;
  font: 11px/1.45 monospace;
  background: rgba(20, 20, 22, 0.94);
  color: #e6e6e6;
  border: 1px solid #4a4a52;
  border-radius: 6px;
  padding: 8px 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.rigline-probe-panel-body {
  margin: 0;
  white-space: pre-wrap;
  user-select: text;
}
`;

export default definePlugin({
  setup(ctx) {
    const checks = new Map<string, CheckResult>();
    for (const name of ORDER) checks.set(name, { name, verdict: "n/a", detail: "no data yet" });

    let panelVisible = false;
    let currentBadge: HTMLElement | null = null;
    let badgeMounted = false;
    let anchorEl: Element | null = null;

    function applyBadgeState(): void {
      if (!currentBadge) return;
      const failing = failingCount([...checks.values()]);
      currentBadge.textContent = failing > 0 ? `RIG ${failing}` : "RIG";
      currentBadge.classList.toggle("rigline-probe-failing", failing > 0);
      const state = failing > 0 ? `${failing} failing` : "all checks pass";
      const action = panelVisible ? "hide" : "show";
      currentBadge.title = `${state} — click to ${action} diagnostics`;
    }

    function renderPanelBody(): void {
      const text = ORDER.map((name) => formatLine(checks.get(name) as CheckResult)).join("\n");
      if (panelBody.textContent !== text) panelBody.textContent = text;
    }

    function report(name: (typeof ORDER)[number], verdict: Verdict, detail: string): void {
      const prev = checks.get(name);
      if (prev && prev.verdict === verdict && prev.detail === detail) return;
      checks.set(name, { name, verdict, detail });
      applyBadgeState();
      if (panelVisible) renderPanelBody();
    }

    function togglePanel(show: boolean): void {
      if (panelVisible === show) return;
      panelVisible = show;
      panel.hidden = !show;
      applyBadgeState();
      if (show) renderPanelBody();
    }

    function buildBadge(): HTMLElement {
      const span = document.createElement("span");
      span.className = "rigline-probe-badge";
      if (ctx.surface === "sessionList") span.classList.add("rigline-probe-badge-fixed");
      span.addEventListener("click", () => togglePanel(!panelVisible));
      currentBadge = span;
      badgeMounted = true;
      applyBadgeState();
      return span;
    }

    const panel = document.createElement("div");
    panel.className = "rigline-probe-panel";
    panel.hidden = true;
    const panelBody = document.createElement("pre");
    panelBody.className = "rigline-probe-panel-body";
    panel.appendChild(panelBody);
    document.body.appendChild(panel);

    function onKeydown(e: KeyboardEvent): void {
      if (e.key === "Escape" && panelVisible) togglePanel(false);
    }
    function onPointerDown(e: MouseEvent): void {
      if (!panelVisible) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panel.contains(target)) return;
      if (currentBadge?.contains(target)) return;
      togglePanel(false);
    }
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("mousedown", onPointerDown);

    // Check 9: always pass, the detail is what the badge and every n/a below is relative to.
    report("surface", "pass", ctx.surface);

    // Check 21: the stylesheet is applied synchronously, so this is stable for the plugin's life.
    ctx.style(CSS);
    const styled = document.head.querySelector('style[data-rigline-style="probe"]') !== null;
    const stylesheet = stylesheetVerdict(styled);
    report("stylesheet applied", stylesheet.verdict, stylesheet.detail);

    // Check 11: resolved once; the anchor table does not change at runtime.
    try {
      const resolved = ctx.anchor("modelPill");
      const anchor = anchorResolvesVerdict(resolved, null);
      report("anchor resolves", anchor.verdict, anchor.detail);
    } catch (e) {
      const anchor = anchorResolvesVerdict(null, errorMessage(e));
      report("anchor resolves", anchor.verdict, anchor.detail);
    }

    // Badge placement, and checks 12/13/14 which ride along with it.
    if (ctx.surface === "sessionList") {
      report("anchor element found", "n/a", "sessionList renders no model pill");
      ctx.mount(document.body, buildBadge);
    } else {
      report("anchor element found", "n/a", "not found yet");
      ctx.watch("modelPill", (el) => {
        anchorEl = el;
        report("anchor element found", "pass", "found");
        return ctx.mountAfter(el, buildBadge);
      });
    }

    // Check 10: the read-immutability of a tap's payload, and once seen, its nested `request`.
    let nestedSeen = false;
    let topFrozen = false;
    let nestedFrozen = false;
    ctx.onMessage("request", (payload) => {
      const frozenTop = Object.isFrozen(payload);
      const inner = payload.request;
      if (typeof inner === "object" && inner !== null) {
        nestedSeen = true;
        topFrozen = frozenTop;
        nestedFrozen = Object.isFrozen(inner);
      }
      const immutable = immutabilityVerdict(nestedSeen, topFrozen, nestedFrozen);
      report("read taps are immutable", immutable.verdict, immutable.detail);
    });

    // Checks 15/16: two rewriters composing on rename_tab, plus a read tap proving the app's
    // original title never carries the mark onto the wire.
    let chainCrossed = false;
    let chainComposed = false;
    ctx.rewrite("rename_tab", (payload) => {
      const title = payload.title;
      return typeof title === "string" ? { title: MARK + title } : null;
    });
    ctx.rewrite("rename_tab", (payload) => {
      const title = payload.title;
      if (typeof title !== "string") return null;
      chainCrossed = true;
      const composedNow = title.startsWith(MARK);
      if (composedNow) chainComposed = true;
      const chain = chainComposeVerdict(chainCrossed, chainComposed);
      report("rewrite chain composes in order", chain.verdict, chain.detail);
      return composedNow ? { title: title.slice(MARK.length) } : null;
    });

    let renameSeen = false;
    let renameLeaked = false;
    let lastRenameTitle: string | null = null;
    ctx.onMessage("rename_tab", (payload) => {
      renameSeen = true;
      const title = payload.title;
      lastRenameTitle = typeof title === "string" ? title : null;
      if (lastRenameTitle?.startsWith(MARK)) renameLeaked = true;
      const leak = leakVerdict(renameSeen, renameLeaked, lastRenameTitle);
      report("read taps see the app's original", leak.verdict, leak.detail);
    });

    // Check 18: tool calls observed through ctx.onToolUse.
    let toolsSeen = 0;
    let lastTool: string | null = null;
    ctx.onToolUse((tool) => {
      toolsSeen += 1;
      lastTool = tool.name;
      const tools = toolCallsVerdict(toolsSeen, lastTool);
      report("tool calls observed", tools.verdict, tools.detail);
    });

    // Check 19: the panel's session id, through ctx.onSessionId.
    ctx.onSessionId((id) => {
      const session = sessionIdVerdict(id);
      report("session id observed", session.verdict, session.detail);
    });

    // Check 20: the probe draws nothing; it only checks the host can identify and time rows.
    let transcriptThrew = false;
    let transcriptStuckSinceMs: number | null = null;
    try {
      ctx.decorateTranscript(() => null);
    } catch (e) {
      transcriptThrew = true;
      report(
        "transcript rows identified and timed",
        "fail",
        `decorateTranscript threw: ${errorMessage(e)}`,
      );
    }

    // Checks driven by diagnostics and by DOM state that only changes with a render: polled once a
    // second, which is also what keeps the panel fresh while it is open.
    function pollDiagnostics(now: number): void {
      const diag = readDiagnostics();
      if (!diag) return;

      const pre = preHookOrderVerdict(diag.rootChildrenAtPre, diag.rootChildrenAtPost);
      report("pre hook ran before render", pre.verdict, pre.detail);

      const acquire = acquireVerdict(diag.acquireWrapped, diag.acquireCalled);
      report("acquireVsCodeApi wrapped and called", acquire.verdict, acquire.detail);

      const traffic = busTrafficVerdict(diag.outboundCount, diag.inboundCount);
      report("bus traffic in both directions", traffic.verdict, traffic.detail);

      const sealed = bufferSealedVerdict(diag.bufferSealed, diag.buffered);
      report("replay buffer sealed", sealed.verdict, sealed.detail);

      const tables = tablesLoadedVerdict(diag.identifiersFor);
      report("tables loaded", tables.verdict, tables.detail);

      const plugins = pluginStatusVerdict(diag.plugins);
      report("every plugin loaded", plugins.verdict, plugins.detail);

      const errors = hostErrorsVerdict(diag.errors);
      report("no host errors", errors.verdict, errors.detail);

      const react = reactVerdict(diag.react);
      report("React renderer injected", react.verdict, react.detail);

      const rewrites = rewriteBookkeepingVerdict(diag.rewrites, "probe");
      report("rewrite bookkeeping", rewrites.verdict, rewrites.detail);

      const survives = mountSurvivesVerdict(badgeMounted, currentBadge?.isConnected ?? false);
      report("mount survives re-render", survives.verdict, survives.detail);

      if (ctx.surface === "sessionList") {
        report(
          "mounts sharing an anchor keep registry order",
          "n/a",
          "no shared anchor on this surface",
        );
      } else if (anchorEl === null) {
        report("mounts sharing an anchor keep registry order", "n/a", "anchor not found yet");
      } else {
        const indices: number[] = [];
        let sibling = anchorEl.nextElementSibling;
        while (sibling?.hasAttribute("data-rigline-mount")) {
          const owner = sibling.getAttribute("data-rigline-mount");
          const index = diag.plugins.findIndex((p) => p.name === owner);
          if (index !== -1) indices.push(index);
          sibling = sibling.nextElementSibling;
        }
        const order = mountOrderVerdict(indices);
        report("mounts sharing an anchor keep registry order", order.verdict, order.detail);
      }

      if (ctx.surface === "sessionList") {
        report("transcript rows identified and timed", "n/a", "sessionList renders no transcript");
      } else if (!transcriptThrew) {
        const { entries, timed } = diag.transcript;
        if (entries === 0 || timed > 0) transcriptStuckSinceMs = null;
        else if (transcriptStuckSinceMs === null) transcriptStuckSinceMs = now;
        const elapsed = transcriptStuckSinceMs === null ? null : now - transcriptStuckSinceMs;
        const transcript = transcriptVerdict(entries, timed, elapsed);
        report("transcript rows identified and timed", transcript.verdict, transcript.detail);
      }
    }

    pollDiagnostics(performance.now());
    const interval = setInterval(() => pollDiagnostics(performance.now()), 1000);

    return () => {
      clearInterval(interval);
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("mousedown", onPointerDown);
      panel.remove();
    };
  },
});
