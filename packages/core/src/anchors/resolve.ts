/**
 * Resolving the curated anchor table against one extension version's class map.
 *
 * The table promises names; the class map says which of them the installed extension still
 * honours. Resolution happens per extension directory, at install time, and the result is written
 * beside the loader as data: the anchor a plugin asks for at runtime is looked up in that table,
 * never recomputed in the webview.
 *
 * **Two resolved forms, because an anchor is used two ways** (decisions.md, D7). A `style` anchor is
 * borrowed — a plugin hands the class to `classList.add` — so it resolves to a bare class, which is
 * what `ctx.anchor()` returns. An element anchor is *queried*, so it also resolves to a CSS
 * selector: the class, plus whatever the spec's `refine` adds, under whatever ancestor its `within`
 * names. The selector is what the host queries with, and it is the reason a refinement is not a
 * feature of ours — against a selector, `[role="combobox"]` is just the rest of the selector.
 *
 * An anchor that does not resolve is not an error here. It is reported, so the update flow can
 * name it, and it refuses only the plugins that declared it. The table is allowed to be ahead of
 * or behind the extension; what it may not do is resolve to the wrong element. Module scoping stops
 * one kind of wrong element and the site count stops the other: a `singleton` whose class the
 * bundle applies at more than one place, with nothing in the spec to tell them apart, does not
 * resolve at all. Absent beats wrong (P8), and the reason travels with the refusal.
 */
import { ANCHORS, type AnchorName, type AnchorSpec } from "@rigline/plugin-api";
import { siteCount } from "../layers/classes.ts";
import type { Classes } from "../layers/index.ts";

export interface ResolvedAnchors {
  /** Every anchor name, resolved to its full class or null when this version does not honour it. */
  readonly classes: Readonly<Record<AnchorName, string | null>>;
  /** The same names resolved to a CSS selector. Null for a style anchor, which is never queried. */
  readonly selectors: Readonly<Record<AnchorName, string | null>>;
  /** Why each unresolved anchor is unresolved, by name. A refusal quotes this rather than guessing. */
  readonly reasons: Readonly<Record<string, string>>;
  /** The anchors whose class this version has not got, in table order. */
  readonly missing: readonly AnchorName[];
  /** Singletons refused for naming more than one control, with the site count that says so. */
  readonly ambiguous: readonly { readonly name: AnchorName; readonly sites: number }[];
  /**
   * Anchors whose uniqueness could not be checked because their module was never counted. They
   * still resolve — an unverified claim is not a disproved one — but the flow says so, because an
   * unknown silently read as "one site" is the pass this whole layer exists to stop.
   */
  readonly unverified: readonly AnchorName[];
}

/**
 * A class map with nothing counted, for a caller that has only the map. Every anchor in it is
 * `unverified` rather than unique, which is the only honest reading of a count nobody took.
 */
export function uncountedClasses(map: Classes["map"]): Classes {
  return { map, sites: {}, uncounted: Object.keys(map) };
}

/**
 * A table of anchor specs by name. `ANCHORS` is the one this repo ships; the parameter exists
 * because D44's `~/.rigline/anchors.json` override resolves against a merged table, and because a
 * rule about the table is best tested against a table rather than by editing the real one.
 */
export type AnchorTable = Readonly<Record<string, AnchorSpec>>;

