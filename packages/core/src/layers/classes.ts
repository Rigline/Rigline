/**
 * The CSS-module class layer.
 *
 * The webview bundle's CSS modules are compiled ahead of time, so every local class name a
 * component references has already been rewritten to `<local>_<hash>` and the bundle carries the
 * mapping as a plain object literal per module, e.g.
 * `{modelPill:"modelPill_gGYT1w",modelPillRow:"modelPillRow_gGYT1w"}`. This is a name that crosses
 * a serialisation boundary (decisions.md, P1): the hashed string is what actually reaches the DOM,
 * so harvesting it is anchoring on the bundle's own output rather than on a minifier's choice of
 * identifier.
 *
 * A local name is not unique on its own (decisions.md, D6: `tab` is defined by more than one
 * module), so the map this layer produces is grouped by the six-character hash suffix, which is
 * the module's identity and is stable across builds. Flattening the map would let one module's
 * `tab` silently shadow another's.
 */
import { type Bundles, defineLayer, HarvestError } from "./types.ts";

/** Module hash -> local class name -> full hashed class, e.g. `gGYT1w.modelPill -> "modelPill_gGYT1w"`. */
export type ClassMap = Record<string, Record<string, string>>;

/**
 * A minified bundle can hold a JS-safe key as a bare identifier (`modelPill:"…"`) or, when the
 * local name contains a character that cannot start or continue a bare property name — a hyphen,
 * most often, since CSS class names allow one and JS identifiers do not — as a quoted string key
 * (`"mcpStatus_needs-auth":"…"`). Both forms are matched by one alternation so the harvest does not
 * need to know ahead of time which modules use hyphenated local names.
 *
 * The value is constrained to `<local>_<6 hash chars>` and, past the alternation, is checked again
 * to start with `local + "_"` (see below): this is what tells a class-map entry apart from an
 * unrelated string-valued property that happens to end in six word-ish characters after an
 * underscore, such as `sessionId:"abc123_OOQiHg"` — that value does not begin with `sessionId_`,
 * so it is skipped rather than harvested as a bogus local name `sessionId` in module `OOQiHg`.
 */
const CLASS_MAP_ENTRY =
  /(?:"([A-Za-z_$][\w$-]*)"|([A-Za-z_$][\w$]*))\s*:\s*"([A-Za-z_$][\w$-]*_([-_A-Za-z0-9]{6}))"/g;

/** Below either floor the regex has stopped matching the bundle's actual shape; see `HarvestError`. */
const MIN_MODULES = 30;
const MIN_CLASSES = 300;

/**
 * Harvest the class map out of the webview bundle.
 *
 * A module can redefine the same local name more than once within the bundle (seen in practice
 * where a module's mapping object is emitted more than once across the minified output); the last
 * definition encountered wins, matching how a later assignment would shadow an earlier one at
 * runtime.
 *
 * Throws `HarvestError` when the result falls under either floor. A real bundle holds on the order
 * of 95 modules and 900 classes, so 30 modules and 300 classes are smoke alarms for the regex
 * having stopped matching, not a judgement about how small the extension is allowed to be.
 */
export function harvestClassMap(js: string): ClassMap {
  const map: ClassMap = {};
  let classes = 0;

  for (const match of js.matchAll(CLASS_MAP_ENTRY)) {
    const local = match[1] ?? match[2];
    const value = match[3];
    const hash = match[4];
    if (local === undefined || value === undefined || hash === undefined) {
      continue;
    }
    if (!value.startsWith(`${local}_`)) {
      continue;
    }
    if (!(hash in map)) {
      map[hash] = {};
    }
    const module = map[hash] as Record<string, string>;
    if (!(local in module)) {
      classes += 1;
    }
    module[local] = value;
  }

  const modules = Object.keys(map).length;
  if (modules < MIN_MODULES || classes < MIN_CLASSES) {
    throw new HarvestError(
      "classes",
      `found ${modules} modules and ${classes} classes, below the floor of ${MIN_MODULES} modules and ${MIN_CLASSES} classes`,
    );
  }

  return map;
}

