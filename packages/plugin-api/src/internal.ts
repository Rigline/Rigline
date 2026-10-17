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
export type { CostReading } from "./cost.ts";
export { AUTH_TYPES, authStatusOf, costReading, meteredOf, UNKNOWN_COST } from "./cost.ts";
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
export type { ElementPlace, Layout, LayoutPlugin, Side, ViewElement, ViewPlace } from "./layout.ts";
export {
  compactRows,
  describeElements,
  elementRank,
  layoutCommands,
  layoutProblems,
  layoutView,
  MAX_LAYOUT_ENTRIES,
  MAX_NAME,
  OFF,
  offers,
  parsePlace,
  placeElement,
  placeForms,
  placeName,
  placeTitle,
  plainText,
  pluginsNamed,
  rowNumbers,
  rowOf,
  rowPlace,
  SIDES,
  sameLayout,
  withElementAt,
  withOrder,
  withRigline,
} from "./layout.ts";
export type { RawWindow, RawWindows } from "./limits.ts";
export {
  identityChanged,
  identityOf,
  limitsAt,
  mergeWindows,
  nextReset,
  UNKNOWN_LIMITS,
} from "./limits.ts";
export type {
  AppliedChoice,
  ChoiceResult,
  ClaudeConfig,
  DefaultChoice,
  ModelChoice,
  ModelEntry,
  ModelSettings,
  ModelState,
  RequireChoice,
  ResolvedDefault,
} from "./models.ts";
export {
  choiceOf,
  choiceProblem,
  choiceRequired,
  choosesModel,
  comboLabel,
  DEFAULT_EFFORT_LEVELS,
  findModel,
  isDefaultLive,
  isLive,
  modelLabel,
  modelStateOf,
  modelsOf,
  NO_MODEL_SETTINGS,
  NO_MODEL_STATE,
  readModelSettings,
  REQUIRE_CHOICE,
  resolvedDefault,
  sameModelState,
  supportsEffort,
  unavailableOf,
} from "./models.ts";
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
export type { BakedPreset } from "./preset.ts";
export { isApplicable, MAX_BAKED_PRESET_BYTES, MAX_BAKED_PRESETS } from "./preset.ts";
export type { RuntimeSpecifier } from "./runtime.ts";
export { isRuntimeSpecifier, RUNTIME_MODULES } from "./runtime.ts";
export type {
  RiglineSave,
  RiglineSettings,
  SavePayload,
  SaveRecord,
  SettingsPayload,
  SettingsSave,
} from "./save.ts";
export { COMPANION } from "./save.ts";
export {
  decodeSavePayload,
  decodeSettingsPayload,
  encodeSavePayload,
  encodeSettingsPayload,
  MAX_SAVE_PAYLOAD,
  MAX_SETTINGS_PAYLOAD,
  readLayout,
  RIGLINE_BLOCKS,
  SAVE_PAYLOAD_VERSION,
  SETTINGS_PAYLOAD_VERSION,
} from "./save.ts";
export { sameValue } from "./same.ts";
export { manifestSchema, manifestSchemaJson } from "./schema.ts";
export { nextSessionId } from "./session.ts";
export { PENDING_TOOL_LIMIT, toolResults, toolUses } from "./stream.ts";
export type { StylesheetNames } from "./stylesheet.ts";
export { stylesheetNames } from "./stylesheet.ts";
export type { IdentifierTables, ReactGap } from "./tables.ts";
export type { FiberLike } from "./transcript.ts";
export { entriesDiffer, messageTimes, onScreen, rowIdentity } from "./transcript.ts";
export type { ContextAnswer, ContextReading, MessageTokens, ModelWindow } from "./usage.ts";
export {
  contextAnswer,
  contextReading,
  formulaLimit,
  ioChannel,
  mergeTokens,
  UNKNOWN_USAGE,
} from "./usage.ts";
