/**
 * @rigline/plugin-api: what a Rigline plugin is written against.
 *
 * A plugin ships a rigline.json manifest and one browser-target ES module whose default export
 * has setup(ctx). This package holds the PluginContext type, the manifest type and schema, the
 * identifier unions generated from the installed extension, the curated anchor table, and the
 * pure helpers the host and core share so that a rule checked in Node and a rule checked in the
 * webview cannot drift apart.
 */

export const API_VERSION = 1 as const;

export type { AnchorName, AnchorSpec, Surface } from "./anchors.ts";
export { ANCHOR_NAMES, ANCHORS } from "./anchors.ts";
export type { CapabilityContract, Uses, UsesKey } from "./capabilities/index.ts";
export {
  CONTRACTS,
  capabilityDrift,
  capabilityUse,
  capabilityViolation,
  patchViolation,
  permissionSummary,
  sharedFields,
} from "./capabilities/index.ts";
export type {
  Payload,
  PluginContext,
  RewritableType,
  RewritePatch,
  RiglinePlugin,
  Teardown,
} from "./context.ts";
export { definePlugin } from "./context.ts";
export type {
  InboundPush,
  InboundRequest,
  InboundResponse,
  MessageType,
  ModuleClasses,
  ModuleId,
  OutboundFields,
  OutboundNotification,
  OutboundRequest,
} from "./generated.ts";
export {
  EXTENSION_VERSION,
  PARTIAL_FIELD_TYPES,
  TABLES,
  UNREACHABLE_CSS_MODULES,
} from "./generated.ts";
export type { HostPatch, Manifest, ValidManifest } from "./manifest.ts";
export {
  byteLength,
  EMPTY_USES,
  patchShapeProblem,
  SURFACES,
  validateManifest,
} from "./manifest.ts";
export { nextSessionId } from "./session.ts";
export type { ToolUse } from "./stream.ts";
export { toolUses } from "./stream.ts";
export type { IdentifierTables } from "./tables.ts";
export type { FiberLike, MessageTime, TranscriptEntry } from "./transcript.ts";
export { entriesDiffer, messageTimes, rowIdentity } from "./transcript.ts";
