/**
 * The post hook: dynamically imported from the tail of the extension's webview/index.js, after
 * createRoot().render(). The injected caller catches, so a failure here cannot stop the app
 * booting.
 *
 * Loads the registry the installer baked, checks each plugin's declarations against the tables
 * written beside this file, builds a capability-scoped ctx per plugin and calls setup() in its own
 * try/catch. Phase 2 of docs/plan.md fills this in.
 */

export {};
