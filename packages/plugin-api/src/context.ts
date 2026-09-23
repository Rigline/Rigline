/// <reference lib="dom" />
/**
 * The context a plugin is handed: what it can do, scoped to what its manifest declared.
 *
 * The lib reference above travels into the emitted declarations, so a Node consumer of this
 * package (core, the CLI) can type-check against `Element` without a DOM lib of its own.
 *
 * Built fresh per plugin by the host's kernel from the capability modules, so a declaration is
 * enforced rather than trusted: a method the manifest did not grant throws when called, and the
 * host catches that at the plugin's boundary and disables just that plugin. A plugin never
 * imports the host; a module singleton would defeat both the scoping and the attribution.
 */
import type { AnchorName, Surface } from "./anchors.ts";
import type { CheckVerdict } from "./checks.ts";
import type { MessageType, ModuleClasses, ModuleId, OutboundFields } from "./identifiers.ts";
import type { ToolResult, ToolUse } from "./stream.ts";
import type { TranscriptEntry } from "./transcript.ts";

/** Undo whatever a registration did. Returned by everything that adds a listener or DOM. */
export type Teardown = () => void;

/**
 * A React function component taking no props. Typed without React's own types, so that this
 * package's root never needs them (D87); anything React can render is a fine return value.
 */
export type MenuComponent = () => unknown;

/** An outbound message type whose payload fields are known, and so may be rewritten. */
export type RewritableType = keyof OutboundFields;

/** The fields of `T` a plugin may replace: whatever its manifest declared, at most. */
export type RewritePatch<T extends RewritableType> = Partial<Record<OutboundFields[T], unknown>>;

/**
 * A payload as a tap or a rewriter sees it: frozen, and typed loosely. The harvest knows field
 * names, not value types, so a plugin narrows what it reads.
 */
export type Payload = Readonly<Record<string, unknown>>;

/**
 * The lookups whose answer may legitimately be "not in this extension" (D41).
 *
 * Two methods, not one function typed from the manifest. Making `ctx` generic over a
 * `const`-asserted import of the plugin's own `rigline.json` does work, and is rejected: it makes
 * the entry module compile-depend on its manifest through import attributes, it is fragile across
 * a stranger's tsconfig, and it buys a keystroke. Keeping the optional lookups on their own object
 * leaves the load-bearing dependencies legible in the source — what a plugin hard-depends on is
 * what it calls without `.optional` — and for code that runs in the app's realm with full DOM
 * access, reviewable beats terse.
 *
 * An identifier declared required may also be read through here. It simply never returns null, and
 * refusing the call would be a rule with no failure behind it.
 */
export interface OptionalContext {
  /**
   * The class an anchor resolves to, or null when this extension has not got it. Requires the name
   * under `uses.optional.anchors` (or `uses.anchors`).
   */
  anchor(name: AnchorName): string | null;

  /**
   * A raw module-scoped class, or null when this extension has not got it. Requires the pair under
   * `uses.optional.classes` (or `uses.classes`). Prefer `optional.anchor()`.
   */
  cls<M extends ModuleId>(module: M, local: ModuleClasses[M]): string | null;
}

export interface PluginContext {
  /** Which webview surface this is. The full editor is the one with no distinguishing global. */
  readonly surface: Surface;

  /**
   * The lookups that may come back null, for identifiers declared under `uses.optional`. Everything
   * else optional needs no API: an undelivered message, an un-fired rewrite and a switch whose
   * handler never runs are already what absence does, and the declaration only stops them refusing
   * the plugin.
   */
  readonly optional: OptionalContext;

  /**
   * Contribute a line to the diagnostics panel, under this plugin's name. Declares nothing.
   *
   * `run` is called by the host whenever the panel is read — about once a second, for the life of
   * the window — and must answer from state this plugin already keeps. **A check reads; it does not
   * compute.** Walking the DOM or re-deriving an answer here is work done every second whether or
   * not anyone is looking; do that work where it already happens and have the check read the
   * result.
   *
   * Nothing is handed in, because nothing needs to be: your own bookkeeping is in scope, and so is
   * your own `ctx`, so a check that asks whether your anchor still resolves calls `ctx.anchor()`
   * inside the closure and stays scoped to what you declared.
   *
   * A check that throws, or returns something that is not a verdict, is reported as a failing line
   * naming this plugin. It does not disable the plugin: a broken sentence about a feature is not
   * evidence against the feature.
   *
   * `n/a` is the answer for a check that cannot apply yet or here — a surface with no transcript, a
   * session that has not started. Say why in the detail; a reader learns more from "waiting for a
   * session" than from a green line that means the same thing.
   */
  check(name: string, run: () => CheckVerdict): Teardown;

  /**
   * The class an anchor resolves to in the installed extension, e.g. `anchor("modelPill")` gives
   * `"modelPill_gGYT1w"`. Requires the name under `uses.anchors`.
   */
  anchor(name: AnchorName): string;

  /**
   * Resolve a raw module-scoped class, e.g. `cls("gGYT1w", "modelPill")`. The second argument is
   * narrowed to the classes that module defines, so a right-name-wrong-module pair does not
   * compile. Requires the pair under `uses.classes`. Prefer `anchor()`.
   */
  cls<M extends ModuleId>(module: M, local: ModuleClasses[M]): string;

  /**
   * Tap a message type in either direction. Messages buffered from boot are replayed, so a plugin
   * registering late still sees the startup exchange. A wrapped request or reply is delivered
   * unwrapped under its inner type; `onMessage("request")` and `onMessage("response")` see the
   * envelopes. The payload is a frozen deep clone. Requires the type under `uses.messages`.
   */
  onMessage(type: MessageType, handler: (payload: Payload) => void): Teardown;

