/**
 * The manifest, `rigline.json`: what a plugin depends on, as data.
 *
 * Read by the installer and by the loader without evaluating the plugin, which is why it is JSON
 * rather than a JS export: module evaluation is exactly where a broken plugin throws, and the
 * installer's job is to say what an extension update broke, per plugin, before anything runs
 * (decisions.md, D12, D14).
 *
 * Every dependency sits under `uses`, one key per capability, plus `uses.optional`, which carries
 * the same keys again for the dependencies a plugin can do without (D41). The shape of each value
 * is checked here by that capability's contract; whether the identifiers it names exist in the
 * installed extension is checked separately, against the harvested tables, by
 * `capabilityViolation` for the required half and `optionalGaps` for the optional one. Shape
 * problems are authoring mistakes and fail the install loudly; a missing required identifier is
 * version skew and refuses one plugin; a missing optional one is reported and refuses nothing.
 */
import type { AnchorName, Surface } from "./anchors.ts";
import { CONTRACTS } from "./capabilities/index.ts";
import type { Declarations, Uses } from "./capabilities/types.ts";
import { type DeclaredElement, type Elements, elementsOf } from "./elements.ts";
import type { MessageType, ModuleClasses, ModuleId, OutboundFields } from "./identifiers.ts";

export type { Declarations, Uses, UsesKey } from "./capabilities/types.ts";

/** One byte substitution in the extension-host bundle, applied by the installer (D25). */
export interface HostPatch {
  /** The exact bytes to find. Must occur exactly once in the extension's own bundle. */
  readonly find: string;
  /** The bytes to write in their place. Must be the same byte length as `find`. */
  readonly replace: string;
  /** What the patch buys and why it is needed. The bytes cannot say either for themselves. */
  readonly why: string;
  /** Refuse the plugin when the patch cannot apply, rather than loading it without. Default false. */
  readonly required?: boolean;
}

/**
 * The manifest as an author writes it, typed against the identifiers harvested from the extension
 * the types were generated from. The JSON on disk is validated at the data level by
 * `validateManifest`; this type exists so a `satisfies Manifest` in an editor completes names.
 */
export interface Manifest {
  /** The version of this shape and of `ctx`. Only 1 exists; it moves when a meaning changes, never for growth. */
  readonly api: 1;
  /** Must match the plugin's directory name. */
  readonly name: string;
  readonly description?: string;
  /** The built entry module, relative to the manifest. */
  readonly entry: string;
  /** The webview surfaces this plugin is for. Absent means all of them. */
  readonly surfaces?: readonly Surface[];
  readonly uses?: DeclaredUses & {
    /**
     * The same keys again, for what this plugin can do without. A name here that the installed
     * extension lacks is reported and costs the plugin that one decoration; the plugin still loads
     * (D41). Resolve these through `ctx.optional.anchor()` and `ctx.optional.cls()`, which return
     * `string | null` so the compiler makes the author handle the absence.
     */
    readonly optional?: DeclaredUses;
  };
  /** Components this plugin contributes, by id, each bound in code with `ctx.element` (D90). */
  readonly elements?: { readonly [id: string]: DeclaredElement };
  readonly patches?: readonly HostPatch[];
}

/**
 * One half of `uses` as an author writes it: every key optional, and every identifier narrowed to
 * what the author's own `generated.ts` harvested — or to `string` when they have not run codegen,
 * which is what lets a scaffold validate before it has one (D40).
 */
export interface DeclaredUses {
  readonly anchors?: readonly AnchorName[];
  readonly classes?: { readonly [M in ModuleId]?: readonly ModuleClasses[M][] };
  readonly messages?: readonly MessageType[];
  readonly rewrites?: { readonly [T in keyof OutboundFields]?: readonly OutboundFields[T][] };
  readonly mount?: boolean;
  readonly style?: boolean;
  readonly tools?: boolean;
  readonly session?: boolean;
  readonly transcript?: boolean;
  readonly menu?: boolean;
}

export const SURFACES: readonly Surface[] = ["editor", "sidebar", "sessionList"];

