/**
 * `rigline layout`: the person's layout as it resolves, and the edits that change it (D92).
 *
 * Every edit goes through `editConfig`, so the rest of `config.yaml` is left as a person wrote it,
 * and names what it refuses: an element no installed plugin declares, or a place it cannot go.
 */
import {
  type ElementSpec,
  type Layout,
  layoutView,
  type Placement,
  parsePlace,
  placementLabel,
  placeName,
  samePlacement,
  type ViewElement,
  type ViewPlace,
} from "@rigline/plugin-api";
import { type Document, isMap, isScalar, isSeq } from "yaml";
import { UserError } from "../errors.ts";
import { addToList, editConfig, type PluginsConfig, removeFromList } from "./config.ts";
import { type DiscoveredPlugin, layoutNotes } from "./discover.ts";

export type LaidOutElement = ViewElement;

export interface LayoutView {
  readonly path: string;
  /** Each place something is in: zones, then slots, then off. */
  readonly places: readonly ViewPlace[];
  /** Each entry that does not resolve, as `install` reports it. */
  readonly problems: readonly string[];
}

/** Where every enabled plugin's elements are, grouped by place, in the order each place shows them. */
export function viewLayout(
  enabled: readonly DiscoveredPlugin[],
  config: PluginsConfig,
): LayoutView {
  return {
    path: config.path,
    places: layoutView(
      config.layout,
      enabled.map((p) => ({ name: p.name, elements: p.manifest.elements })),
    ),
    problems: layoutNotes(config, enabled),
  };
}

export function formatLayout(view: LayoutView): string {
  if (view.places.length === 0) return "no enabled plugin has elements";
  const all = view.places.flatMap((p) => p.elements);
  const nameWidth = Math.max(...all.map((e) => e.name.length));
  const titleWidth = Math.max(...all.map((e) => e.title.length));
  const lines: string[] = [];
  for (const { place, elements } of view.places) {
    lines.push(place);
    for (const element of elements) {
      const notes = [
        ...(element.listed ? ["yours"] : []),
        ...(element.also.length > 0 ? [`can also go ${element.also.join(", ")}`] : []),
      ];
      lines.push(
        `  ${element.name.padEnd(nameWidth)}  ${element.title.padEnd(titleWidth)}  ${notes.join("; ")}`.trimEnd(),
      );
    }
  }
  if (view.problems.length > 0) lines.push("", ...view.problems);
  return lines.join("\n");
}

/** `default`, or a place `parsePlace` understands; anything else is refused with why. */
export function parseWhere(words: readonly string[]): Placement | null | "default" {
  const where = words.join(" ");
  if (where === "default") return "default";
  const parsed = parsePlace(where);
  if ("problem" in parsed) {
    throw new UserError(
      where === ""
        ? "a place is needed: a zone, before/after/inside ANCHOR, off or default"
        : parsed.problem,
    );
  }
  return parsed.placement;
}

/** The element `name` among `discovered`, or a refusal saying what there is. */
function findElement(
  discovered: readonly DiscoveredPlugin[],
  name: string,
): { readonly plugin: string; readonly spec: ElementSpec } {
  const [plugin, id, ...rest] = name.split("/");
  if (!plugin || !id || rest.length > 0) {
    throw new UserError(`"${name}" is not plugin/element; \`rigline layout\` names every element`);
  }
  const found = discovered.find((p) => p.name === plugin);
  if (!found) {
    throw new UserError(
      `no plugin called "${plugin}" is installed; \`rigline layout\` names every element`,
    );
  }
  const elements = found.manifest.elements;
  const spec = Object.hasOwn(elements, id) ? elements[id] : undefined;
  if (!spec) {
    const ids = Object.keys(elements);
    throw new UserError(
      ids.length === 0
        ? `${plugin} has no elements`
        : `${plugin} has no element "${id}"; its elements are ${ids.join(", ")}`,
    );
  }
  return { plugin, spec };
}

function checkPlace(name: string, spec: ElementSpec, placement: Placement | null): void {
  if (placement === null || spec.placements.some((p) => samePlacement(p, placement))) return;
  throw new UserError(
    `${name} cannot go ${placementLabel(placement)}; ` +
      `it can go ${spec.placements.map(placementLabel).join(" or ")}, or off`,
  );
}

export interface PlaceResult {
  /** False when the layout already said this, which is worth saying rather than claiming a change. */
  readonly changed: boolean;
  /** Where it now goes, and whether that is its plugin's choice rather than the person's. */
  readonly placement: Placement | null;
  readonly isDefault: boolean;
}

