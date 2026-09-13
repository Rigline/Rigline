/**
 * @prototype/core: everything that runs in Node on behalf of Prototype.
 *
 * Locating installed extensions, harvesting identifier layers, generating types and runtime
 * tables, injecting and restoring the loader, discovering plugins and baking the registry, the
 * update flow and its watcher, and resolving the curated anchor table. The CLI is a thin surface
 * over this; a companion VS Code extension would be another.
 */

export const CORE_VERSION = "1.0.0-alpha.0";

export type { ResolvedAnchors } from "./anchors/resolve.ts";
export { anchorViolation, resolveAnchors } from "./anchors/resolve.ts";
export type { Generated } from "./codegen/generate.ts";
export { generate } from "./codegen/generate.ts";
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
  RestoreResult,
  Verdict,
} from "./inject/inject.ts";
export {
  hostVerdict,
  inspect,
  install,
  PATCH_BYTES,
  restore,
  restoreAll,
  verdict,
} from "./inject/inject.ts";
export type { Harvest } from "./layers/index.ts";
export * from "./layers/index.ts";
export { harvestAll, LAYERS, scanOf } from "./layers/index.ts";
export type { DiscoveredPlugin, PluginsConfig } from "./plugins/discover.ts";
export {
  bakeRegistry,
  capabilityUseNotes,
  declaredPatches,
  discoverPlugins,
  enabledPlugins,
  isPluginOutput,
  readConfig,
  readManifest,
} from "./plugins/discover.ts";
