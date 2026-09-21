/**
 * Rigline's diagnostics panel, and one contributor to it.
 *
 * Two jobs that used to be one. The panel and the `RIG` badge render the host's check registry:
 * `core` — the kernel and every capability module — then each plugin under its own name, so the
 * report reads as *which part of this is broken* rather than as one undifferentiated list. And
 * separately, this plugin contributes the handful of checks nothing else is in a position to run:
 * the ones that have to do something to the bus and then look at what came back.
 *
 * `globalThis.__rigline` is read directly below, which nothing else may do. That is what this plugin
 * is for: reading every contributor's verdict, and the diagnostics the copied report carries, is not
 * a capability a manifest could sanely declare. Its own checks go through `ctx.check` like anybody
 * else's, which is what keeps the panel honest about the API it is displaying.
 *
 * It no longer declares `tools` or `session`. It used to, to prove the capability was grantable, and
 * a check about either is now the capability module's own — so the declaration had become a
 * dependency on nothing, which the install-time scan says in those words. The consequence is right
 * rather than a loss: on a surface where no plugin uses tool calls, the `core` line says so instead
 * of waiting forever for one, and no `io_message` tap is installed for a panel that had no use for it.
 */
import { definePlugin } from "@rigline/plugin-api";
import {
  badgeMountedVerdict,
  type CheckGroup,
  chainComposeVerdict,
  errorMessage,
  failingCount,
  formatGroups,
  formatReport,
  immutabilityVerdict,
  leakVerdict,
  type PluginStatusLike,
  type RewriteRecordLike,
  rewriteBookkeepingVerdict,
} from "./checks.ts";

/** The mark the first rewriter adds and the second strips, so the net effect on the wire is nothing. */
const MARK = "[rigline-probe] ";

/** The fields of `globalThis.__rigline` this plugin reads. See the host's kernel/bridge.ts for the
 * full shape; `checks` is the registry every contributor's line comes back through. */
interface ProbeBridge {
  readonly diagnostics: ProbeDiagnostics;
  readonly checks: { run(): readonly CheckGroup[] } | null;
}

interface ProbeDiagnostics {
  readonly identifiersFor: string | null;
  readonly engine: string | null;
  readonly plugins: readonly PluginStatusLike[];
  readonly rewrites: readonly RewriteRecordLike[];
  readonly errors: readonly string[];
  readonly react: {
    readonly hook: "installed" | "chained";
    readonly version: string | null;
    readonly commits: number;
    readonly notified: number;
  };
  readonly mounts: {
    readonly driver: "commit" | "observer";
    readonly active: number;
    readonly replaced: number;
    readonly lost: number;
    readonly abandoned: readonly string[];
  };
  readonly meters: Record<
    string,
    {
      readonly peak: number;
      readonly peakAt: number | null;
      readonly recent: number;
      readonly recentAt: number | null;
    }
  >;
  readonly storage: {
    readonly available: boolean;
    readonly writes: number;
    readonly failures: number;
    readonly bytes: number;
    readonly lastError: string | null;
  };
  readonly previous: {
    readonly from: number;
    readonly to: number;
    readonly entries: readonly Record<string, unknown>[];
  } | null;
  readonly preAt: number;
  readonly postAt: number | null;
  readonly outboundCount: number;
  readonly inboundCount: number;
  readonly tapClones: number;
  readonly tapCloneMs: number;
  readonly tapCloneMaxMs: number;
  readonly tapCloneMaxType: string | null;
  readonly hostPatches: readonly {
    readonly plugin: string;
    readonly applied: boolean;
    readonly required: boolean;
    readonly reason?: string;
  }[];
}

