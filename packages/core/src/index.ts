/**
 * @rigline/core: everything that runs in Node on behalf of Rigline.
 *
 * Locating installed extensions, harvesting identifier layers, generating types and runtime
 * tables, injecting and restoring the loader, discovering plugins and baking the registry, the
 * update flow and its watcher, and resolving the curated anchor table. The CLI is a thin surface
 * over this; a companion VS Code extension would be another.
 */

export type { AnchorOverrideOutcome, AnchorOverrides } from "./anchors/overrides.ts";
export {
  anchorOverrideOutcomes,
  mergeAnchorOverrides,
  NO_ANCHOR_OVERRIDES,
  readAnchorOverrides,
} from "./anchors/overrides.ts";
export type { AnchorTable, ResolvedAnchors } from "./anchors/resolve.ts";
export { missingAnchorReason, resolveAnchors, uncountedClasses } from "./anchors/resolve.ts";
export {
  bundledDir,
  bundledPluginsDir,
  checkoutPluginsDir,
  corePackageDir,
  workspaceRoot,
} from "./assets.ts";
export type { Generated } from "./codegen/generate.ts";
export { generate } from "./codegen/generate.ts";
export type { CarriedCompanion, CompanionStatus } from "./companion/fingerprint.ts";
export {
  COMPANION_SIDECAR,
  carriedCompanion,
  companionFingerprint,
  companionStatus,
  installedFingerprint,
} from "./companion/fingerprint.ts";
export type { FoundEditor, SetupOptions, SetupOutcome } from "./companion/setup.ts";
export {
  COMPANION_RELOAD,
  COMPANION_VSIX,
  checkoutEngineNote,
  companionVsix,
  EDITOR_CLIS,
  editorSpawn,
  findEditors,
  formatSetup,
  setupArgv,
  setupCompanion,
} from "./companion/setup.ts";
export type { DoctorOptions, DoctorReport } from "./doctor/collect.ts";
export { collect } from "./doctor/collect.ts";
export type { BakedPlugin, BakedRegistry, FileFact, InstallState } from "./doctor/install.ts";
export { fileFact, installState, installStates, parseRegistry } from "./doctor/install.ts";
export { formatBytes, formatDoctor, formatTime } from "./doctor/report.ts";
export { runEngine } from "./engine/main.ts";
export { UserError } from "./errors.ts";
export {
  HOST_BACKUP,
  HOST_BUNDLE,
  hostBackupIsCurrent,
  isExtensionDir,
  pristineHostPath,
  pristineWebviewPath,
  readBundles,
  WEBVIEW_BACKUP,
  WEBVIEW_BUNDLE,
  WEBVIEW_CSS,
} from "./extension/bundles.ts";
export {
  EXTENSION_NAME_PREFIX,
  EXTENSIONS_DIR,
  extensionVersion,
  findExtension,
  installedExtensions,
  supersededExtensions,
  URL_SCHEME,
} from "./extension/locate.ts";
export type {
  DeclaredPatch,
  PatchOutcome,
} from "./inject/hostpatch.ts";
export { applyPatches, patchRefusal } from "./inject/hostpatch.ts";
export type { ResolvedImports } from "./inject/imports.ts";
export { importProblem, resolveRuntimeImports } from "./inject/imports.ts";
export type {
  Injection,
  InstallOptions,
  InstallReport,
  PluginVerdict,
  RestoreResult,
  Verdict,
} from "./inject/inject.ts";
export {
  hostPatchOutcomes,
  hostVerdict,
  inspect,
  install,
  PATCH_BYTES,
  pluginVerdicts,
  restore,
  restoreAll,
  verdict,
} from "./inject/inject.ts";
export type { Harvest } from "./layers/index.ts";
export * from "./layers/index.ts";
export { harvestAll, LAYERS, scanOf } from "./layers/index.ts";
export type { RiglinePaths } from "./paths.ts";
export { RIGLINE_HOME_VARIABLE, riglineHome, riglinePaths } from "./paths.ts";
export type {
  ConfigFiles,
  NpmSource,
  PathSource,
  PluginSource,
  PluginsConfig,
} from "./plugins/config.ts";
export {
  describeSource,
  editConfig,
  readConfig,
  readSources,
  splitLegacyConfig,
  updateSources,
} from "./plugins/config.ts";
export type { DiscoveredPlugin, ManifestCheck } from "./plugins/discover.ts";
export {
  bakeRegistry,
  capabilityUseNotes,
  checkManifest,
  declaredPatches,
  discoverPlugins,
  enabledPlugins,
  isPluginOutput,
  layoutNotes,
  readManifest,
  registryEngine,
} from "./plugins/discover.ts";
export type { LaidOutElement, LayoutView, PlaceResult } from "./plugins/layout.ts";
export {
  formatLayout,
  orderInLayout,
  parseWhere,
  placeInLayout,
  resetLayout,
  viewLayout,
  writeLayout,
} from "./plugins/layout.ts";
export type {
  LabelledRoot,
  ListOptions,
  PatchListing,
  PluginListing,
} from "./plugins/list.ts";
export { formatPlugins, listPlugins } from "./plugins/list.ts";
export type {
  AddOptions,
  AddResult,
  RemoveOptions,
  RemoveResult,
  SwitchOptions,
  SwitchResult,
} from "./plugins/manage.ts";
export { addPlugin, parseSource, removePlugin, setPluginEnabled } from "./plugins/manage.ts";
export type { PanelSave } from "./plugins/save.ts";
export {
  companionHandlesSave,
  ensureToken,
  readToken,
  saveFromPanel,
  saveRecord,
} from "./plugins/save.ts";
export type { BaselineSource } from "./update/baseline.ts";
export {
  GENERATED_FILE,
  readBaseline,
  readGeneratedScan,
  writeBaseline,
} from "./update/baseline.ts";
export type {
  FlowOptions,
  FlowReport,
  FormatOptions,
  UpdateOptions,
  VersionReport,
} from "./update/flow.ts";
export { check, formatFlow, update } from "./update/flow.ts";
export type { Watcher, WatchOptions } from "./update/watch.ts";
export { watch } from "./update/watch.ts";
export { CORE_VERSION } from "./version.ts";
