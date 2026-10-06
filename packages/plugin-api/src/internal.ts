/**
 * `@rigline/plugin-api/internal`: the root, and everything host and core share besides, so that a
 * rule checked in Node and a rule checked in the webview cannot drift apart. Not what a plugin is
 * written against, and not kept within 1.x (D108).
 */

export type { AnchorSpec } from "./anchors.ts";
export { ANCHORS } from "./anchors.ts";
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
  undeclaredUse,
  unusedDeclaration,
} from "./capabilities/index.ts";
export type { AnchorSlot, ElementSpec, Elements, Placement, ZoneSpec } from "./elements.ts";
export {
  ELEMENT_ID_PATTERN,
  elementGaps,
  placementGap,
  placementLabel,
  RIGLINE,
  RIGLINE_ELEMENTS,
  SLOT_POSITIONS,
  samePlacement,
  ZONE_NAMES,
  ZONES,
} from "./elements.ts";
export * from "./index.ts";
export type {
  ElementPlace,
  Layout,
  LayoutPlugin,
  ViewElement,
  ViewPlace,
} from "./layout.ts";
export {
  compactRows,
  describeElements,
  elementRank,
  layoutCommands,
  layoutProblems,
  layoutView,
  nextRow,
  OFF,
  offers,
  parsePlace,
  placeElement,
  placeForms,
  placeName,
  placeTitle,
  rowOf,
  rowPlace,
  sameLayout,
  withElementAt,
  withOrder,
  withRigline,
} from "./layout.ts";
export type { ValidManifest } from "./manifest.ts";
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
export { PENDING_TOOL_LIMIT, toolResults, toolUses } from "./stream.ts";
export type { StylesheetNames } from "./stylesheet.ts";
export { stylesheetNames } from "./stylesheet.ts";
export type { IdentifierTables, ReactGap } from "./tables.ts";
export type { FiberLike } from "./transcript.ts";
export { entriesDiffer, messageTimes, rowIdentity } from "./transcript.ts";
export type { ContextAnswer, ContextReading, MessageTokens, ModelWindow } from "./usage.ts";
export {
  contextAnswer,
  contextReading,
  formulaLimit,
  ioChannel,
  mergeTokens,
  UNKNOWN_USAGE,
} from "./usage.ts";