/** A manifest after validation: every `uses` key present with its empty value where the author omitted it. */
export interface ValidManifest {
  readonly api: 1;
  readonly name: string;
  readonly description: string | null;
  readonly entry: string;
  readonly surfaces: readonly Surface[];
  readonly uses: Uses;
  readonly elements: Elements;
  readonly patches: readonly HostPatch[];
}

/** One half of `uses` with every key present and empty: what an omitted declaration means. */
export const EMPTY_DECLARATIONS: Declarations = Object.freeze({
  anchors: [],
  classes: {},
  messages: [],
  rewrites: {},
  mount: false,
  style: false,
  tools: false,
  session: false,
  transcript: false,
  menu: false,
});

export const EMPTY_USES: Uses = Object.freeze({
  ...EMPTY_DECLARATIONS,
  optional: EMPTY_DECLARATIONS,
});

/**
 * A valid name is what npm accepts as an unscoped package name segment and what a directory can be
 * called. Exported as a source string as well, because the JSON schema needs the same rule and two
 * copies of a pattern is two rules waiting to disagree.
 */
export const NAME_PATTERN = "^[a-z0-9][a-z0-9._-]{0,213}$";
const NAME = new RegExp(NAME_PATTERN);

/** One half of `uses`, shape-checked contract by contract, with every omitted key left empty. */
function declarationsOf(
  raw: Record<string, unknown>,
  path: string,
  problems: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...EMPTY_DECLARATIONS };
  for (const contract of CONTRACTS) {
    const value = raw[contract.key];
    if (value === undefined) continue;
    const problem = contract.shape(value);
    if (problem) problems.push(`"${path}.${contract.key}" ${problem}`);
    else out[contract.key] = value;
  }
  return out;
}

/**
 * Identifiers named on both sides, which is an authoring mistake rather than version skew: a
 * required declaration already guarantees the identifier is there, so the optional one describes an
 * absence the plugin was refused for. Silently preferring the required reading would leave an
 * author's `ctx.optional.anchor()` null check looking load-bearing when it can never fire.
 */
