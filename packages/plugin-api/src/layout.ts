/**
 * A person's layout: the elements they have moved, ordered or switched off, as a list per place
 * (D92). The shape `config.yaml` spells, `install` bakes and the kernel resolves, so a save from the
 * panel writes back the value it was handed.
 */
import {
  type ElementSpec,
  type Elements,
  type Placement,
  placementLabel,
  SLOT_POSITIONS,
  type SlotPosition,
  samePlacement,
  ZONE_NAMES,
  ZONES,
  type ZoneName,
} from "./elements.ts";

/** Each place, as the file spells it, to the elements listed there as `plugin/element`. */
export type Layout = Readonly<Record<string, readonly string[]>>;

/** The place an element goes to be switched off. */
export const OFF = "off";

const SLOT = new RegExp(`^(${SLOT_POSITIONS.join("|")}) ([A-Za-z][A-Za-z0-9]{0,63})$`);

/** How the file spells a place: `rigRow`, `before footerSpacer`, or `off` for null. */
export function placeName(placement: Placement | null): string {
  if (placement === null) return OFF;
  return typeof placement === "string" ? placement : `${placement.at} ${placement.anchor}`;
}

/** What the panel calls a slot whose spelling is not for a person to read (D96). */
const SLOT_TITLES: Readonly<Record<string, string>> = { "before footerSpacer": "Footer" };

/** What the panel calls a place; the file and the CLI keep its spelling (D96). */
export function placeTitle(place: string): string {
  if (place === OFF) return "Off";
  if (Object.hasOwn(ZONES, place)) return ZONES[place as ZoneName].title;
  return SLOT_TITLES[place] ?? place;
}

/** What a place's name means, null being off, or why it means nothing. */
export function parsePlace(
  name: string,
): { readonly placement: Placement | null } | { readonly problem: string } {
  if (name === OFF) return { placement: null };
  if (Object.hasOwn(ZONES, name)) return { placement: name };
  const slot = SLOT.exec(name);
  if (slot) return { placement: { anchor: slot[2] as string, at: slot[1] as SlotPosition } };
  if (name === "default") {
    return {
      problem:
        '"default" is not a place: an element is where its plugin puts it by being in no list',
    };
  }
  return {
    problem:
      `"${name}" is not a place: a place is ${ZONE_NAMES.join(", ")}, ` +
      `${SLOT_POSITIONS.join(", ")} an anchor, or ${OFF}`,
  };
}

/** Where one element goes. */
export interface ElementPlace {
  /** The layout's place for it where the element offers that place, else its default. */
  readonly placement: Placement | null;
  /** Its index in the list that put it there, or null where it is at its default. */
  readonly listed: number | null;
}

/**
 * Where `layout` puts the element `name`. The first list naming it decides, and a place that element
 * cannot go leaves it at its default; `layoutProblems` says which.
 */
export function placeElement(layout: Layout, name: string, spec: ElementSpec): ElementPlace {
  for (const [place, names] of Object.entries(layout)) {
    const listed = names.indexOf(name);
    if (listed === -1) continue;
    const parsed = parsePlace(place);
    if ("problem" in parsed) break;
    const { placement } = parsed;
    if (placement === null || spec.placements.some((p) => samePlacement(p, placement))) {
      return { placement, listed };
    }
    break;
  }
  return { placement: spec.default, listed: null };
}

/** Whether two layouts say the same: a place listing nothing is no place, and order within one counts. */
export function sameLayout(a: Layout, b: Layout): boolean {
  const places = (layout: Layout): string[] =>
    Object.keys(layout).filter((place) => (layout[place]?.length ?? 0) > 0);
  const inA = places(a);
  if (inA.length !== places(b).length) return false;
  return inA.every((place) => {
    const x = a[place] ?? [];
    const y = b[place] ?? [];
    return x.length === y.length && x.every((name, i) => name === y[i]);
  });
}

/**
 * Where an element sorts among everything at its place: listed elements first, in list order, ahead
 * of every registry rank, which starts at 0; then the rest by plugin, then manifest order.
 */
export function elementRank(place: ElementPlace, order: number, index: number): number {
  return place.listed === null ? order + index / 1024 : place.listed - 2 ** 20;
}

/**
 * One line per element, for what `list` and `add` say a plugin does: where each goes, and whether
 * that is the person's doing.
 */
export function describeElements(elements: Elements, plugin = "", layout: Layout = {}): string[] {
  return Object.entries(elements).map(([id, spec]) => {
    const { placement, listed } = placeElement(layout, `${plugin}/${id}`, spec);
    const title = `"${spec.title}"`;
    if (placement === null) {
      return `offers ${title}, ${listed === null || spec.default === null ? "off by default" : "switched off"}`;
    }
    const shows = `shows ${title} ${placementLabel(placement)}`;
    if (listed === null || samePlacement(placement, spec.default)) return shows;
    return spec.default === null
      ? `${shows}, switched on`
      : `${shows}, moved from ${placementLabel(spec.default)}`;
  });
}

/** A plugin as the layout sees it. */
export interface LayoutPlugin {
  readonly name: string;
  readonly elements: Elements;
}

/** One element in a view of the layout. */
export interface ViewElement {
  /** `plugin/element`, as the layout and the commands spell it. */
  readonly name: string;
  readonly title: string;
  /** Whether the layout put it here, rather than its plugin. */
  readonly listed: boolean;
  /** The other places it may go, as the file spells them. */
  readonly also: readonly string[];
  /** Where its plugin puts it, as the file spells a place. */
  readonly defaultPlace: string;
}

export interface ViewPlace {
  readonly place: string;
  readonly elements: readonly ViewElement[];
}