export function resolveAnchors(classes: Classes, table: AnchorTable = ANCHORS): ResolvedAnchors {
  const resolvedClasses = {} as Record<AnchorName, string | null>;
  const selectors = {} as Record<AnchorName, string | null>;
  const reasons: Record<string, string> = {};
  const missing: AnchorName[] = [];
  const ambiguous: { name: AnchorName; sites: number }[] = [];
  const unverified: AnchorName[] = [];

  for (const name of Object.keys(table) as AnchorName[]) {
    const spec = table[name] as AnchorSpec;
    const resolved = classes.map[spec.module]?.[spec.local] ?? null;
    if (resolved === null) {
      resolvedClasses[name] = null;
      selectors[name] = null;
      missing.push(name);
      reasons[name] = absentReason(name, spec);
      continue;
    }

    const sites = siteCount(classes, spec.module, spec.local);
    if (sites === null) {
      unverified.push(name);
    } else if (spec.kind === "singleton" && sites > allowedSites(spec) && !refined(spec)) {
      resolvedClasses[name] = null;
      selectors[name] = null;
      ambiguous.push({ name, sites });
      reasons[name] = ambiguityReason(name, spec, sites);
      continue;
    }

    resolvedClasses[name] = resolved;
    selectors[name] = spec.kind === "style" ? null : selectorFor(name, classes, table);
    if (selectors[name] === null && spec.kind !== "style") {
      // Only an unresolvable `within` gets here: the class is present, so the ancestor is what is
      // missing, and saying which is the difference between a repair and a hunt (D44).
      resolvedClasses[name] = null;
      missing.push(name);
      reasons[name] =
        `anchor "${name}" sits within "${spec.within}", which does not resolve in this extension`;
    }
  }

  return { classes: resolvedClasses, selectors, reasons, missing, ambiguous, unverified };
}

function absentReason(name: string, spec: AnchorSpec): string {
  return `anchor "${name}" (${spec.module}.${spec.local}) is not in this extension`;
}

/**
 * Why an anchor whose class this version has not got is unresolved, in one place so that a test
 * simulating the absence and the resolution that reports it cannot word it differently.
 */
export function missingAnchorReason(name: AnchorName): string {
  return absentReason(name, ANCHORS[name]);
}

/** Whether the spec says anything at all about which of the elements sharing the class it means. */
function refined(spec: AnchorSpec): boolean {
  return spec.refine !== undefined || spec.within !== undefined;
}

/**
 * How many references a singleton may have before it stops being one: one, or however many a
 * `knownSites` acknowledgement has read and accounted for (D7).
 *
 * Bounded rather than blanket, which is the whole difference between an acknowledgement and the
 * `collection` relabel it exists to stop being the cheaper move. An acknowledged anchor that gains
 * a further reference is ambiguous again, and the reason names both numbers so the next maintainer
 * can see they are looking at a claim that has been outgrown rather than one never made.
 */
function allowedSites(spec: AnchorSpec): number {
  return spec.knownSites?.count ?? 1;
}

function ambiguityReason(name: string, spec: AnchorSpec, sites: number): string {
  const pair = `${spec.module}.${spec.local}`;
  const acknowledged = spec.knownSites;
  if (acknowledged) {
    return (
      `anchor "${name}" (${pair}) names one element and accounts for ${acknowledged.count} ` +
      `references ("${acknowledged.why}"), but this extension has ${sites}`
    );
  }
  return (
    `anchor "${name}" (${pair}) names one element, but this extension applies its class at ` +
    `${sites} places and the table has no refinement to tell them apart`
  );
}

/**
 * One anchor's CSS selector, or null when it or an ancestor has no class in this version.
 *
 * The `seen` set is a cycle guard rather than a check: the table's own test asserts that no chain
 * of `within` loops, and this is what stops a table that slipped past it from hanging an install
 * instead of failing one.
 */
function selectorFor(
  name: string,
  classes: Classes,
  table: AnchorTable,
  seen: Set<string> = new Set(),
): string | null {
  if (seen.has(name)) {
    return null;
  }
  seen.add(name);
  const spec = table[name];
  if (spec === undefined) {
    return null;
  }
  const resolved = classes.map[spec.module]?.[spec.local];
  if (resolved === undefined) {
    return null;
  }
  const own = `.${resolved}${spec.refine ?? ""}`;
  if (spec.within === undefined) {
    return own;
  }
  const ancestor = selectorFor(spec.within, classes, table, seen);
  return ancestor === null ? null : `${ancestor} ${own}`;
}

/** The class an anchor resolves to, or a reason it cannot, for a refusal message. */
export function anchorViolation(name: string, resolved: ResolvedAnchors): string | null {
  if (!(name in ANCHORS)) return `unknown anchor "${name}"`;
  if (resolved.classes[name as AnchorName] === null) {
    return resolved.reasons[name] ?? `anchor "${name}" is not in this extension`;
  }
  return null;
}
