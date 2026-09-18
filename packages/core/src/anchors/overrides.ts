/**
 * `~/.rigline/anchors.json`: the local anchor override (decisions.md, D44).
 *
 * The shipped anchor table is the only thing in Rigline that can repair a plugin whose author has
 * not touched it, and it publishes at npm's cadence against an extension that updates weekly. This
 * file closes that gap: a few lines posted in an issue thread reach a user the day the repair is
 * found, with no release and no round of maintainer republishing.
 *
 * An entry is a partial `AnchorSpec` over the shipped one plus a required `why`, so a repair states
 * what moved and nothing else. `null` takes a field back out, which is how a refinement that has
 * stopped refining is undone rather than replaced. A name the shipped table has not got is added
 * outright, and must carry what a spec requires.
 *
 * **Nothing here throws.** A file that will not parse is reported and ignored; one bad entry is
 * reported and dropped while the rest apply. This is a deliberate departure from `readConfig`,
 * which is loud about the same kind of mistake: config decides whether a plugin a person switched
 * off stays off, so continuing past a broken one would do the opposite of what they asked, while
 * the worst an ignored override can do is leave the anchor exactly where the shipped table left it.
 * User state is also neither of the two things allowed to cost every plugin its injection (D27),
 * and a file people paste into from an issue thread will be malformed sooner than most.
 */
import { existsSync, readFileSync } from "node:fs";
import { ANCHORS, type AnchorSpec, SURFACES } from "@rigline/plugin-api";
import type { Classes } from "../layers/index.ts";
import { riglinePaths } from "../paths.ts";
import { type AnchorTable, resolveAnchors } from "./resolve.ts";

/** The fields an entry may carry, beyond `why`. Anything else is a typo, and says so. */
const SPEC_FIELDS = [
  "module",
  "local",
  "kind",
  "description",
  "refine",
  "within",
  "knownSites",
  "surfaces",
  "when",
] as const;

/** What a spec cannot be without, and so what an entry adding a name has to supply. */
const REQUIRED_FIELDS = ["module", "local", "kind", "description"] as const;

/** The fields `null` may take back out. The required four are not among them. */
const CLEARABLE = new Set<string>(["refine", "within", "knownSites", "surfaces", "when"]);

const KINDS = ["singleton", "collection", "style"];

/** The file, read and merged over the shipped table. */
export interface AnchorOverrides {
  /** The file it was read from, for a report that has to name what somebody edits. */
  readonly path: string;
  readonly present: boolean;
  /** The shipped table with every valid entry merged in: the table resolution uses. */
  readonly table: AnchorTable;
  /** The names the file changes, in file order. Entries that were dropped are not here. */
  readonly names: readonly string[];
  /** Those of `names` the shipped table has not got at all. */
  readonly added: readonly string[];
  /** What is wrong with the file, one self-contained sentence each. */
  readonly problems: readonly string[];
}

/** What one override entry does to one extension version's resolution. */
export interface AnchorOverrideOutcome {
  readonly name: string;
  /** The shipped table has no anchor of this name; the entry adds one. */
  readonly added: boolean;
  /** Whether this version resolves the name with the override applied. */
  readonly resolves: boolean;
  /**
   * Whether it resolved without one. Both true is an override doing nothing the shipped table does
   * not already do; true and false is a local file having broken a working anchor, which is silent
   * in every other report and gets blamed on the extension.
   */
  readonly resolvedWithout: boolean;
}

/** No file, no overrides: the shipped table, unchanged. */
export const NO_ANCHOR_OVERRIDES: AnchorOverrides = Object.freeze({
  path: "",
  present: false,
  table: ANCHORS,
  names: [] as readonly string[],
  added: [] as readonly string[],
  problems: [] as readonly string[],
});

/**
 * Reads `~/.rigline/anchors.json` and merges it over the shipped table.
 *
 * An absent file is the ordinary case, not a problem: almost nobody has one, and the ones who do
 * wrote it in the hour after an extension update broke something.
 */
export function readAnchorOverrides(path: string = riglinePaths().anchors): AnchorOverrides {
  if (!existsSync(path)) {
    return { ...NO_ANCHOR_OVERRIDES, path };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ...NO_ANCHOR_OVERRIDES,
      path,
      present: true,
      problems: [`${path} is not valid JSON, so no override applies: ${(error as Error).message}`],
    };
  }
  return mergeAnchorOverrides(ANCHORS, raw, path);
}

/**
 * `base` with every valid entry of `raw` merged in. Separate from the read so that a rule about the
 * file can be tested against a table rather than against whatever this machine has installed.
 */
export function mergeAnchorOverrides(
  base: AnchorTable,
  raw: unknown,
  path: string,
): AnchorOverrides {
  const problems: string[] = [];
  const entries = entriesOf(raw, path, problems);
  const table: Record<string, AnchorSpec> = { ...base };
  const names: string[] = [];
  const added: string[] = [];

  for (const [name, value] of entries) {
    const spec = specOf(name, value, base[name], path, problems);
    if (spec === null) continue;
    if (base[name] === undefined) added.push(name);
    table[name] = spec;
    names.push(name);
  }

  // After the merge rather than during it, because an entry may legitimately name an ancestor a
  // later entry adds. A `within` that resolves to nothing is dropped rather than left to fail as
  // "sits within X, which does not resolve in this extension" — true of every version, and a
  // sentence that sends somebody looking at the extension for a mistake in their own file.
  for (const name of [...names]) {
    const problem = containmentProblem(name, table, path);
    if (problem === null) continue;
    problems.push(problem);
    const original = base[name];
    if (original === undefined) {
      delete table[name];
      added.splice(added.indexOf(name), 1);
    } else {
      table[name] = original;
    }
    names.splice(names.indexOf(name), 1);
  }

  return { path, present: true, table, names, added, problems };
}

