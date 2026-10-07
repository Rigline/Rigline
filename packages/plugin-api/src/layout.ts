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
  RIGLINE,
  RIGLINE_ELEMENTS,
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

const ROW = /^([A-Za-z][A-Za-z0-9]{0,63})(?: ([0-9]{1,3}))?(?: ([A-Za-z]{1,16}))?$/;

/** A row's two sides; the row's own spelling is its left (D127). */
export type Side = "left" | "right";

export const SIDES: readonly Side[] = ["left", "right"];

/** A side of a zone's row as the file spells it: `rigRow`, `rigRow 2`, `rigRow 2 right` (D122). */
export function rowPlace(zone: ZoneName, row: number, side: Side = "left"): string {
  const name = row === 1 ? zone : `${zone} ${row}`;
  return side === "left" ? name : `${name} ${side}`;
}

/** Which side of which zone's row `place` is, counting from one, or null where it is not a row. */
export function rowOf(
  place: string,
): { readonly zone: ZoneName; readonly row: number; readonly side: Side } | null {
  const match = ROW.exec(place);
  if (match === null || !Object.hasOwn(ZONES, match[1] as string)) return null;
  const [, zone, digits, word] = match;
  const row = digits === undefined ? 1 : Number(digits);
  if (digits !== undefined && (row < 2 || String(row) !== digits)) return null;
  if (word !== undefined && word !== "right") return null;
  return { zone: zone as ZoneName, row, side: word === undefined ? "left" : "right" };
}

/** The numbers of `zone`'s rows among `places`, ascending, each once whichever sides it has. */
export function rowNumbers(places: readonly string[], zone: ZoneName): number[] {
  const rows = places.flatMap((place) => {
    const row = rowOf(place);
    return row?.zone === zone ? [row.row] : [];
  });
  return [...new Set(rows)].sort((a, b) => a - b);
}

/** How the file spells a place: `rigRow`, `rigRow 2`, `before footerSpacer`, or `off` for null. */
export function placeName(placement: Placement | null): string {
  if (placement === null) return OFF;
  return typeof placement === "string" ? placement : `${placement.at} ${placement.anchor}`;
}

/** What the panel calls a slot whose spelling is not for a person to read (D96). */
const SLOT_TITLES: Readonly<Record<string, string>> = { "before footerSpacer": "Footer" };

/** What the panel calls a place; the file and the CLI keep its spelling (D96). */
export function placeTitle(place: string): string {
  if (place === OFF) return "Off";
  const row = rowOf(place);
  if (row !== null) {
    const { title } = ZONES[row.zone];
    const named = row.row === 1 ? title : `${title} ${row.row}`;
    return row.side === "left" ? named : `${named}, ${row.side}`;
  }
  return SLOT_TITLES[place] ?? place;
}

/** Every place a person can name, for a refusal, with `default` where the command takes it. */
export function placeForms(orDefault = false): string {
  const rows = ZONE_NAMES.map(
    (zone) =>
      `${zone}, ${rowPlace(zone, 2)} and on, ` +
      `${rowPlace(zone, 1, "right")}, ${rowPlace(zone, 2, "right")} and on`,
  ).join(", ");
  const slots = `${SLOT_POSITIONS.slice(0, -1).join(", ")} or ${SLOT_POSITIONS.at(-1)} an anchor`;
  return `${rows}, ${slots}, ${orDefault ? `${OFF}, or default` : `or ${OFF}`}`;
}

/** What a place's name means, null being off, or why it means nothing. */
export function parsePlace(
  name: string,
): { readonly placement: Placement | null } | { readonly problem: string } {
  if (name === OFF) return { placement: null };
  if (rowOf(name) !== null) return { placement: name };
  const row = ROW.exec(name);
  if (row !== null && Object.hasOwn(ZONES, row[1] as string)) {
    const zone = row[1] as ZoneName;
    const digits = row[2];
    if (digits !== undefined && rowOf(`${zone} ${digits}`) === null) {
      return {
        problem: `"${name}" is not a place: the first row is ${zone}, then ${rowPlace(zone, 2)}`,
      };
    }
    const at = digits === undefined ? zone : `${zone} ${digits}`;
    return {
      problem: `"${name}" is not a place: a row's left side is the row itself, ${at}, and its right side is ${at} right`,
    };
  }
  const slot = SLOT.exec(name);
  if (slot) return { placement: { anchor: slot[2] as string, at: slot[1] as SlotPosition } };
  if (name === "default") {
    return {
      problem:
        '"default" is not a place: an element is where its plugin puts it by being in no list',
    };
  }
  return { problem: `"${name}" is not a place: a place is ${placeForms()}` };
}

/** Where one element goes. */
export interface ElementPlace {
  /** The layout's place for it where the element offers that place, else its default. */
  readonly placement: Placement | null;
  /** Its index in the list that put it there, or null where it is at its default. */
  readonly listed: number | null;
}

