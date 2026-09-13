/**
 * Which webview surface this is.
 *
 * The extension sets `IS_SIDEBAR` and `IS_SESSION_LIST_ONLY` on the window for two of its three
 * surfaces; the full editor is the one where neither is set, identifiable by elimination. That is
 * a fact about these three surfaces and not a guarantee: a surface added later would read as the
 * full editor too.
 */
import type { Surface } from "@prototype/plugin-api";

export function detectSurface(): Surface {
  const w = globalThis as { IS_SIDEBAR?: unknown; IS_SESSION_LIST_ONLY?: unknown };
  if (w.IS_SIDEBAR === true) return "sidebar";
  if (w.IS_SESSION_LIST_ONLY === true) return "sessionList";
  return "editor";
}
