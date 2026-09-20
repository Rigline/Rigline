/**
 * The pre hook: statically imported from the head of the extension's webview/index.js, so it
 * evaluates before the bundle body. That ordering is the only way to wrap acquireVsCodeApi, which
 * the app calls exactly once during boot.
 *
 * NOTHING HERE MAY THROW. A throw at this module's top level fails the whole module graph and the
 * panel renders blank with no attribution. Every statement sits inside the try, and no third-party
 * code is reachable from this file. Plugins load in post.ts, dynamically.
 *
 * What this does: wrap acquireVsCodeApi (caching the single real call, since it can only be made
 * once), tap both directions of the bus, run the outbound rewrite chain, and record everything to
 * a bridge on globalThis so that post.ts — which does not exist yet when this runs — can build
 * each plugin's onMessage out of it, replaying what was buffered before the plugin registered.
 *
 * A TAP IS READ-ONLY, AND THAT IS ENFORCED RATHER THAN DOCUMENTED. A handler is handed a frozen
 * deep clone, never the object on its way past. Handing over the live object would make every tap
 * an undeclared write capability: a handler could rewrite an outbound payload, rewrite the
 * requestId an envelope correlates on, rewrite an inbound message before the app's own listener
 * saw it (this file's listener is registered first, at static-import time), or mutate a replayed
 * message that had already been delivered to somebody else.
 *
 * Changing an outbound message on purpose goes through the rewrite chain, which this file applies
 * because the wrapped postMessage is the one egress, while post.ts decides entirely whether any
 * given patch is allowed. The split is deliberate: what belongs here is the order patches apply in
 * and the guarantee that the app's message reaches the extension host either way; what belongs
 * there is the manifest, the validation and the per-plugin attribution. So this file still names
 * no harvested identifier and stays version-independent.
 *
 * post.ts is the only intended reader of this bridge. It is deliberately not part of the typed,
 * capability-scoped PluginContext a plugin receives — it is host-internal plumbing, plus (via
 * diagnostics) an ambient debug surface the probe plugin reads directly, the one sanctioned
 * exception, because it exists specifically to diagnose the host itself.
 */

/** One tapped or rewritten message, already unwrapped where applicable: see `tap` and `rewrite`. */
type Handler = (payload: unknown) => void;

/**
 * One plugin's turn in the rewrite chain: given the payload as it stands, the fields it wants to
 * replace, or null for "no change".
 *
 * Never throws in practice — post.ts wraps the plugin's own function, validates what it returned,
 * and turns anything wrong into a disabled plugin — but this file catches it anyway, because this
 * is the file that may never throw regardless of what called it.
 */
type Rewriter = (payload: Readonly<Record<string, unknown>>) => Record<string, unknown> | null;

