/**
 * Resolving the curated anchor table against one extension version's class map.
 *
 * The table promises names; the class map says which of them the installed extension still
 * honours. Resolution happens per extension directory, at install time, and the result is written
 * beside the loader as data: the anchor a plugin asks for at runtime is looked up in that table,
 * never recomputed in the webview.
 *
 * An anchor that does not resolve is not an error here. It is reported, so the update flow can
 * name it, and it refuses only the plugins that declared it. The table is allowed to be ahead of
 * or behind the extension; what it may not do is resolve to the wrong element, which the module
 * scoping prevents.
 */
import { ANCHORS, type AnchorName } from "@prototype/plugin-api";

/** module hash -> local name -> full hashed class, as the class layer harvests it. */
type ClassMapLike = Readonly<Record<string, Readonly<Record<string, string>> | undefined>>;

export interface ResolvedAnchors {
  /** Every anchor name, resolved to its full class or null when the installed extension lacks it. */
  readonly classes: Readonly<Record<AnchorName, string | null>>;
  /** The anchors that did not resolve, in table order. */
  readonly missing: readonly AnchorName[];
}

export function resolveAnchors(classMap: ClassMapLike): ResolvedAnchors {
  const classes = {} as Record<AnchorName, string | null>;
  const missing: AnchorName[] = [];
  for (const name of Object.keys(ANCHORS) as AnchorName[]) {
    const { module, local } = ANCHORS[name];
    const resolved = classMap[module]?.[local] ?? null;
    classes[name] = resolved;
    if (resolved === null) missing.push(name);
  }
  return { classes, missing };
}

/** The class an anchor resolves to, or a reason it cannot, for a refusal message. */
export function anchorViolation(name: string, resolved: ResolvedAnchors): string | null {
  if (!(name in ANCHORS)) return `unknown anchor "${name}"`;
  if (resolved.classes[name as AnchorName] === null) {
    const { module, local } = ANCHORS[name as AnchorName];
    return `anchor "${name}" (${module}.${local}) is not in this extension`;
  }
  return null;
}