/** What one extension version's class map makes of each entry, in file order. */
export function anchorOverrideOutcomes(
  classes: Classes,
  overrides: AnchorOverrides,
): AnchorOverrideOutcome[] {
  if (overrides.names.length === 0) return [];
  const merged = resolveAnchors(classes, overrides.table);
  // The same harvest against the table as shipped, which is the only way to say whether an entry
  // repairs anything. Two resolutions of twenty-odd names each; the report is worth more.
  const shipped = resolveAnchors(classes, ANCHORS);
  return overrides.names.map((name) => ({
    name,
    added: overrides.added.includes(name),
    resolves: (merged.classes[name] ?? null) !== null,
    resolvedWithout: (shipped.classes[name] ?? null) !== null,
  }));
}

/** The `anchors` object as name/value pairs, or nothing plus a reason. */
function entriesOf(raw: unknown, path: string, problems: string[]): [string, unknown][] {
  if (!isObject(raw)) {
    problems.push(`${path} must be a JSON object, so no override applies`);
    return [];
  }
  const anchors = raw.anchors;
  if (anchors === undefined) {
    problems.push(`${path} has no "anchors" object, so no override applies`);
    return [];
  }
  if (!isObject(anchors)) {
    problems.push(`${path}: "anchors" must be an object of anchor name to entry`);
    return [];
  }
  return Object.entries(anchors);
}

/**
 * One entry merged over the spec it overrides, or null with its problems recorded.
 *
 * Every problem is collected rather than the first returned, because the entry is dropped either
 * way and a person editing a file by hand is owed the whole list.
 */
function specOf(
  name: string,
  value: unknown,
  base: AnchorSpec | undefined,
  path: string,
  problems: string[],
): AnchorSpec | null {
  const at = `${path}: "${name}"`;
  const mine: string[] = [];
  if (!isObject(value)) {
    problems.push(`${at} must be an object`);
    return null;
  }

  const found = Object.keys(value).filter(
    (key) => key !== "why" && !(SPEC_FIELDS as readonly string[]).includes(key),
  );
  if (found.length > 0) {
    mine.push(
      `${at} has no field ${found.map((k) => `"${k}"`).join(", ")}; an entry carries ` +
        `"why" and any of ${SPEC_FIELDS.join(", ")}`,
    );
  }

  if (typeof value.why !== "string" || value.why.trim().length === 0) {
    // Required for the reason a host patch's is: this is the thing that gets pasted into an issue
    // thread and copied by strangers, and the next person to read it needs to know what it repaired.
    mine.push(`${at} needs a "why" saying what this override repairs`);
  }

  const merged: Record<string, unknown> = { ...base };
  for (const field of SPEC_FIELDS) {
    if (!(field in value)) continue;
    const given = value[field];
    if (given === null) {
      if (!CLEARABLE.has(field)) {
        mine.push(`${at} cannot clear "${field}", which every anchor needs`);
        continue;
      }
      delete merged[field];
      continue;
    }
    const problem = fieldProblem(field, given);
    if (problem !== null) {
      mine.push(`${at}.${field} ${problem}`);
      continue;
    }
    merged[field] = given;
  }

  const missing = REQUIRED_FIELDS.filter((field) => merged[field] === undefined);
  if (missing.length > 0) {
    mine.push(
      base === undefined
        ? `${at} adds an anchor the table has not got, so it needs ${missing.join(", ")}`
        : `${at} left ${missing.join(", ")} unset`,
    );
  }

  problems.push(...mine);
  return mine.length > 0 ? null : (merged as unknown as AnchorSpec);
}

/** Why one field's value is not what that field takes, or null. */
function fieldProblem(field: (typeof SPEC_FIELDS)[number], value: unknown): string | null {
  switch (field) {
    case "kind":
      return KINDS.includes(value as string) ? null : `must be one of ${KINDS.join(", ")}`;
    case "surfaces":
      return Array.isArray(value) &&
        value.length > 0 &&
        value.every((s) => (SURFACES as readonly string[]).includes(s as string))
        ? null
        : `must be a non-empty array of ${SURFACES.join(", ")}`;
    case "knownSites":
      return knownSitesProblem(value);
    default:
      return typeof value === "string" && value.length > 0 ? null : "must be a non-empty string";
  }
}

/**
 * `knownSites` is the other of exactly two discharges for an ambiguous singleton (D7), so it is
 * overridable — and it keeps its `why` here for the same reason it has one in the table: a bare
 * count invites bumping without looking.
 */
function knownSitesProblem(value: unknown): string | null {
  if (!isObject(value)) return "must be an object with count and why";
  const { count, why } = value;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    return "needs an integer count of 1 or more";
  }
  if (typeof why !== "string" || why.trim().length === 0) {
    return "needs a why saying how the extra application sites were accounted for";
  }
  return null;
}

/** Why one entry's `within` chain does not stand up in the merged table, or null. */
function containmentProblem(name: string, table: AnchorTable, path: string): string | null {
  const seen = new Set<string>([name]);
  let current = table[name]?.within;
  while (current !== undefined) {
    const ancestor = table[current];
    if (ancestor === undefined) {
      return `${path}: "${name}" sits within "${current}", which is not an anchor`;
    }
    if (ancestor.kind === "style") {
      return `${path}: "${name}" sits within "${current}", which is a style to borrow rather than an element`;
    }
    if (seen.has(current)) {
      return `${path}: "${name}" sits within itself, through ${[...seen].join(" -> ")}`;
    }
    seen.add(current);
    current = ancestor.within;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
