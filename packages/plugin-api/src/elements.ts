/**
 * Elements: components a plugin contributes and its author places, until the user says otherwise
 * (D90). Declared under `elements` in `rigline.json`, bound in code with `ctx.element`.
 *
 * Top-level rather than under `uses`, because an element is a contribution and not a dependency. A
 * placement does rest on an anchor, but one the element can go without: an unavailable placement is
 * reported and the element renders nowhere, which is D41's verdict rather than a refusal.
 */
import { ANCHORS, type AnchorName, type AnchorSpec } from "./anchors.ts";
import { anchorsContract } from "./capabilities/anchors.ts";
import type { IdentifierTables } from "./tables.ts";

export interface ZoneSpec {
  /** The anchor the zone's row is kept last in. The zone's surfaces are this anchor's. */
  readonly anchor: AnchorName;
  /** What the panel calls it. */
  readonly title: string;
  readonly description: string;
}

/** The rows Rigline places for elements. */
export const ZONES = {
  rigRow: {
    anchor: "composerBox",
    title: "Rigline row",
    description: "A row at the foot of the composer box, under its controls.",
  },
} as const satisfies Record<string, ZoneSpec>;

export type ZoneName = keyof typeof ZONES;

export const ZONE_NAMES = Object.keys(ZONES) as readonly ZoneName[];

export type SlotPosition = "before" | "after" | "inside";

export const SLOT_POSITIONS: readonly SlotPosition[] = ["before", "after", "inside"];

/** Beside or inside one element the anchor table names. */
export interface AnchorSlot {
  readonly anchor: string;
  readonly at: SlotPosition;
}

/** A zone's name, or a slot at an anchor. */
export type Placement = string | AnchorSlot;

export interface ElementSpec {
  /** What the element is, for the person placing it. */
  readonly title: string;
  /** Every place it may go. Never empty. */
  readonly placements: readonly Placement[];
  /** Where it goes until the user says otherwise: one of `placements`, or null for off. */
  readonly default: Placement | null;
}

export type Elements = Readonly<Record<string, ElementSpec>>;

/** A placement as an author writes it, narrowed to the zones and anchors that exist. */
export type DeclaredPlacement =
  | ZoneName
  | { readonly anchor: AnchorName; readonly at: SlotPosition };

export interface DeclaredElement {
  readonly title: string;
  readonly placements: readonly DeclaredPlacement[];
  readonly default: DeclaredPlacement | null;
}

export const ELEMENT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";
const ELEMENT_ID = new RegExp(ELEMENT_ID_PATTERN);

const ELEMENT_FIELDS = ["title", "placements", "default"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSlot(value: unknown): value is AnchorSlot {
  return isRecord(value) && typeof value.anchor === "string" && typeof value.at === "string";
}

export function samePlacement(a: unknown, b: unknown): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return isSlot(a) && isSlot(b) && a.anchor === b.anchor && a.at === b.at;
}

/** How a placement reads in a sentence: `in rigRow`, `before footerSpacer`. */
export function placementLabel(placement: Placement): string {
  return typeof placement === "string" ? `in ${placement}` : `${placement.at} ${placement.anchor}`;
}

/**
 * Why `value` is not a placement, or null. A zone name is not checked here: an engine older than the
 * plugin may not know a zone, and that is a gap to report rather than a manifest to fail.
 */
function placementProblem(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? null : "must not be an empty zone name";
  if (!isRecord(value)) return 'must be a zone name or { "anchor", "at" }';
  for (const key of Object.keys(value)) {
    if (key !== "anchor" && key !== "at") return `has "${key}", which a placement does not`;
  }
  if (typeof value.anchor !== "string" || value.anchor.length === 0) {
    return 'needs "anchor", an anchor name';
  }
  if (!(SLOT_POSITIONS as readonly unknown[]).includes(value.at)) {
    return `needs "at", one of ${SLOT_POSITIONS.join(", ")}`;
  }
  const spec: AnchorSpec | undefined = ANCHORS[value.anchor as AnchorName];
  if (spec && spec.kind !== "singleton") {
    return `names "${value.anchor}", which is a ${spec.kind}; an element goes at one element`;
  }
  return null;
}

/** `elements` shape-checked, collecting a problem per mistake, with each well-formed entry kept. */
export function elementsOf(value: unknown, problems: string[]): Elements {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    problems.push('"elements" must be an object');
    return {};
  }
  const out: Record<string, ElementSpec> = {};
  for (const [id, raw] of Object.entries(value)) {
    const path = `elements.${id}`;
    if (!ELEMENT_ID.test(id)) {
      problems.push(`"${path}": an element id is lowercase letters, digits and hyphens`);
      continue;
    }
    if (!isRecord(raw)) {
      problems.push(`"${path}" must be an object`);
      continue;
    }
    const before = problems.length;
    for (const key of Object.keys(raw)) {
      if (!ELEMENT_FIELDS.includes(key)) problems.push(`"${path}.${key}" is not an element field`);
    }
    if (typeof raw.title !== "string" || raw.title.length === 0) {
      problems.push(`"${path}.title" must be a non-empty string`);
    }
    const placements = raw.placements;
    if (!Array.isArray(placements) || placements.length === 0) {
      problems.push(`"${path}.placements" must be a non-empty array`);
    } else {
      placements.forEach((placement, i) => {
        const problem = placementProblem(placement);
        if (problem) problems.push(`"${path}.placements[${i}]" ${problem}`);
        else if (placements.slice(0, i).some((earlier) => samePlacement(earlier, placement))) {
          problems.push(`"${path}.placements[${i}]" repeats an earlier placement`);
        }
      });
    }
    if (!("default" in raw)) {
      problems.push(`"${path}.default" is required: one of its placements, or null for off`);
    } else if (
      raw.default !== null &&
      !(Array.isArray(placements) && placements.some((p) => samePlacement(p, raw.default)))
    ) {
      problems.push(`"${path}.default" must be one of its placements, or null for off`);
    }
    if (problems.length === before) out[id] = raw as unknown as ElementSpec;
  }
  return out;
}

/** Why this extension, or this engine, cannot provide `placement`; null when it can. */
export function placementGap(placement: Placement, tables: IdentifierTables): string | null {
  if (typeof placement === "string") {
    if (!Object.hasOwn(ZONES, placement)) {
      return `"${placement}" is not a zone this version of Rigline has`;
    }
    return anchorsContract.gaps([ZONES[placement as ZoneName].anchor], tables)[0] ?? null;
  }
  return anchorsContract.gaps([placement.anchor], tables)[0] ?? null;
}

/** Every placement `tables` cannot provide, one line each. Reported, never a refusal (D41). */
export function elementGaps(elements: Elements, tables: IdentifierTables): string[] {
  const gaps: string[] = [];
  for (const [id, spec] of Object.entries(elements)) {
    for (const placement of spec.placements) {
      const why = placementGap(placement, tables);
      if (why !== null) gaps.push(`element "${id}" cannot go ${placementLabel(placement)}: ${why}`);
    }
  }
  return gaps;
}