  /**
   * Keep `build()`'s result inside `target`, re-placing it if a re-render removes it. Mounts from
   * several plugins on one target appear in registry order, and every host-placed node is stamped
   * `data-rigline-mount`. Requires `uses.mount`.
   *
   * `build()` runs once. A re-render that detaches the node does not destroy it, so the host puts
   * the same node back with its listeners and whatever state was hung on it intact, and a reference
   * a plugin keeps to it stays good for the life of the mount. What does end a mount is the anchor
   * itself leaving the document, which is `watch`'s question rather than this one's.
   */
  mount(target: Element, build: () => Element): Teardown;

  /**
   * As `mount`, but straight after `sibling`, and with the same once-only `build()`. The placement a
   * decoration usually wants: inside the decorated element it would inherit that element's click
   * handling and accessible name. Requires `uses.mount`.
   */
  mountAfter(sibling: Element, build: () => Element): Teardown;

  /**
   * As `mountAfter`, but straight before `sibling`. Requires `uses.mount`.
   *
   * The placement for the end of a run of elements, where the thing you want to be last in is a
   * container you must not append to. The composer footer is the case: it measures its element
   * children, so a decoration belongs beside the spacer that divides its two clusters rather than
   * appended after the send button, and `mountAfter` cannot say that because nothing unconditional
   * sits immediately before the spacer (D54).
   */
  mountBefore(sibling: Element, build: () => Element): Teardown;

  /**
   * Be told when an element for `name` is in the document, and again whenever the one last handed
   * over leaves and another appears. `onFound` may return a teardown, run before the next call and
   * on the plugin's own teardown. No plugin polls for an element. Requires `uses.mount` and the
   * anchor under `uses.anchors` or `uses.optional.anchors`.
   *
   * The one place an optional declaration needed more than a nullable lookup: this takes a name and
   * not a class, so an optional anchor would otherwise be resolvable and unwatchable. An anchor
   * declared optional that this extension has not got watches nothing and tears down cleanly, which
   * is the same answer every other optional dependency gives.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: a callback with nothing to tear down simply returns; `undefined` would force an explicit return
  watch(name: AnchorName, onFound: (element: Element) => Teardown | void): Teardown;

  /**
   * Add a stylesheet, removed on teardown. Scope every selector to something this plugin placed
   * or resolved; the host does not check what a rule does to the app's layout. Requires
   * `uses.style`.
   */
  style(css: string): Teardown;

  /**
   * Change an outbound message on its way to the extension host. `transform` is handed the payload
   * frozen, with earlier plugins' patches applied, and returns the fields to replace or nothing.
   * A patch may only name declared fields, may only replace a field the message carries, and must
   * keep the field's `typeof`; breaking any of these disables the plugin and the app's message
   * goes unmodified. Synchronous, and not replayed. Requires the fields under `uses.rewrites`.
   */
  rewrite<T extends RewritableType>(
    type: T,
    transform: (payload: Payload) => RewritePatch<T> | null | undefined,
  ): Teardown;

  /**
   * Send the app's last message of `type` again with the rewrite chain re-applied, so a patch
   * lands now rather than when the app next happens to send. The host mints a fresh request id.
   * False when the app has not sent that type, or from inside a rewrite. Requires a declared
   * rewrite of the type.
   */
  resend(type: RewritableType): boolean;

  /**
   * Every completed tool call the assistant makes, on every channel this webview shows. Names are
   * matched, never checked. Not replayed and not durable. Requires `uses.tools`.
   *
   * This is what was *asked for*. A call the user declined, or that failed, arrives here looking
   * exactly like one that worked, so anything that acts on the world rather than merely observing
   * it wants `onToolResult` instead.
   */
  onToolUse(handler: (tool: ToolUse) => void): Teardown;

  /**
   * Every tool call's outcome, joined back to the call it answers, so the handler gets the tool's
   * name and arguments alongside whether it worked (D51). A call still running produces nothing;
   * a declined permission produces `ok: false`. Requires `uses.tools`, the same declaration
   * `onToolUse` needs, because it is a second reading of one stream and not a second dependency.
   */
  onToolResult(handler: (result: ToolResult) => void): Teardown;

  /**
   * The session this panel is hosting: called at once with the current id, null if none, and
   * again on every change. Host-derived through the farewell rule. Requires `uses.session`.
   */
  onSessionId(handler: (sessionId: string | null) => void): Teardown;

  /**
   * Draw on every transcript entry. `build` runs once per entry whenever the entry list changes
   * and returns a node to mount inside that row, or null. `at` is null until a record has said
   * when the entry happened; there is no fallback. Requires `uses.transcript`.
   */
  decorateTranscript(
    build: (entry: TranscriptEntry, entries: readonly TranscriptEntry[]) => Element | null,
  ): Teardown;

  /**
   * Add `component` to Rigline's menu, the pop-over behind the RIG pill. It renders there while the
   * menu is open, after earlier plugins' contributions, inside an error boundary of its own: a throw
   * while rendering disables this plugin and leaves the menu to everybody else. State it shares with
   * anything outside the menu belongs in a store made in `setup`. Requires `uses.menu`.
   */
  menu(component: MenuComponent): Teardown;
}

/** The default export of a plugin's entry module. */
export interface RiglinePlugin {
  // biome-ignore lint/suspicious/noConfusingVoidType: a plugin with nothing to tear down simply returns; `undefined` would force an explicit return
  setup(ctx: PluginContext): void | Teardown;
}

/** Identity with a type: `export default definePlugin({ setup(ctx) { ... } })`. */
export function definePlugin(plugin: RiglinePlugin): RiglinePlugin {
  return plugin;
}