/** Whether an element declaring `spec` may go at `placement`: any row of a zone it offers (D122). */
export function offers(spec: ElementSpec, placement: Placement): boolean {
  const zone = typeof placement === "string" ? (rowOf(placement)?.zone ?? placement) : placement;
  return spec.placements.some((p) => samePlacement(p, zone));
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
    if (placement === null || offers(spec, placement)) return { placement, listed };
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

/** `plugins` with Rigline's own elements after them: every list a layout resolves against (D97). */
export function withRigline(plugins: readonly LayoutPlugin[]): LayoutPlugin[] {
  return [...plugins, { name: RIGLINE, elements: RIGLINE_ELEMENTS }];
}

/** One element in a view of the layout. */
export interface ViewElement {
  /** `plugin/element`, as the layout and the commands spell it. */
  readonly name: string;
  readonly title: string;
  /** Whether the layout put it here, rather than its plugin. */
  readonly listed: boolean;
  /**
   * Its moves, as the file spells each place. In a zone it offers: its own row's other side, each
   * other row on the side it is on, then the next row, unless it is all the last row holds (D127).
   */
  readonly also: readonly string[];
  /** Where its plugin puts it, as the file spells a place. */
  readonly defaultPlace: string;
}

export interface ViewPlace {
  readonly place: string;
  readonly elements: readonly ViewElement[];
}

/** Rows first, by zone, number and side; then slots by spelling; then off. */
function comparePlaces(a: string, b: string): number {
  const ra = rowOf(a);
  const rb = rowOf(b);
  if (ra !== null && rb !== null) {
    return (
      ra.zone.localeCompare(rb.zone) ||
      ra.row - rb.row ||
      SIDES.indexOf(ra.side) - SIDES.indexOf(rb.side)
    );
  }
  const kind = (place: string): number => (rowOf(place) !== null ? 0 : place === OFF ? 2 : 1);
  return kind(a) - kind(b) || a.localeCompare(b);
}

/**
 * Every element of `plugins`, grouped by where `layout` puts it — rows, then slots, then off — and
 * in the order each place shows them. What `rigline layout` prints and the panel's editor lists.
 */
export function layoutView(layout: Layout, plugins: readonly LayoutPlugin[]): ViewPlace[] {
  const byPlace = new Map<
    string,
    (Omit<ViewElement, "also"> & { readonly spec: ElementSpec; readonly rank: number })[]
  >();
  plugins.forEach((plugin, order) => {
    Object.entries(plugin.elements).forEach(([id, spec], index) => {
      const name = `${plugin.name}/${id}`;
      const placed = placeElement(layout, name, spec);
      const place = placeName(placed.placement);
      const list = byPlace.get(place) ?? [];
      list.push({
        name,
        title: spec.title,
        listed: placed.listed !== null,
        defaultPlace: placeName(spec.default),
        spec,
        rank: elementRank(placed, order, index),
      });
      byPlace.set(place, list);
    });
  });
  const places = [...byPlace.keys()].sort(comparePlaces);
  /** How many elements a row shows, both sides together. */
  const held = (zone: ZoneName, row: number): number =>
    SIDES.reduce((n, side) => n + (byPlace.get(rowPlace(zone, row, side))?.length ?? 0), 0);
  const also = (spec: ElementSpec, place: string): string[] =>
    spec.placements.flatMap((p) => {
      if (typeof p !== "string" || !Object.hasOwn(ZONES, p)) {
        const name = placeName(p);
        return name === place ? [] : [name];
      }
      const zone = p as ZoneName;
      const at = rowOf(place);
      const own = at?.zone === zone ? at : null;
      const side = own?.side ?? "left";
      const rows = rowNumbers(places, zone);
      const last = rows.at(-1) ?? 0;
      const moves =
        own === null ? [] : [rowPlace(zone, own.row, own.side === "left" ? "right" : "left")];
      for (const row of rows) if (row !== own?.row) moves.push(rowPlace(zone, row, side));
      if (own?.row !== last || held(zone, last) > 1) moves.push(rowPlace(zone, last + 1, side));
      return moves;
    });
  return places.map((place) => {
    const elements = byPlace.get(place) ?? [];
    return {
      place,
      elements: elements
        .sort((a, b) => a.rank - b.rank)
        .map(({ rank: _, spec, ...element }) => ({ ...element, also: also(spec, place) })),
    };
  });
}

/**
 * `layout` with each zone's rows numbered from one in the order `plugins` shows them, both sides'
 * lists moving with their row. A row showing nothing on either side goes, with whatever its lists
 * held (D122, D127). The same object where nothing changes.
 */
export function compactRows(layout: Layout, plugins: readonly LayoutPlugin[]): Layout {
  const shown = layoutView(layout, plugins).map((g) => g.place);
  const renumbered = new Map<string, number>();
  for (const zone of ZONE_NAMES) {
    for (const [i, row] of rowNumbers(shown, zone).entries()) {
      renumbered.set(rowPlace(zone, row), i + 1);
    }
  }
  const lists = new Map<string, readonly string[]>();
  let changed = false;
  for (const [place, names] of Object.entries(layout)) {
    const row = rowOf(place);
    const n = row === null ? undefined : renumbered.get(rowPlace(row.zone, row.row));
    const to = row === null ? place : n === undefined ? undefined : rowPlace(row.zone, n, row.side);
    if (to !== place) changed = true;
    if (to !== undefined) lists.set(to, names);
  }
  return changed ? Object.fromEntries(lists) : layout;
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
  // Everything back to its default, unresolved entries included, as Save writes it.
  if (sameLayout(to, {})) return sameLayout(from, {}) ? [] : ["rigline layout reset"];
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
  if (placement === null || offers(spec, placement)) return null;
  return (
    `${name} cannot go ${placementLabel(placement)}; ` +
    `it can go ${spec.placements.map(placementLabel).join(" or ")}`
  );
}
