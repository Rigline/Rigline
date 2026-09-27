/**
 * @rigline/plugin-api: what a Rigline plugin is written against.
 *
 * A plugin ships a rigline.json manifest and one browser-target ES module whose default export
 * has setup(ctx). This root holds the context and what it hands out, the manifest as an author
 * writes it, and the anchor and identifier vocabulary, and it is what 1.x keeps (stability.md).
 * What host and core share is `@rigline/plugin-api/internal`, which is not kept (D108).
 *
 * What it deliberately does not hold is a single identifier harvested from the extension (D40).
 * The four types over that vocabulary are declared here as lookups into an empty interface, and
 * widen to `string` until the author's own `rigline codegen` output augments it.
 */

export const API_VERSION = 1 as const;

export type { AnchorName, Surface } from "./anchors.ts";
export { ANCHOR_NAMES } from "./anchors.ts";
export type { CheckVerdict, Verdict } from "./checks.ts";
export type {
  ElementComponent,
  MenuComponent,
  OptionalContext,
  Payload,
  PluginContext,
  RewritableType,
  RewritePatch,
  RiglinePlugin,
  Teardown,
} from "./context.ts";
export { definePlugin } from "./context.ts";
export type { DeclaredElement, DeclaredPlacement, SlotPosition, ZoneName } from "./elements.ts";
export type {
  MessageType,
  ModuleClasses,
  ModuleId,
  OutboundFields,
  RiglineIdentifiers,
} from "./identifiers.ts";
export type { DeclaredUses, HostPatch, Manifest } from "./manifest.ts";
export type { Store } from "./store.ts";
export { store, storeFrom } from "./store.ts";
export type { ToolResult, ToolUse } from "./stream.ts";
export type { MessageTime, TranscriptEntry } from "./transcript.ts";
