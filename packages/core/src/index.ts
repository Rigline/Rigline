/**
 * @prototype/core: everything that runs in Node on behalf of Prototype.
 *
 * Locating installed extensions, harvesting identifier layers, generating types and runtime
 * tables, injecting and restoring the loader, discovering plugins and baking the registry, the
 * update flow and its watcher, and the curated anchor table. The CLI is a thin surface over this;
 * a companion VS Code extension would be another.
 *
 * Phase 1 of docs/plan.md fills this in. Until then it exports the version so the workspace builds.
 */

export const CORE_VERSION = "1.0.0-alpha.0";
