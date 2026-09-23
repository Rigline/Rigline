/**
 * Pointing a plugin's imports of the runtime modules at the payload's copies.
 *
 * A plugin's build leaves `react` and its siblings as bare imports, which nothing in a webview can
 * resolve, and this turns each into a path relative to the plugin's own entry as `install` copies it.
 * es-module-lexer rather than a pattern, because a specifier-shaped string inside a comment or a
 * string literal is exactly what a pattern would also rewrite.
 */
import { posix } from "node:path";
import { isRuntimeSpecifier, RUNTIME_MODULES } from "@rigline/plugin-api";
import { initSync, parse } from "es-module-lexer";

export interface ResolvedImports {
  readonly source: string;
  /** Bare specifiers outside the runtime set: the browser will refuse to load the module. */
  readonly unresolved: readonly string[];
}

/** Relative, absolute, or a URL: what a browser resolves without an import map. */
function resolvable(specifier: string): boolean {
  return /^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(specifier);
}

/**
 * `source` with every runtime import rewritten against `entry`, the module's own path inside the
 * payload directory. Throws when the source is not an ES module es-module-lexer can read.
 */
export function resolveRuntimeImports(source: string, entry: string): ResolvedImports {
  initSync();
  const [imports] = parse(source);
  const from = posix.dirname(entry);
  const unresolved = new Set<string>();
  let out = "";
  let last = 0;
  for (const found of [...imports].sort((a, b) => a.s - b.s)) {
    const specifier = found.n;
    if (specifier === undefined) continue;
    if (!isRuntimeSpecifier(specifier)) {
      if (!resolvable(specifier)) unresolved.add(specifier);
      continue;
    }
    const relative = posix.relative(from, RUNTIME_MODULES[specifier]);
    const path = relative.startsWith(".") ? relative : `./${relative}`;
    // A dynamic import's range includes its quotes; a static one's does not.
    out += source.slice(last, found.s) + (found.d === -1 ? path : JSON.stringify(path));
    last = found.e;
  }
  return { source: out + source.slice(last), unresolved: [...unresolved] };
}

/** Why a plugin whose entry is `source` cannot load, or null when its imports all resolve. */
export function importProblem(source: string): string | null {
  let unresolved: readonly string[];
  try {
    unresolved = resolveRuntimeImports(source, "index.js").unresolved;
  } catch (e) {
    return `its entry is not an ES module Rigline can read: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (unresolved.length === 0) return null;
  const names = unresolved.map((s) => `"${s}"`).join(", ");
  return (
    `it imports ${names}, which the panel does not provide; bundle it, or import only ` +
    Object.keys(RUNTIME_MODULES).join(", ")
  );
}