interface RiglineBridge {
  readonly diagnostics: {
    /** An explicit version tag on the bridge shape, so a consumer can tell what it is reading. */
    readonly version: "rigline-1";
    /** `performance.now()` when this module ran, rounded — the earliest instant it can measure. */
    preAt: number;
    /** When post.ts finished loading plugins, or null before that has happened. */
    postAt: number | null;
    /** `#root`'s child count when this module ran — `-1` if `#root` cannot be found at all. */
    rootChildrenAtPre: number;
    /** The same count once post.ts reports in, or null before that. */
    rootChildrenAtPost: number | null;
    /** Whether a real `acquireVsCodeApi` existed to wrap. False means nothing here can post. */
    acquireWrapped: boolean;
    /** Whether the app has called the wrapped `acquireVsCodeApi` at least once. */
    acquireCalled: boolean;
    /** Messages posted through the wrapped `postMessage`, counted at the one egress. */
    outboundCount: number;
    /** Messages delivered from the extension host, counted at the one inbound listener. */
    inboundCount: number;
    /** Messages held for replay, and whether the startup exchange has been declared over. */
    buffered: number;
    bufferSealed: boolean;
    /**
     * What the read-only guarantee costs: clones made for taps and rewriter views, and the time
     * they took.
     *
     * The worst single clone is tracked by name because the distribution is heavily skewed and the
     * total alone cannot be acted on. Cost scales with payload size, not message count: a streaming
     * delta or a rename_tab envelope clones in a microsecond or two, while a list_sessions_response
     * runs hundreds of times that, in proportion to how many sessions are on disk. So a large total
     * means "a few big messages at boot" far more often than it means the tap path is hot.
     */
    tapClones: number;
    tapCloneMs: number;
    tapCloneMaxMs: number;
    tapCloneMaxType: string | null;
    /** Messages a plugin asked to be sent again — the only traffic here the app did not cause. */
    resent: number;
    readonly plugins: {
      name: string;
      status: "loaded" | "refused" | "error" | "inactive";
      reason?: string;
    }[];
    /**
     * Which plugin rewrites which field, in the order the chain applies them, and how it has fared.
     *
     * Published by post.ts, which owns the concept; declared here because this is where the
     * bridge's shape lives. `applied` against `ran` against `missed` is the whole of what the host
     * owes when a rewriter's patch does or does not land: `ran` is every time the chain reached it,
     * `applied` is every time it returned a patch that stuck, and `missed` is the boot-race count —
     * sends that went out before this rewriter had registered at all.
     */
    rewrites: {
      plugin: string;
      type: string;
      fields: string[];
      applied: number;
      ran: number;
      missed: number;
    }[];
    /**
     * What became of each declared host-bundle patch, as the injector recorded it.
     *
     * Carried rather than derived: nothing in a webview can read extension.js, so this is the one
     * diagnostic that reports what some other process did rather than what this one saw. It is
     * therefore only as current as the payload beside it — the same caveat every generated table
     * here already carries.
     */
    hostPatches: {
      plugin: string;
      why: string;
      required: boolean;
      applied: boolean;
      reason?: string;
    }[];
    /**
     * The extension version whose identifiers post.ts loaded from ./generated.js, or null before
     * post.ts has reported in.
     *
     * The payload is version-independent and the tables beside it are not, so this says which
     * extension the loader is actually checking plugins against — the question a build-time stamp
     * cannot answer, because the same payload runs against whichever version is installed.
     */
    identifiersFor: string | null;
    /**
     * What became of the React devtools hook, which decorateTranscript rests on.
     *
     * `commits` against `notified` is the whole story of the coalescing: React commits once per
     * streamed token, and a sweep per commit would rebuild the entry list thousands of times a
     * turn. A `notified` close to `commits` means the coalescing is not working.
     */
    react: {
      /** Ours, or wrapped around a hook something else had already installed. */
      hook: "installed" | "chained";
      /** react-dom's version as it reported on injecting. Null means no renderer ever did. */
      version: string | null;
      commits: number;
      notified: number;
    };
    /**
     * What decorateTranscript is seeing. Published by post.ts, which owns the concept; declared
     * here because this is where the bridge's shape lives.
     *
     * `entries` against `timed` is the health of the join: a row whose time no record has supplied
     * yet is normal for a moment and wrong if it persists, and the two numbers tell those apart
     * without anyone having to reason about which message should have carried it. `rebuilds`
     * against `sweeps` is the same ratio one level down from `commits`/`notified`.
     */
    transcript: {
      entries: number;
      timed: number;
      sweeps: number;
      rebuilds: number;
    };
    /**
     * What the mount service is doing, and the one number D52 is waiting on. `replaced` counts
     * mounts a re-render detached and the host put back; `lost` counts the ones it could not, which
     * is a real failure because the node stays out of the document and is retried forever. The 0.x
     * prototype measured zero detachments and kept its re-mount anyway on the grounds that it was
     * nearly free; if `replaced` and `lost` both stay at zero here, that machinery goes. `active` is
     * the denominator, and the scale the per-frame pass runs at.
     */
    mounts: {
      /**
       * Which signal is driving re-placement: React commits, or the observer fallback for a webview
       * no renderer injected into. Reported rather than assumed, because "observer" against the real
       * extension means the React anchors have gone and the transcript capability is empty too.
       */
      driver: "commit" | "observer";
      active: number;
      replaced: number;
      /** Mounts repositioned after their anchor moved. A rate that never settles means the host and
       * the app are each undoing the other every frame, which is the one way this can be worse than
       * the drift it fixes. */
      moved: number;
      lost: number;
      /**
       * Anchors declared to name one element whose selector has matched more than one, and the most
       * that ever matched at once (D7). Build time counts how many places the bundle *applies* a
       * class; this counts how many elements are on screen, and the two can disagree in both
       * directions — one site inside a list renders many, and a refinement that stops refining
       * shows up here and nowhere else. Empty is the expected state; a name in it is a decoration
       * that may be on the wrong control.
       */
      multiple: Record<string, number>;
      /**
       * Mounts and watches the host gave up on, `"<plugin>: <what>"` each (D54). The host takes one
       * kind of corrective action and only one; a run of them on consecutive passes that never
       * settles means something is undoing each as fast as it is done, and the host stops rather
       * than keep a panel flickering for a decoration. Empty is the expected state, and a name here
       * is the whole finding rather than a number to weigh.
       */
      abandoned: string[];
    };
    /**
     * The busiest one-second window each hot path has seen, and when (D53). Totals live beside their
     * own concepts above; this is the only place a *rate* is recorded, and the only thing that can
     * distinguish a quiet hour from a bad four seconds after the fact.
     */
    meters: Record<string, { peak: number; peakAt: number | null; recent: number }>;
    /**
     * What became of the crash-surviving ring in `localStorage`, and what the previous run left
     * there. Published by post.ts, which owns the writing; declared here because this is where the
     * bridge's shape lives.
     *
     * `available: false` is ordinary rather than alarming — storage can be disabled, full or
     * cleared, and all three must cost a diagnostic and never a panel.
     */
    storage: {
      available: boolean;
      writes: number;
      failures: number;
      bytes: number;
      lastError: string | null;
    };
    /**
     * The tail of the previous run's ring, or null when there was none to read. This is the whole
     * point of persisting anything: a window that had to be force-closed leaves no other account of
     * what the panel was doing in its last minutes.
     */
    previous: {
      from: number;
      to: number;
      entries: readonly Record<string, unknown>[];
    } | null;
    readonly errors: string[];
  };
  /**
   * The check registry, filled in by post.ts once the kernel has built it.
   *
   * Declared here and left null because this file is the bridge's shape and post.ts is the one
   * thing that writes it. Null after boot means the kernel never ran, which is worth more to a
   * reader than an empty registry that looks like a panel with nothing wrong.
   *
   * Typed loosely on purpose: what a check is belongs to post.ts, and this file shares no build
   * with it (see the note at the head of kernel/bridge.ts).
   */
  checks: { run(): unknown } | null;
  /**
   * The message plumbing post.ts drives, and the only part of this bridge it needs: taps on the
   * way in, rewrites on the way out. Buffered-and-live pub/sub keyed on the message "type" — see
   * `tap` below for what "type" means here.
   */
  readonly bus: {
    on(type: string, handler: Handler): () => void;
    /**
     * Stop putting messages in the replay buffer; keep everything already in it.
     *
     * Called once by post.ts when every plugin has had its chance to register. The replay is for
     * the startup exchange, not for the life of the panel: a panel is created with
     * retainContextWhenHidden, so it would otherwise retain every message it had ever seen,
     * including every io_message streaming delta, for as long as the window stays open.
     */
    sealBuffer(): void;
    /**
     * The outbound rewrite chain — how a plugin's rewrite reaches the one egress. post.ts owns
     * everything about whether a patch is allowed; this side owns only the order they apply in and
     * the guarantee that the app's message goes out either way.
     */
    readonly rewriters: {
      /** Register `apply` for one outbound type. Returns the removal. */
      add(type: string, apply: Rewriter): () => void;
      /**
       * Send the app's last message of `type` again, with the chain re-applied. True if one was
       * sent — false when the app has never sent that type, the real postMessage is not yet known,
       * or a chain is already running.
       */
      resend(type: string): boolean;
      /**
       * How many of `type` the app has sent so far, patched or not.
       *
       * Read once by post.ts when a rewriter registers, so the count at that instant is the number
       * of sends that went out with no chain to run — the boot race, measured instead of argued
       * about. `applied` cannot stand in for it: a rewriter that declined and one that never ran
       * both leave it at zero.
       */
      outboundSeen(type: string): number;
    };
  };
  /**
   * What React tells us, through the devtools hook installed below.
   *
   * The other half of decorateTranscript, and here rather than in post.ts for the same reason the
   * bus tap is: react-dom looks for its devtools hook when it initialises, which is during the
   * bundle body, and only a static import ahead of that body can be in place in time. post.ts — a
   * dynamic import from the tail of the same file — is already too late.
   *
   * Deliberately the mechanism and nothing more. Which elements are rows, what a fiber's props
   * mean, and when an entry list has actually changed all belong to post.ts, so that swapping this
   * mechanism for another would leave the capability's shape untouched.
   */
  readonly react: {
    /**
     * Run `handler` after React commits, at most once a frame.
     *
     * Coalesced because commits fire per streamed token. A frame is the right grain: nothing
     * downstream can be seen sooner, and in a hidden webview frames stop, which pauses the work
     * exactly while nobody is looking and resumes it on the first frame after it is shown.
     */
    onCommit(handler: () => void): () => void;
    /**
     * The fiber React associates with `element`, or null.
     *
     * React's own lookup, handed over when the renderer injected — not a scan for the
     * `__reactFiber$..` key it happens to be implemented with. Null before any renderer has
     * injected, and for an element React does not own.
     */
    fiberFor(element: Element): unknown;
    /** react-dom's version, once a renderer has injected. Null means none has, and none will. */
    rendererVersion(): string | null;
  };
  /**
   * Count one event against a named hot path's current second (D53).
   *
   * On the bridge rather than folded into each counter's own site because the counters that matter
   * are not all in this file: transcript sweeps and mount re-placements are the kernel's, and both
   * are exactly the paths a runaway re-render shows up in first. An unknown name is ignored rather
   * than registered, so the set stays the one declared here and a typo cannot invent a meter that
   * nothing reports.
   */
  meter(name: string): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __rigline: RiglineBridge | undefined;
  // eslint-disable-next-line no-var
  var acquireVsCodeApi: (() => VsCodeApi) | undefined;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

try {
  const buffer: { type: string; payload: unknown }[] = [];
  const listeners = new Map<string, Set<Handler>>();
  let sealed = false;

  /**
   * Freeze `value` and everything reachable from it.
   *
   * The isFrozen check is the cycle guard rather than an optimisation: structuredClone preserves
   * cycles, so a message that refers back to itself would recurse until the stack ran out.
   *
   * Depth is the point. A shallow Object.freeze leaves `envelope.request.title` writable, which is
   * the whole of the outbound-rewrite capability this is closing.
   */
  function deepFreeze(value: unknown): unknown {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    return value;
  }

  /**
   * A frozen deep clone of `payload` for a tap or a rewriter to read, or null if one cannot be
   * made. Timed into the tap-clone diagnostics either way.
   *
   * Cloned once for every reader of one message, so no reader can see another's view and none can
   * reach the object the app is sending. A clone that fails is fail-closed — the reader is skipped
   * and the failure recorded — because the only alternative is passing the original, which is the
   * capability being removed.
   */
  function frozenView(type: string, payload: unknown): Record<string, unknown> | null {
    const started = performance.now();
    try {
      const view = deepFreeze(structuredClone(payload)) as Record<string, unknown>;
      const elapsed = performance.now() - started;
      bridge.diagnostics.tapCloneMs += elapsed;
      bridge.diagnostics.tapClones++;
      meter("tapClone");
      if (elapsed > bridge.diagnostics.tapCloneMaxMs) {
        bridge.diagnostics.tapCloneMaxMs = elapsed;
        bridge.diagnostics.tapCloneMaxType = type;
      }
      return view;
    } catch (e) {
      bridge.diagnostics.errors.push(`clone:${type}:${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Hand `payload` to `handlers` as a frozen deep clone, or to nobody at all.
   *
   * Cloned once for all of them, so no tap can see another's view and none can reach the object the
   * app is sending. A clone that fails is fail-closed — the taps are skipped and recorded — because
   * the only alternative is passing the original, which is the capability being removed.
   */
  function deliver(type: string, payload: unknown, handlers: readonly Handler[]): void {
    const frozen = frozenView(type, payload);
    if (frozen === null) return;

    for (const handler of handlers) {
      try {
        handler(frozen);
      } catch (e) {
        bridge.diagnostics.errors.push(`bus:${type}:${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  function record(type: string, payload: unknown): void {
    if (!sealed) {
      buffer.push({ type, payload });
      bridge.diagnostics.buffered = buffer.length;
    }
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    // A copy of the set, so a handler that registers while this one is dispatching does not also
    // receive the message it is dispatching.
    deliver(type, payload, [...set]);
  }

  /**
   * Requests are wrapped ({type:"request",channelId,requestId,request:{type:".."}}), replies are
   * wrapped the same shape ({type:"response",requestId,response:{..}}), and everything else is
   * posted bare. Each envelope carries its payload under a key named after itself.
   *
   * Records the envelope under its own outer type, and the payload under the inner type as well, so
   * onMessage("request", ..) sees every request crossing the bus while onMessage("rename_tab", ..)
   * sees just those, and onMessage("list_sessions_response", ..) sees just those replies. Unwrapping
   * the reply loses the requestId that says which request it answered — the envelope is still
   * recorded under "response" for anything that needs to join the pair itself.
   *
   * io_message is deliberately not unwrapped: it carries the Anthropic streaming protocol, which is
   * a separate protocol nested inside our own, and its event names are not ours to publish as
   * message types.
   */
  function tap(message: unknown): void {
    const outer = message as {
      type?: unknown;
      request?: { type?: unknown };
      response?: { type?: unknown };
    } | null;
    if (!outer || typeof outer.type !== "string") return;
    record(outer.type, message);

    const inner =
      outer.type === "request" ? outer.request : outer.type === "response" ? outer.response : null;
    if (inner && typeof inner.type === "string") record(inner.type, inner);
  }

  const rewriters = new Map<string, Set<Rewriter>>();

  /**
   * The last message the app sent of each outbound type, before any patch.
   *
   * Kept so a plugin can ask for it to be sent again once something it depends on has changed. The
   * original is stored, not the patched result, so a resend re-runs the chain from what the app
   * said rather than compounding patches.
   */
  const lastOutbound = new Map<
    string,
    { channelId: unknown; wrapped: boolean; payload: unknown }
  >();

  /**
   * How many of each type the app has sent, counted at the one egress.
   *
   * Deliberately not derived from the replay buffer, which is the obvious place to get it from and
   * the wrong one. The buffer stops recording at sealBuffer(), so a count taken from it would be
   * right only for a rewriter that registered before the seal, and not a guarantee: ctx outlives
   * setup(), so a plugin registering from a promise or a timer would read a frozen number and
   * under-report the very window that is widest for it. The buffer also records both directions
   * under one key for an envelope type, where counting here is outbound by construction.
   *
   * Bounded by the number of distinct outbound types, not by traffic — it holds integers, which is
   * what separates it from the buffer's own unbounded-growth problem.
   */
  const outboundByType = new Map<string, number>();

  /** Set while the chain is running, so a rewriter cannot resend into its own chain forever. */
  let rewriting = false;

  /** The real postMessage, once the app has acquired the api. A resend is the only other user. */
  let realPost: ((message: unknown) => void) | null = null;

  /**
   * The message to actually post: the app's own object, or a copy carrying the chain's patches.
   *
   * Copied rather than mutated. The app built this object and may still hold it, and a host that
   * edited it in place would be doing to the app exactly what the read-only guarantee above stops
   * plugins doing. With no rewriter registered for the type — the overwhelmingly common case — the
   * original object is returned unchanged, so nothing pays for a capability nothing used.
   *
   * A request is patched inside its envelope, which is how the envelope's channelId and requestId
   * stay beyond reach: what a rewriter is handed, and what it can replace, is only ever the inner
   * payload.
   */
  function rewrite(message: unknown): unknown {
    const outer = message as Record<string, unknown> | null;
    if (!outer || typeof outer.type !== "string") return message;

    const inner = outer.request as Record<string, unknown> | undefined;
    const wrapped = outer.type === "request" && !!inner && typeof inner.type === "string";
    const target = (wrapped ? inner : outer) as Record<string, unknown>;
    const type = target.type as string;

    lastOutbound.set(type, { channelId: outer.channelId, wrapped, payload: target });
    outboundByType.set(type, (outboundByType.get(type) ?? 0) + 1);
    return applyChain(type, outer, target, wrapped) ?? message;
  }

  /**
   * Run the chain for `type` and return the message to post, or null for "unchanged".
   *
   * Split out because a resend needs exactly this and none of the recording above: replaying a
   * message must not overwrite the record of what the app last said with a copy of itself.
   */
  function applyChain(
    type: string,
    outer: Record<string, unknown>,
    target: Record<string, unknown>,
    wrapped: boolean,
  ): unknown {
    const chain = rewriters.get(type);
    if (!chain || chain.size === 0) return null;

    const wasRewriting = rewriting;
    rewriting = true;
    let patched: Record<string, unknown> | null = null;
    try {
      for (const apply of [...chain]) {
        const view = frozenView(type, patched ?? target);
        if (!view) continue;
        let patch: Record<string, unknown> | null = null;
        try {
          patch = apply(view);
        } catch (e) {
          // post.ts is meant to have caught this already; this is the file that may never throw.
          bridge.diagnostics.errors.push(
            `rewrite:${type}:${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (patch) patched = { ...(patched ?? target), ...patch };
      }
    } finally {
      rewriting = wasRewriting;
    }
    if (!patched) return null;
    return wrapped ? { ...outer, request: patched } : patched;
  }

  /**
   * The hot paths that carry a rate as well as a total (D53).
   *
   * A cumulative counter cannot be read. `sweeps: 44120` is an hour of ordinary work and four
   * seconds of pathology written identically, and telling those apart is the entire question when a
   * panel has gone wrong. So each of these keeps the busiest one-second window it has ever seen, and
   * when that was, beside the totals that already exist.
   */
  const METERS = [
    "outbound",
    "inbound",
    "tapClone",
    "resend",
    "commit",
    "notify",
    "sweep",
    "rebuild",
    "replace",
    "move",
    // Watches re-anchored: the element a watch was bound to swapped for another. The third
    // corrective action the mount service takes, and the one neither `replace` nor `move` can
    // see, because it tears one mount down and attaches another rather than repositioning a node
    // (D54). A watch fighting the app's own layout shows up here and in no other number.
    "rebind",
  ] as const;

  const meters = {} as Record<string, { peak: number; peakAt: number | null; recent: number }>;
  const windows = {} as Record<string, { start: number; count: number }>;
  for (const name of METERS) {
    meters[name] = { peak: 0, peakAt: null, recent: 0 };
    windows[name] = { start: Date.now(), count: 0 };
  }

  /**
   * Count one event against `name`'s current second.
   *
   * The peak is raised as the window fills rather than when it closes, which is not a detail. A
   * burst of five thousand inside one second followed by silence never closes its window — nothing
   * arrives to close it — so a peak recorded only on close would miss precisely the event this
   * exists to catch, and report zero. `recent` is the last *closed* window, which is the honest
   * number for "what is it doing now" and is meaningless mid-window.
   *
   * `Date.now()` rather than `performance.now()` because a peak is only useful if it can be lined up
   * against VS Code's own logs, which are wall-clock. Roughly twenty nanoseconds a call, against
   * paths that already clone a payload or touch the DOM.
   */
  function meter(name: string): void {
    const m = meters[name];
    const w = windows[name];
    if (!m || !w) return;
    const now = Date.now();
    if (now - w.start >= 1000) {
      m.recent = w.count;
      w.start = now;
      w.count = 0;
    }
    w.count += 1;
    if (w.count > m.peak) {
      m.peak = w.count;
      m.peakAt = w.start;
    }
  }

  /**
   * The global react-dom looks for when it initialises.
   *
   * Spelled literally because this file runs before anything could load a generated table, and
   * held to the bundle by the React identifier layer, which asserts the same string on every
   * harvest and fails the build if it moves. Without that assertion a rename upstream would leave a
   * hook nothing ever calls, and the only symptom would be a capability that resolves no rows.
   */
  const DEVTOOLS_HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";

  const commitHandlers = new Set<() => void>();
  let commitScheduled = false;
  let findFiber: ((element: Element) => unknown) | null = null;
  let rendererVersion: string | null = null;
  let nextRendererId = 1;

  /** Run the commit handlers once, on the next frame, however many commits arrive before it. */
  function scheduleCommitNotice(): void {
    if (commitScheduled || commitHandlers.size === 0) return;
    commitScheduled = true;
    const fire = (): void => {
      commitScheduled = false;
      bridge.diagnostics.react.notified++;
      meter("notify");
      // A copy: a handler may unsubscribe itself, which is what a plugin being disabled does.
      for (const handler of [...commitHandlers]) {
        try {
          handler();
        } catch (e) {
          bridge.diagnostics.errors.push(`commit:${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fire);
    else setTimeout(fire, 16);
  }

  /**
   * Keep what the renderer handed over: its version, and its element-to-fiber lookup.
   *
   * Everything else in the internals object is devtools' business. Taking the lookup from here
   * rather than reading the `__reactFiber$..` key ourselves is the point of using the hook at all —
   * that key's suffix is randomised per load, and React already has a function for it.
   */
  function noteInjection(internals: unknown): void {
    const renderer = internals as { version?: unknown; findFiberByHostInstance?: unknown } | null;
    if (!renderer || typeof renderer !== "object") return;
    if (typeof renderer.version === "string") {
      rendererVersion = renderer.version;
      bridge.diagnostics.react.version = renderer.version;
    }
    if (typeof renderer.findFiberByHostInstance === "function") {
      findFiber = renderer.findFiberByHostInstance as (element: Element) => unknown;
    }
  }

  const bridge: RiglineBridge = {
    diagnostics: {
      version: "rigline-1",
      preAt: Math.round(performance.now()),
      postAt: null,
      rootChildrenAtPre: document.querySelector("#root")?.childElementCount ?? -1,
      rootChildrenAtPost: null,
      acquireWrapped: false,
      acquireCalled: false,
      outboundCount: 0,
      inboundCount: 0,
      buffered: 0,
      bufferSealed: false,
      tapClones: 0,
      tapCloneMs: 0,
      tapCloneMaxMs: 0,
      tapCloneMaxType: null,
      resent: 0,
      plugins: [],
      rewrites: [],
      hostPatches: [],
      identifiersFor: null,
      react: { hook: "installed", version: null, commits: 0, notified: 0 },
      transcript: { entries: 0, timed: 0, sweeps: 0, rebuilds: 0 },
      mounts: {
        driver: "commit",
        active: 0,
        replaced: 0,
        moved: 0,
        lost: 0,
        multiple: {},
        abandoned: [],
      },
      meters,
      storage: { available: false, writes: 0, failures: 0, bytes: 0, lastError: null },
      previous: null,
      errors: [],
    },
    checks: null,
    bus: {
      on(type, handler) {
        // The buffered payloads are the app's own objects, so replay clones and freezes here rather
        // than at record time: gating the cost on a listener existing is only sound if nothing
        // safe has to be kept for a listener that does not exist yet.
        for (const entry of buffer)
          if (entry.type === type) deliver(type, entry.payload, [handler]);
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(handler);
        return () => set.delete(handler);
      },
      sealBuffer() {
        sealed = true;
        bridge.diagnostics.bufferSealed = true;
      },
      rewriters: {
        add(type, apply) {
          let set = rewriters.get(type);
          if (!set) {
            set = new Set();
            rewriters.set(type, set);
          }
          set.add(apply);
          return () => set.delete(apply);
        },
        resend(type) {
          const last = lastOutbound.get(type);
          if (!last || !realPost) return false;
          // A rewriter resending its own type would re-enter the chain and never come back. The
          // guard is here rather than trusted to plugin authors, because the failure is a hung
          // webview rather than a disabled plugin.
          if (rewriting) {
            bridge.diagnostics.errors.push(`resend:${type}:refused while the chain is running`);
            return false;
          }

          // A fresh requestId, never the original: the app's own outstanding-request map has long
          // since resolved and deleted that one, and reusing it would be claiming to be a reply to
          // something. The app answers an unknown id with a console warning that no handler
          // matched, and drops it, so this reaches the host and disturbs nothing.
          const envelope = last.wrapped
            ? {
                type: "request",
                channelId: last.channelId,
                requestId: Math.random().toString(36).slice(2),
                request: last.payload,
              }
            : (last.payload as Record<string, unknown>);
          const patched = applyChain(
            type,
            envelope as Record<string, unknown>,
            last.payload as Record<string, unknown>,
            last.wrapped,
          );

          bridge.diagnostics.resent++;
          meter("resend");
          // Deliberately not tapped: a reader reports what the app said, and this is the plugin
          // layer speaking. diagnostics.resent is where it shows up instead.
          realPost(patched ?? envelope);
          return true;
        },
        outboundSeen(type) {
          return outboundByType.get(type) ?? 0;
        },
      },
    },
    react: {
      onCommit(handler) {
        commitHandlers.add(handler);
        return () => void commitHandlers.delete(handler);
      },
      fiberFor(element) {
        if (!findFiber) return null;
        try {
          return findFiber(element) ?? null;
        } catch (e) {
          bridge.diagnostics.errors.push(`fiber:${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      },
      rendererVersion() {
        return rendererVersion;
      },
    },
    meter,
  };
  globalThis.__rigline = bridge;

  /**
   * Install the devtools hook, or wrap one that is already there.
   *
   * react-dom's contract is small and entirely defensive: it reads the global, checks
   * `isDisabled && supportsFiber`, and calls `inject(internals)` inside a try/catch — then every
   * `onCommitFiberRoot` call is inside a try/catch of its own. So nothing here can take the app
   * down, which is what makes a boot-time global acceptable in the one file that may never throw.
   *
   * Chaining rather than replacing, because overwriting a hook that was already installed would
   * disconnect whatever installed it — React DevTools attached to the webview, most plausibly — and
   * it would look like a devtools bug rather than ours.
   *
   * `onCommitFiberUnmount` is deliberately not provided. React guards on its presence and calls it
   * once per deleted fiber, so offering a no-op buys a hot call for nothing: a deletion is part of a
   * commit, and the commit is already reported.
   */
  const hostWindow = globalThis as unknown as Record<string, unknown>;
  const existing = hostWindow[DEVTOOLS_HOOK];
  if (existing && typeof existing === "object") {
    const hook = existing as Record<string, unknown>;
    const realInject = hook.inject;
    hook.inject = function (this: unknown, internals: unknown): unknown {
      noteInjection(internals);
      return typeof realInject === "function"
        ? (realInject as (i: unknown) => unknown).call(this, internals)
        : nextRendererId++;
    };
    const realCommit = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function (this: unknown, ...args: unknown[]): unknown {
      bridge.diagnostics.react.commits++;
      meter("commit");
      scheduleCommitNotice();
      return typeof realCommit === "function"
        ? (realCommit as (...a: unknown[]) => unknown).apply(this, args)
        : undefined;
    };
    bridge.diagnostics.react.hook = "chained";
  } else {
    hostWindow[DEVTOOLS_HOOK] = {
      // The three react-dom actually reads. renderers is not one of them, and is here because a
      // devtools build that attached later would expect to find it.
      isDisabled: false,
      supportsFiber: true,
      renderers: new Map<number, unknown>(),
      inject(internals: unknown): number {
        noteInjection(internals);
        const id = nextRendererId++;
        (hostWindow[DEVTOOLS_HOOK] as { renderers: Map<number, unknown> }).renderers.set(
          id,
          internals,
        );
        return id;
      },
      onCommitFiberRoot(): void {
        bridge.diagnostics.react.commits++;
        meter("commit");
        scheduleCommitNotice();
      },
      // Called by react-dom at module load to check the build was dead-code-eliminated. It only
      // needs to exist; devtools uses it to warn about a development build.
      checkDCE(): void {},
    };
    bridge.diagnostics.react.hook = "installed";
  }

  const real = globalThis.acquireVsCodeApi;
  if (typeof real === "function") {
    let cached: VsCodeApi | null = null;
    globalThis.acquireVsCodeApi = function (this: unknown): VsCodeApi {
      bridge.diagnostics.acquireCalled = true;
      if (cached) return cached;
      const inner = real.call(this);
      realPost = (message: unknown) => inner.postMessage(message);
      cached = {
        postMessage(message: unknown) {
          bridge.diagnostics.outboundCount++;
          meter("outbound");
          // Taps first, and against the app's own message: a reader reports what the app said, not
          // what another plugin made of it. Only the chain sees the accumulated value.
          tap(message);
          return inner.postMessage(rewrite(message));
        },
        getState: inner.getState.bind(inner),
        setState: inner.setState.bind(inner),
      };
      return cached;
    };
    bridge.diagnostics.acquireWrapped = true;
  }

  globalThis.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown; message?: unknown } | null;
    if (data?.type !== "from-extension") return;
    bridge.diagnostics.inboundCount++;
    meter("inbound");
    tap(data.message);
  });
} catch {
  // Unreachable today, and kept so that the guarantee above is structural rather than a comment.
}
