/**
 * @rigline/plugin-api: what a Rigline plugin is written against.
 *
 * A plugin ships a rigline.json manifest and one browser-target ES module whose default export
 * has setup(ctx). This package holds the PluginContext type, the manifest type and schema, the
 * curated anchor table, and the pure helpers the host and core share so that a rule checked in
 * Node and a rule checked in the webview cannot drift apart.
 *
 * What it deliberately does not hold is a single identifier harvested from the extension (D40).
 * The four types over that vocabulary are declared here as lookups into an empty interface, and
 * widen to `string` until the author's own `rigline codegen` output augments it.
 */

export const API_VERSION = 1 as const;

export type { AnchorName, AnchorSpec, Surface } from "./anchors.ts";
export { ANCHOR_NAMES, ANCHORS } from "./anchors.ts";
export type { CapabilityContract, Declarations, Uses, UsesKey } from "./capabilities/index.ts";
export {
  CONTRACTS,
  capabilityDrift,
  capabilityUse,
  capabilityViolation,
  describeUses,
  optionalGaps,
  patchViolation,
  sharedFields,
} from "./capabilities/index.ts";
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
export type {
  AnchorSlot,
  DeclaredElement,
  DeclaredPlacement,
  ElementSpec,
  Elements,
  Placement,
  SlotPosition,
  ZoneName,
  ZoneSpec,
} from "./elements.ts";
export {
  ELEMENT_ID_PATTERN,
  elementGaps,
  placementGap,
  placementLabel,
  SLOT_POSITIONS,
  samePlacement,
  ZONE_NAMES,
  ZONES,
} from "./elements.ts";
export type {
  MessageType,
  ModuleClasses,
  ModuleId,
  OutboundFields,
  RiglineIdentifiers,
} from "./identifiers.ts";
export type {
  ElementPlace,
  Layout,
  LayoutPlugin,
  ViewElement,
  ViewPlace,
} from "./layout.ts";
export {
  describeElements,
  elementRank,
  layoutCommands,
  layoutProblems,
  layoutView,
  OFF,
  parsePlace,
  placeElement,
  placeName,
  placeTitle,
  sameLayout,
  withElementAt,
  withOrder,
} from "./layout.ts";
export type { DeclaredUses, HostPatch, Manifest, ValidManifest } from "./manifest.ts";
export {
  byteLength,
  EMPTY_DECLARATIONS,
  EMPTY_USES,
  NAME_PATTERN,
  patchShapeProblem,
  SURFACES,
  validateManifest,
} from "./manifest.ts";
export type { RuntimeSpecifier } from "./runtime.ts";
export { isRuntimeSpecifier, RUNTIME_MODULES } from "./runtime.ts";
export type { SavePayload, SaveRecord } from "./save.ts";
export {
  decodeSavePayload,
  encodeSavePayload,
  MAX_SAVE_PAYLOAD,
  SAVE_PAYLOAD_VERSION,
} from "./save.ts";
export { manifestSchema, manifestSchemaJson } from "./schema.ts";
export { nextSessionId } from "./session.ts";
export type { Store } from "./store.ts";
export { store, storeFrom } from "./store.ts";
export type { ToolResult, ToolUse } from "./stream.ts";
export { PENDING_TOOL_LIMIT, toolResults, toolUses } from "./stream.ts";
export type { IdentifierTables } from "./tables.ts";
export type { FiberLike, MessageTime, TranscriptEntry } from "./transcript.ts";
export { entriesDiffer, messageTimes, rowIdentity } from "./transcript.ts";