function declaredTwice(
  required: Record<string, unknown>,
  optional: Record<string, unknown>,
): string[] {
  const both: string[] = [];
  for (const contract of CONTRACTS) {
    const a = required[contract.key];
    const b = optional[contract.key];
    if (Array.isArray(a) && Array.isArray(b)) {
      for (const name of b)
        if (a.includes(name)) both.push(`"${contract.key}" name ${JSON.stringify(name)}`);
    } else if (isRecord(a) && isRecord(b)) {
      for (const [key, values] of Object.entries(b)) {
        const mine = a[key];
        if (!Array.isArray(mine) || !Array.isArray(values)) continue;
        for (const name of values) {
          if (mine.includes(name)) both.push(`"${contract.key}" entry ${key}.${String(name)}`);
        }
      }
    } else if (a === true && b === true) {
      both.push(`"${contract.key}"`);
    }
  }
  return both;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Byte length without Node's Buffer, since this module also runs in the webview. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Every shape problem with `value` as a manifest for the plugin directory `dirName`, or the
 * validated manifest when there are none. Problems are collected rather than thrown one at a time
 * so an author fixes a manifest in one pass.
 */
export function validateManifest(
  value: unknown,
  dirName: string,
):
  | { readonly manifest: ValidManifest; readonly problems: readonly [] }
  | {
      readonly manifest: null;
      readonly problems: readonly string[];
    } {
  const problems: string[] = [];
  if (!isRecord(value)) {
    return { manifest: null, problems: ["rigline.json must be a JSON object"] };
  }

  if (value.api !== 1) problems.push(`"api" must be 1, got ${JSON.stringify(value.api)}`);

  const name = value.name;
  if (typeof name !== "string" || !NAME.test(name)) {
    problems.push(`"name" must be a lowercase package-name segment, got ${JSON.stringify(name)}`);
  } else if (name !== dirName) {
    problems.push(
      `"name" is ${JSON.stringify(name)} but the directory is ${JSON.stringify(dirName)}`,
    );
  }

  const description = value.description;
  if (description !== undefined && typeof description !== "string") {
    problems.push('"description" must be a string when present');
  }

  const entry = value.entry;
  if (typeof entry !== "string" || entry.length === 0) {
    problems.push('"entry" must be a non-empty relative path');
  } else if (entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry)) {
    problems.push('"entry" must be relative to the manifest');
  } else if (entry.split(/[\\/]/).includes("..")) {
    problems.push('"entry" must stay inside the plugin directory');
  }

  const surfaces = value.surfaces;
  if (surfaces !== undefined) {
    if (!Array.isArray(surfaces) || surfaces.length === 0) {
      problems.push('"surfaces" must be a non-empty array when present');
    } else {
      for (const s of surfaces) {
        if (!(SURFACES as readonly unknown[]).includes(s)) {
          problems.push(
            `"surfaces" contains ${JSON.stringify(s)}; expected ${SURFACES.join(", ")}`,
          );
        }
      }
    }
  }

  const rawUses = value.uses;
  let required: Record<string, unknown> = { ...EMPTY_DECLARATIONS };
  let optional: Record<string, unknown> = { ...EMPTY_DECLARATIONS };
  if (rawUses !== undefined && !isRecord(rawUses)) {
    problems.push('"uses" must be an object');
  } else if (rawUses !== undefined) {
    // `optional` is the one key of `uses` that is not a capability: it is the same nine keys again,
    // read for a different verdict (D41). Checking it by recursion keeps the shape rules in one
    // place, and the depth is fixed at one because `optional.optional` is not a capability either.
    const known = new Set<string>([...CONTRACTS.map((c) => c.key), "optional"]);
    for (const key of Object.keys(rawUses)) {
      if (!known.has(key)) problems.push(`"uses.${key}" is not a capability`);
    }
    required = declarationsOf(rawUses, "uses", problems);

    const rawOptional = rawUses.optional;
    if (rawOptional !== undefined && !isRecord(rawOptional)) {
      problems.push('"uses.optional" must be an object');
    } else if (rawOptional !== undefined) {
      for (const key of Object.keys(rawOptional)) {
        if (key === "optional" || !known.has(key)) {
          problems.push(`"uses.optional.${key}" is not a capability`);
        }
      }
      optional = declarationsOf(rawOptional, "uses.optional", problems);
      for (const both of declaredTwice(required, optional)) {
        problems.push(
          `${both} is declared both required and optional; a required declaration already covers it`,
        );
      }
    }
  }
  const uses: Record<string, unknown> = { ...required, optional };

  const elements = elementsOf(value.elements, problems);

  const patches = value.patches;
  const validPatches: HostPatch[] = [];
  if (patches !== undefined) {
    if (!Array.isArray(patches)) {
      problems.push('"patches" must be an array when present');
    } else {
      patches.forEach((patch, i) => {
        const problem = patchShapeProblem(patch);
        if (problem) problems.push(`"patches[${i}]" ${problem}`);
        else validPatches.push(patch as HostPatch);
      });
    }
  }

  if (problems.length > 0) return { manifest: null, problems };
  return {
    manifest: {
      api: 1,
      name: name as string,
      description: (description as string | undefined) ?? null,
      entry: entry as string,
      surfaces: (surfaces as Surface[] | undefined) ?? [...SURFACES],
      uses: uses as unknown as Uses,
      elements,
      patches: validPatches,
    },
    problems: [],
  };
}

/**
 * Why `patch` is not a well-formed host patch, or null. The equal-length rule is what everything
 * downstream rests on: matches are located in the pristine bundle before any is written, so a
 * substitution that changed length would invalidate every offset after it.
 */
export function patchShapeProblem(patch: unknown): string | null {
  if (!isRecord(patch)) return "must be an object";
  for (const field of ["find", "replace", "why"] as const) {
    const v = patch[field];
    if (typeof v !== "string" || v.length === 0) return `needs a non-empty string "${field}"`;
  }
  const find = patch.find as string;
  const replace = patch.replace as string;
  if (byteLength(find) !== byteLength(replace)) {
    return `"replace" must be the same byte length as "find" (a substitution that resizes the bundle moves every offset after it)`;
  }
  if (find === replace) return '"find" and "replace" are identical, so it patches nothing';
  if (patch.required !== undefined && typeof patch.required !== "boolean") {
    return '"required" must be a boolean when present';
  }
  return null;
}
