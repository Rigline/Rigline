/**
 * The pre hook: statically imported from the head of the extension's webview/index.js, so it
 * evaluates before the bundle body. That ordering is the only way to wrap acquireVsCodeApi,
 * which the app calls exactly once during boot.
 *
 * NOTHING HERE MAY THROW. A throw at this module's top level fails the whole module graph and the
 * panel renders blank with no attribution. Every statement sits inside the try, and no
 * third-party code is reachable from this file. Plugins load in post.ts, dynamically.
 *
 * Phase 2 of docs/plan.md fills this in.
 */

try {
  // Intentionally empty until phase 2.
} catch {
  // Unreachable today, and kept so that the guarantee above is structural rather than a comment.
}
