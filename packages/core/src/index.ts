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
export type { Generated } from "./codegen/generate.ts";
export { generate } from "./codegen/generate.ts";
export type { DoctorOptions, DoctorReport } from "./doctor/collect.ts";
export { collect } from "./doctor/collect.ts";
export type { BakedPlugin, BakedRegistry, FileFact, InstallState } from "./doctor/install.ts";
export { fileFact, installState, installStates, parseRegistry } from "./doctor/install.ts";
export { formatBytes, formatDoctor, formatTime } from "./doctor/report.ts";
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
} from "./extension/locate.ts";
export type {
  DeclaredPatch,
  PatchOutcome,
} from "./inject/hostpatch.ts";
export { applyPatches, patchRefusal } from "./inject/hostpatch.ts";
export type {
  Injection,
  InstallOptions,
  InstallReport,
  PluginVerdict,
  RestoreResult,
  Verdict,
} from "./inject/inject.ts";
export {
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
  DiscoveredPlugin,
  ManifestCheck,
  NpmSource,
  PathSource,
  PluginSource,
  PluginsConfig,
} from "./plugins/discover.ts";
export {
  bakeRegistry,
  capabilityUseNotes,
  checkManifest,
  declaredPatches,
  describeSource,
  discoverPlugins,
  enabledPlugins,
  isPluginOutput,
  readConfig,
  readManifest,
  updateConfig,
} from "./plugins/discover.ts";
export type {
  LabelledRoot,
  ListOptions,
  PatchListing,
  PluginListing,
} from "./plugins/list.ts";
export { formatPlugins, listPlugins } from "./plugins/list.ts";
export type {
  AddFromNpmOptions,
  AddOptions,
  AddResult,
  PluginUpdate,
  RemoveOptions,
  RemoveResult,
  UpdatePluginsOptions,
} from "./plugins/manage.ts";
export {
  addFromNpm,
  addPlugin,
  formatUpdates,
  removePlugin,
  updatePlugins,
} from "./plugins/manage.ts";
export type {
  FetchLike,
  FetchResponse,
  PluginSpec,
  RegistryOptions,
  ResolvedVersion,
} from "./plugins/registry.ts";
export {
  DEFAULT_REGISTRY,
  describeAge,
  fetchTarball,
  integrityProblem,
  MINIMUM_RELEASE_AGE_MINUTES,
  parsePluginSpec,
  releaseAgeProblem,
  resolveVersion,
} from "./plugins/registry.ts";
export type { TarFile } from "./plugins/tarball.ts";
export { readPackageTarball } from "./plugins/tarball.ts";
export type { BaselineSource } from "./update/baseline.ts";
export {
  GENERATED_FILE,
  readBaseline,
  readGeneratedScan,
  writeBaseline,
} from "./update/baseline.ts";
export type { FlowOptions, FlowReport, UpdateOptions, VersionReport } from "./update/flow.ts";
export { check, formatFlow, update } from "./update/flow.ts";
export type { Watcher, WatchOptions } from "./update/watch.ts";
export { watch } from "./update/watch.ts";
export { CORE_VERSION } from "./version.ts";