/**
 * Moves one element to the end of a place's list, taking it out of any other, or back to its
 * plugin's default with `"default"`.
 */
export function placeInLayout(
  configPath: string,
  discovered: readonly DiscoveredPlugin[],
  name: string,
  where: Placement | null | "default",
): PlaceResult {
  const { spec } = findElement(discovered, name);
  if (where !== "default") checkPlace(name, spec, where);
  const key = where === "default" ? null : placeName(where);
  const changed = editConfig(configPath, (doc) => {
    let changed = unlist(doc, name, key);
    if (key === null) return changed;
    const names = namesAt(doc, key);
    if (names.at(-1) === name) return changed;
    removeFromList(doc, ["layout", key], name);
    addToList(doc, ["layout", key], name);
    changed = true;
    return changed;
  });
  return where === "default"
    ? { changed, placement: spec.default, isDefault: true }
    : { changed, placement: where, isDefault: false };
}

/** Replaces one place's list with `names`, taking each out of any other list. */
export function orderInLayout(
  configPath: string,
  discovered: readonly DiscoveredPlugin[],
  where: Placement | null,
  names: readonly string[],
): boolean {
  if (names.length === 0) throw new UserError("order needs a place and the elements to put there");
  const repeated = names.find((name, i) => names.indexOf(name) !== i);
  if (repeated) throw new UserError(`${repeated} is named twice`);
  for (const name of names) checkPlace(name, findElement(discovered, name).spec, where);
  const key = placeName(where);
  return editConfig(configPath, (doc) => {
    let changed = false;
    for (const name of names) changed = unlist(doc, name, key) || changed;
    return setList(doc, ["layout", key], names) || changed;
  });
}

/**
 * Writes `layout` over the file's, place by place, so a name already listed keeps its node and any
 * comment on it, and a place `layout` does not have is emptied (D93).
 */
export function writeLayout(configPath: string, layout: Layout): boolean {
  const wanted = Object.entries(layout).filter(([, names]) => names.length > 0);
  return editConfig(configPath, (doc) => {
    let changed = false;
    if (doc.has("layout") && !isMap(doc.get("layout", true))) {
      doc.delete("layout");
      changed = true;
    }
    const keep = new Set(wanted.map(([place]) => place));
    for (const place of placesIn(doc)) {
      if (keep.has(place)) continue;
      doc.deleteIn(["layout", place]);
      changed = true;
    }
    for (const [place, names] of wanted)
      changed = setList(doc, ["layout", place], names) || changed;
    const node = doc.get("layout", true);
    if (isMap(node) && node.items.length === 0) doc.delete("layout");
    return changed;
  });
}

/** Takes `layout` out of the file, which puts every element back where its plugin puts it. */
export function resetLayout(configPath: string): boolean {
  return editConfig(configPath, (doc) => doc.delete("layout"));
}

/** The places the file's layout names, in the order it names them. */
function placesIn(doc: Document): string[] {
  const layout = doc.get("layout", true);
  if (!isMap(layout)) return [];
  return layout.items.map((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key));
}

function namesAt(doc: Document, place: string): unknown[] {
  const list = doc.getIn(["layout", place], true);
  return isSeq(list) ? list.items.map((item) => (isScalar(item) ? item.value : null)) : [];
}

/**
 * Takes `name` out of every place's list but `keep`'s. A place left empty goes, and `layout` with it
 * when it was the last: a key with nothing under it says nothing.
 */
function unlist(doc: Document, name: string, keep: string | null): boolean {
  let changed = false;
  for (const place of placesIn(doc)) {
    if (place === keep || !removeFromList(doc, ["layout", place], name)) continue;
    changed = true;
    if (namesAt(doc, place).length === 0) doc.deleteIn(["layout", place]);
  }
  const layout = doc.get("layout", true);
  if (changed && isMap(layout) && layout.items.length === 0) doc.delete("layout");
  return changed;
}

/** Sets the list at `path` to `names`, keeping the node, and so any comment, of a name already there. */
function setList(doc: Document, path: readonly string[], names: readonly string[]): boolean {
  const node = doc.getIn(path, true);
  const current = isSeq(node) ? node.items : [];
  if (
    current.length === names.length &&
    current.every((item, i) => isScalar(item) && item.value === names[i])
  ) {
    return false;
  }
  if (!isSeq(node)) {
    doc.setIn(path, doc.createNode([...names]));
    return true;
  }
  node.items = names.map(
    (name) => current.find((item) => isScalar(item) && item.value === name) ?? doc.createNode(name),
  );
  return true;
}
