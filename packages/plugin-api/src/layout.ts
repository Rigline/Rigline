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

/** A plugin as the layout sees it. */
export interface LayoutPlugin {
  readonly name: string;
  readonly elements: Elements;
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