function readBridge(): ProbeBridge | null {
  return (globalThis as { __rigline?: ProbeBridge }).__rigline ?? null;
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
.rigline-probe-panel-controls {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 9px;
  margin-bottom: 4px;
  user-select: none;
}
.rigline-probe-panel-copy {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 10px;
  color: #8ab4f8;
  cursor: pointer;
}
`;

/** How long "copied"/"copy failed" sits in place of the button's own label before reverting. */
const COPY_FLASH_MS = 1200;

/** How often the panel and badge are refreshed. It is also how often every contributed check runs,
 * for the life of the window, which is the cadence `ctx.check`'s "a check reads, it does not
 * compute" rule exists to keep affordable. */
const POLL_MS = 1000;

/**
 * Copy `text` with `document.execCommand("copy")` over a detached, invisible textarea, rather than
 * the async Clipboard API, which needs a permission a webview does not necessarily hold and rejects
 * its promise rather than throwing when denied — a failed copy would then be silent. Deprecated but
 * unconditional: it either copies or returns false, never a permission prompt this panel cannot show.
 *
 * The same fifteen lines as session-id's, deliberately. A plugin is a self-contained ES module and
 * `@rigline/plugin-api` is the contract between a plugin and the host, not a utility library; two
 * plugins sharing a clipboard helper through it would make the API surface grow by whatever any
 * first-party plugin happened to need. If a third plugin wants this, that is the argument for a
 * `ctx.copy` capability, which is a decision rather than a refactor.
 */
function copyToClipboard(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

export default definePlugin({
  setup(ctx) {
    let panelVisible = false;
    let currentBadge: HTMLElement | null = null;
    let badgeMounted = false;

    /** The last run of the registry. The panel, the badge and the clipboard all read this one
     * value, so the count and the lines cannot disagree about what a check found. */
    let groups: readonly CheckGroup[] = [];

    function applyBadgeState(): void {
      if (!currentBadge) return;
      const failing = failingCount(groups);
      currentBadge.textContent = failing > 0 ? `RIG ${failing}` : "RIG";
      currentBadge.classList.toggle("rigline-probe-failing", failing > 0);
      const state = failing > 0 ? `${failing} failing` : "all checks pass";
      const action = panelVisible ? "hide" : "show";
      currentBadge.title = `${state} — click to ${action} diagnostics`;
    }

    function renderPanelBody(): void {
      const text = formatGroups(groups);
      if (panelBody.textContent !== text) panelBody.textContent = text;
    }

    let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * What the clipboard gets: everything, where the panel shows the check lines alone.
     *
     * The split is the point. The panel is scanned for a red line and stays legible by staying
     * short; a report pasted into an issue is read cold by somebody who cannot ask a follow-up
     * question, and wants the version, the peaks and the previous run's tail. Falls back to the
     * check lines alone if the bridge has gone, which would itself be worth reporting.
     */
    function clipboardText(): string {
      const diag = readBridge()?.diagnostics;
      if (!diag) return formatGroups(groups);
      return formatReport(
        {
          extension: diag.identifiersFor,
          engine: diag.engine,
          at: Date.now(),
          surface: ctx.surface,
          preAt: diag.preAt,
          postAt: diag.postAt,
          react: diag.react,
          mounts: diag.mounts,
          storage: diag.storage,
          bus: {
            outbound: diag.outboundCount,
            inbound: diag.inboundCount,
            clones: diag.tapClones,
            cloneMs: diag.tapCloneMs,
            cloneMaxMs: diag.tapCloneMaxMs,
            cloneMaxType: diag.tapCloneMaxType,
          },
          meters: diag.meters,
          plugins: diag.plugins,
          hostPatches: diag.hostPatches,
          previous: diag.previous,
          errors: diag.errors,
        },
        groups,
      );
    }

    function onCopyClick(): void {
      const ok = copyToClipboard(clipboardText());
      if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
      copyButton.textContent = ok ? "copied" : "copy failed";
      copyFlashTimer = setTimeout(() => {
        copyFlashTimer = null;
        copyButton.textContent = "copy";
      }, COPY_FLASH_MS);
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
    const controls = document.createElement("div");
    controls.className = "rigline-probe-panel-controls";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "rigline-probe-panel-copy";
    copyButton.textContent = "copy";
    copyButton.title = "Copy the full report — versions, peaks, plugins and the previous run";
    copyButton.addEventListener("click", onCopyClick);
    controls.appendChild(copyButton);
    const panelBody = document.createElement("pre");
    panelBody.className = "rigline-probe-panel-body";
    panel.append(controls, panelBody);
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

    ctx.style(CSS);

    // Badge placement. `footerSpacer`, not the model pill: the footer measures its own element
    // children to pick a fit stage and moves the pill out of itself at the widest one, so a
    // decoration anchored to the pill oscillates against the measurement it is part of (D54).
    // mountBefore puts the badge at the end of the left cluster rather than beside the send button.
    if (ctx.surface === "sessionList") {
      ctx.mount(document.body, buildBadge);
    } else {
      ctx.watch("footerSpacer", (el) => ctx.mountBefore(el, buildBadge));
    }

    // ---- What this plugin contributes, through ctx.check like anybody else ------------------

    ctx.check("badge is mounted", () =>
      badgeMountedVerdict(badgeMounted, currentBadge?.isConnected ?? false),
    );

    // The read-immutability of a tap's payload, and once seen, its nested `request`. An experiment
    // rather than a reading: only something that has registered a tap can say what a tap was handed.
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
    });
    ctx.check("read taps are immutable", () =>
      immutabilityVerdict(nestedSeen, topFrozen, nestedFrozen),
    );

    // Two rewriters composing on rename_tab, plus a read tap proving the app's original title never
    // carries the mark onto the wire.
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
      return composedNow ? { title: title.slice(MARK.length) } : null;
    });
    ctx.check("rewrite chain composes in order", () =>
      chainComposeVerdict(chainCrossed, chainComposed),
    );

    let renameSeen = false;
    let renameLeaked = false;
    let lastRenameTitle: string | null = null;
    ctx.onMessage("rename_tab", (payload) => {
      renameSeen = true;
      const title = payload.title;
      lastRenameTitle = typeof title === "string" ? title : null;
      if (lastRenameTitle?.startsWith(MARK)) renameLeaked = true;
    });
    ctx.check("read taps see the app's original", () =>
      leakVerdict(renameSeen, renameLeaked, lastRenameTitle),
    );

    ctx.check("rewrite bookkeeping", () => {
      const diag = readBridge()?.diagnostics;
      if (!diag) return { verdict: "fail", detail: "the bridge is gone" };
      return rewriteBookkeepingVerdict(diag.rewrites, "probe");
    });

    // A decorator that draws nothing, kept for the life of the plugin. It is not idle: the
    // transcript service sweeps only while something is decorating, so this registration is what
    // keeps rows being identified and timed — and therefore what makes the transcript capability's
    // own check mean anything — on a panel where the plugin that actually draws on rows is switched
    // off or not installed. On a surface with no rows the capability registers nothing and this
    // costs the panel no sweep at all, which is the capability's business rather than this one's.
    //
    // Caught rather than allowed to disable this plugin, because this plugin is the panel. The
    // consequence of a throw is otherwise perfectly silent: `entries` stays at zero, which the
    // transcript capability correctly reports as "no rows yet" rather than as a fault, and nothing
    // anywhere would say the sweep was never started.
    let transcriptError: string | null = null;
    try {
      ctx.decorateTranscript(() => null);
    } catch (e) {
      transcriptError = errorMessage(e);
    }
    ctx.check("transcript decorator registered", () =>
      transcriptError === null
        ? { verdict: "pass", detail: "registered" }
        : { verdict: "fail", detail: transcriptError },
    );

    // ---- The panel's cadence ---------------------------------------------------------------

    /**
     * Run every contributor's checks and repaint.
     *
     * Deferred, not called at setup: this runs inside the kernel's plugin-loading loop, and the
     * kernel seals the replay buffer only once that loop has finished, so a run taken now reports a
     * failure for something that could not yet be true. Everything between here and the seal is a
     * microtask continuation, so a macrotask lands after it. Sound because the probe is pinned last
     * in registry order: no later plugin's import can yield a macrotask turn ahead of this. It is
     * also what lets every *other* plugin's checks be registered before the first run.
     */
    function poll(): void {
      groups = readBridge()?.checks?.run() ?? [];
      applyBadgeState();
      if (panelVisible) renderPanelBody();
    }

    const firstPoll = setTimeout(poll, 0);
    const interval = setInterval(poll, POLL_MS);

    return () => {
      clearTimeout(firstPoll);
      clearInterval(interval);
      if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("mousedown", onPointerDown);
      panel.remove();
    };
  },
});
