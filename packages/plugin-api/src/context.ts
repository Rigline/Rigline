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
import type { MessageType, ModuleClasses, ModuleId, OutboundFields } from "./generated.ts";
import type { ToolUse } from "./stream.ts";
import type { TranscriptEntry } from "./transcript.ts";

/** Undo whatever a registration did. Returned by everything that adds a listener or DOM. */
export type Teardown = () => void;

/** An outbound message type whose payload fields are known, and so may be rewritten. */
export type RewritableType = keyof OutboundFields;

/** The fields of `T` a plugin may replace: whatever its manifest declared, at most. */
export type RewritePatch<T extends RewritableType> = Partial<Record<OutboundFields[T], unknown>>;

/**
 * A payload as a tap or a rewriter sees it: frozen, and typed loosely. The harvest knows field
 * names, not value types, so a plugin narrows what it reads.
 */
export type Payload = Readonly<Record<string, unknown>>;

export interface PluginContext {
  /** Which webview surface this is. The full editor is the one with no distinguishing global. */
  readonly surface: Surface;

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
   * `data-prototype-mount`. Requires `uses.mount`.
   */
  mount(target: Element, build: () => Element): Teardown;

  /**
   * As `mount`, but straight after `sibling`. The placement a decoration usually wants: inside the
   * decorated element it inherits that element's click handling and accessible name. Requires
   * `uses.mount`.
   */
  mountAfter(sibling: Element, build: () => Element): Teardown;

  /**
   * Be told when an element for `name` is in the document, and again whenever the one last handed
   * over leaves and another appears. `onFound` may return a teardown, run before the next call and
   * on the plugin's own teardown. No plugin polls for an element. Requires `uses.mount` and the
   * anchor under `uses.anchors`.
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
   */
  onToolUse(handler: (tool: ToolUse) => void): Teardown;

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
}

/** The default export of a plugin's entry module. */
export interface PrototypePlugin {
  // biome-ignore lint/suspicious/noConfusingVoidType: a plugin with nothing to tear down simply returns; `undefined` would force an explicit return
  setup(ctx: PluginContext): void | Teardown;
}

/** Identity with a type: `export default definePlugin({ setup(ctx) { ... } })`. */
export function definePlugin(plugin: PrototypePlugin): PrototypePlugin {
  return plugin;
}