/**
 * A stylesheet rule name is `.<local>_<hash>`, but the local part is itself allowed to contain an
 * underscore or a hyphen (`mcpStatus_needs-auth`), so the boundary between "local name" and "hash"
 * is ambiguous from the character class alone. The local-name group is greedy, so on a rule such as
 * `.mcpStatus_needs-auth_yumWmQ` the engine first consumes as much as it can and backtracks only
 * enough to leave a valid `_<6 chars>` at the end — landing the hash on the *last* underscore group
 * (`yumWmQ`) rather than misreading `needs-` as a phantom module and `mcpStatus` as the local name.
 * The trailing negative lookahead stops the hash from absorbing a seventh word character, so a rule
 * whose class token is longer than a bare `<local>_<hash>` (unlikely in practice, but not ruled out
 * by the character classes alone) does not silently match a truncated hash.
 */
const CSS_CLASS_RULE = /\.([A-Za-z][\w-]*)_([A-Za-z0-9_-]{6})(?![\w-])/g;

/** Every module/local pair the stylesheet defines, for cross-checking against the harvested map. */
export function cssClasses(css: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const match of css.matchAll(CSS_CLASS_RULE)) {
    const local = match[1];
    const hash = match[2];
    if (local === undefined || hash === undefined) {
      continue;
    }
    let locals = result.get(hash);
    if (locals === undefined) {
      locals = new Set();
      result.set(hash, locals);
    }
    locals.add(local);
  }
  return result;
}

/** Local names defined by more than one module, sorted. Module-scoped lookup exists because of these. */
export function collidingLocalNames(map: ClassMap): string[] {
  const seenIn = new Map<string, number>();
  for (const module of Object.values(map)) {
    for (const local of Object.keys(module)) {
      seenIn.set(local, (seenIn.get(local) ?? 0) + 1);
    }
  }
  return [...seenIn.entries()]
    .filter(([, count]) => count > 1)
    .map(([local]) => local)
    .sort();
}

/**
 * Stylesheet classes the harvested map does not account for, grouped by module and sorted.
 *
 * A whole module missing from the map is expected: the stylesheet is compiled for markup this
 * particular build may not contain (a variant, a dead feature flag), and the bundler tree-shakes
 * the component without touching the CSS-modules output. `partial: true` — a module the map does
 * have, but for which the stylesheet still names locals the map lacks — is a different and much
 * worse finding: it means the harvest regex is dropping pairs out of a module it otherwise reads,
 * so callers treat a partial module as a failure rather than the noise a whole missing module is.
 */
export function unreachableCssClasses(
  map: ClassMap,
  css: string,
): { module: string; locals: string[]; partial: boolean }[] {
  const stylesheet = cssClasses(css);
  const gaps: { module: string; locals: string[]; partial: boolean }[] = [];

  for (const [module, locals] of stylesheet) {
    const harvested = map[module];
    const missing = [...locals].filter((local) => harvested?.[local] === undefined).sort();
    if (missing.length === 0) {
      continue;
    }
    gaps.push({ module, locals: missing, partial: harvested !== undefined });
  }

  return gaps.sort((a, b) => a.module.localeCompare(b.module));
}

/** JSON with keys sorted at both levels, 2-space indent, trailing newline: two versions diff cleanly. */
export function serialiseClassMap(map: ClassMap): string {
  const sorted: ClassMap = {};
  for (const module of Object.keys(map).sort()) {
    const locals = map[module];
    if (locals === undefined) {
      continue;
    }
    const sortedLocals: Record<string, string> = {};
    for (const local of Object.keys(locals).sort()) {
      const value = locals[local];
      if (value !== undefined) {
        sortedLocals[local] = value;
      }
    }
    sorted[module] = sortedLocals;
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The total number of classes across every module, for reports and floor checks alike. */
export function classCount(map: ClassMap): number {
  let count = 0;
  for (const module of Object.values(map)) {
    count += Object.keys(module).length;
  }
  return count;
}

/**
 * The registry entry (decisions.md, D5). `classes` is the one view a plugin manifest can name
 * directly (`uses.classes`); `modules` and `locals` exist so the stability diff can say "a module
 * was retired" and "a local name changed" as different news rather than folding both into one
 * count of moved strings.
 */
export const classesLayer = defineLayer({
  id: "classes",
  describe: "The webview's CSS-module class map, grouped by module hash.",
  harvest: (bundles: Bundles) => harvestClassMap(bundles.webview),
  views: {
    classes: (map) => new Set(Object.values(map).flatMap((module) => Object.values(module))),
    modules: (map) => new Set(Object.keys(map)),
    locals: (map) => new Set(Object.values(map).flatMap((module) => Object.keys(module))),
  },
});
