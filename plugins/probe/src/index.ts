/**
 * Live self-tests of the plugin API, reported under Rigline's Diagnostics like any plugin's checks.
 *
 * Only what is an experiment rather than a reading (D63): register a tap and check what it was
 * handed, rewrite twice and check the chain composed. Everything goes through `ctx`, exactly as a
 * third-party plugin's would, which is what makes a green line evidence rather than self-assessment.
 * Diagnostics itself is the host's (D119).
 */
import { definePlugin } from "@rigline/plugin-api";
import { chainComposeVerdict, errorMessage, immutabilityVerdict, leakVerdict } from "./checks.ts";

/** The mark the first rewriter adds and the second strips, so the net effect on the wire is nothing. */
const MARK = "[rigline-probe] ";

export default definePlugin({
  setup(ctx) {
    // The read-immutability of a tap's payload, and once seen, its nested `request`. Only something
    // that has registered a tap can say what a tap was handed.
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
    ctx.onMessage("rename_tab", (payload) => {
      renameSeen = true;
      const title = payload.title;
      if (typeof title === "string" && title.startsWith(MARK)) renameLeaked = true;
    });
    ctx.check("read taps see the app's original", () => leakVerdict(renameSeen, renameLeaked));

    // A decorator that draws nothing, kept for the life of the plugin. It is not idle: the
    // transcript service sweeps only while something is decorating, so this registration is what
    // keeps rows being identified and timed — and therefore what makes the transcript capability's
    // own check mean anything — on a panel where the plugin that actually draws on rows is switched
    // off or not installed. On a surface with no rows the capability registers nothing and this
    // costs the panel no sweep at all, which is the capability's business rather than this one's.
    //
    // Caught rather than allowed to disable this plugin, so it is a line rather than silence: a
    // throw leaves `entries` at zero, which the transcript capability correctly reports as "no rows
    // yet" rather than as a fault, and nothing anywhere would say the sweep was never started.
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
