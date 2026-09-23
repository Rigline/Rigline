/**
 * Rigline's diagnostics, in Rigline's menu, and one contributor to them.
 *
 * Two jobs. Its menu contribution renders the host's check registry: `core` — the kernel and every
 * capability module — then each plugin under its own name, so the report reads as *which part of
 * this is broken* rather than as one undifferentiated list. The failing count on the RIG pill is the
 * shell's, which reads the same registry. And separately, this plugin contributes the handful of
 * checks nothing else is in a position to run: the ones that have to do something to the bus and
 * then look at what came back.
 *
 * `globalThis.__rigline` is read directly below, which nothing else may do. That is what this plugin
 * is for: reading every contributor's verdict, and the diagnostics the copied report carries, is not
 * a capability a manifest could sanely declare. Its own checks go through `ctx.check` like anybody
 * else's, which is what keeps the panel honest about the API it is displaying.
 */
import { definePlugin, type Surface } from "@rigline/plugin-api";
import { type ReactNode, useEffect, useState } from "react";
import {
  type CheckGroup,
  chainComposeVerdict,
  errorMessage,
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
    readonly foreign: number;
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

/** How long "copied"/"copy failed" sits in place of the button's own label before reverting. */
const COPY_FLASH_MS = 1200;

/** How often the open menu re-runs every contributed check: the cadence `ctx.check`'s "a check reads,
 * it does not compute" rule exists to keep affordable. Nothing runs while the menu is closed. */
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

function runChecks(): readonly CheckGroup[] {
  return readBridge()?.checks?.run() ?? [];
}

/**
 * What the clipboard gets: everything, where the menu shows the check lines alone.
 *
 * The split is the point. The menu is scanned for a red line and stays legible by staying short; a
 * report pasted into an issue is read cold by somebody who cannot ask a follow-up question, and
 * wants the version, the peaks and the previous run's tail. Falls back to the check lines alone if
 * the bridge has gone, which would itself be worth reporting.
 */
function clipboardText(groups: readonly CheckGroup[], surface: Surface): string {
  const diag = readBridge()?.diagnostics;
  if (!diag) return formatGroups(groups);
  return formatReport(
    {
      extension: diag.identifiersFor,
      engine: diag.engine,
      at: Date.now(),
      surface,
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

function Diagnostics(props: { readonly surface: Surface }): ReactNode {
  const [groups, setGroups] = useState(runChecks);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setGroups(runChecks()), POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), COPY_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  return (
    <div className="rigline-probe" style={{ padding: "4px 10px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <button
          type="button"
          title="Copy the full report — versions, peaks, plugins and the previous run"
          style={{
            padding: 0,
            border: "none",
            background: "none",
            font: "inherit",
            fontSize: 10,
            color: "var(--vscode-textLink-foreground, #8ab4f8)",
            cursor: "pointer",
          }}
          onClick={() =>
            setFlash(
              copyToClipboard(clipboardText(groups, props.surface)) ? "copied" : "copy failed",
            )
          }
        >
          {flash ?? "copy"}
        </button>
      </div>
      <pre style={{ margin: 0, font: "11px/1.45 monospace", whiteSpace: "pre-wrap" }}>
        {formatGroups(groups)}
      </pre>
    </div>
  );
}

export default definePlugin({
  setup(ctx) {
    ctx.menu(() => <Diagnostics surface={ctx.surface} />);

    // ---- What this plugin contributes, through ctx.check like anybody else ------------------

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
  },
});