/**
 * Every element of `plugins`, grouped by where `layout` puts it — zones, then slots, then off — and
 * in the order each place shows them. What `rigline layout` prints and the panel's editor lists.
 */
export function layoutView(layout: Layout, plugins: readonly LayoutPlugin[]): ViewPlace[] {
  const byPlace = new Map<string, (ViewElement & { readonly rank: number })[]>();
  plugins.forEach((plugin, order) => {
    Object.entries(plugin.elements).forEach(([id, spec], index) => {
      const name = `${plugin.name}/${id}`;
      const placed = placeElement(layout, name, spec);
      const { placement } = placed;
      const place = placeName(placement);
      const also = spec.placements
        .filter((p) => placement === null || !samePlacement(p, placement))
        .map(placeName);
      const rank = elementRank(placed, order, index);
      const list = byPlace.get(place) ?? [];
      list.push({
        name,
        title: spec.title,
        listed: placed.listed !== null,
        also,
        defaultPlace: placeName(spec.default),
        rank,
      });
      byPlace.set(place, list);
    });
  });
  const kind = (place: string): number =>
    place === OFF ? 2 : (ZONE_NAMES as readonly string[]).includes(place) ? 0 : 1;
  return [...byPlace.keys()]
    .sort((a, b) => kind(a) - kind(b) || a.localeCompare(b))
    .map((place) => ({
      place,
      elements: (byPlace.get(place) ?? [])
        .sort((a, b) => a.rank - b.rank)
        .map(({ rank: _, ...element }) => element),
    }));
}

/**
 * `layout` with `name` out of every list and last in `place`'s, or at its default when `place` is
 * null. A list left empty goes. Built as entries, so a place called `__proto__` stays a key.
 */
export function withElementAt(layout: Layout, name: string, place: string | null): Layout {
  const lists = new Map<string, string[]>();
  for (const [at, names] of Object.entries(layout)) {
    const kept = names.filter((n) => n !== name);
    if (kept.length > 0) lists.set(at, kept);
  }
  if (place !== null) lists.set(place, [...(lists.get(place) ?? []), name]);
  return Object.fromEntries(lists);
}

/** `layout` with `place` listing exactly `names`, each taken out of any other list. */
export function withOrder(layout: Layout, place: string, names: readonly string[]): Layout {
  const lists = new Map<string, string[]>();
  for (const [at, listed] of Object.entries(layout)) {
    if (at === place) continue;
    const kept = listed.filter((n) => !names.includes(n));
    if (kept.length > 0) lists.set(at, kept);
  }
  if (names.length > 0) lists.set(place, [...names]);
  return Object.fromEntries(lists);
}

/**
 * The `rigline layout` commands that turn `from` into `to`, for a panel with no companion to save
 * through (D93). Only the places that differ are named: a command cannot write back an entry that
 * does not resolve, so one left alone in an untouched place is kept rather than reset away.
 */
export function layoutCommands(from: Layout, to: Layout): string[] {
  const at = (layout: Layout, place: string): readonly string[] =>
    Object.hasOwn(layout, place) ? (layout[place] ?? []) : [];
  const kept = new Set(Object.values(to).flat());
  const commands: string[] = [];
  for (const place of new Set([...Object.keys(to), ...Object.keys(from)])) {
    const want = at(to, place);
    const had = at(from, place);
    if (want.length === had.length && want.every((n, i) => n === had[i])) continue;
    if (want.length > 0) {
      commands.push(`rigline layout order ${place} ${want.join(" ")}`);
      continue;
    }
    for (const name of had) {
      if (!kept.has(name)) commands.push(`rigline layout place ${name} default`);
    }
  }
  return commands;
}

/**
 * Every entry of `layout` that does not resolve against `plugins`, one line each. Reported, never a
 * refusal: the element stays at its default, and the entry stays in the file, since its plugin may
 * come back. Entries for a plugin in `disabled` say nothing.
 */
export function layoutProblems(
  layout: Layout,
  plugins: readonly LayoutPlugin[],
  disabled: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  const declared = new Map(plugins.map((p) => [p.name, p.elements]));
  const first = new Map<string, string>();
  for (const [place, names] of Object.entries(layout)) {
    const parsed = parsePlace(place);
    if ("problem" in parsed) problems.push(parsed.problem);
    for (const name of names) {
      const earlier = first.get(name);
      if (earlier !== undefined) {
        problems.push(`${name} is under both "${earlier}" and "${place}"; the first is used`);
        continue;
      }
      first.set(name, place);
      if ("problem" in parsed) continue;
      const problem = entryProblem(name, parsed.placement, declared, disabled);
      if (problem !== null) problems.push(problem);
    }
  }
  return problems;
}

function entryProblem(
  name: string,
  placement: Placement | null,
  declared: ReadonlyMap<string, Elements>,
  disabled: readonly string[],
): string | null {
  const [plugin, id, ...rest] = name.split("/");
  if (!plugin || !id || rest.length > 0) return `"${name}" is not plugin/element`;
  if (disabled.includes(plugin)) return null;
  const elements = declared.get(plugin);
  if (elements === undefined) return `${name}: no plugin "${plugin}" is installed`;
  const spec = Object.hasOwn(elements, id) ? elements[id] : undefined;
  if (spec === undefined) return `${name}: ${plugin} declares no element "${id}"`;
  if (placement === null || spec.placements.some((p) => samePlacement(p, placement))) return null;
  return (
    `${name} cannot go ${placementLabel(placement)}; ` +
    `it can go ${spec.placements.map(placementLabel).join(" or ")}`
  );
}
