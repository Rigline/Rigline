/**
 * The manifest, `prototype.json`: what a plugin depends on, as data.
 *
 * Read by the installer and by the loader without evaluating the plugin, which is why it is JSON
 * rather than a JS export: module evaluation is exactly where a broken plugin throws, and the
 * installer's job is to say what an extension update broke, per plugin, before anything runs
 * (decisions.md, D12, D14).
 *
 * Every dependency sits under `uses`, one key per capability. The shape of each value is checked
 * here by that capability's contract; whether the identifiers it names exist in the installed
 * extension is checked separately, against the harvested tables, by `capabilityViolation`. Shape
 * problems are authoring mistakes and fail the install loudly; a missing identifier is version
 * skew and refuses one plugin.
 */
import type { AnchorName, Surface } from "./anchors.ts";
import { CONTRACTS } from "./capabilities/index.ts";
import type { Uses } from "./capabilities/types.ts";
import type { MessageType, ModuleClasses, ModuleId, OutboundFields } from "./generated.ts";

export type { Uses, UsesKey } from "./capabilities/types.ts";

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
  readonly uses?: {
    readonly anchors?: readonly AnchorName[];
    readonly classes?: { readonly [M in ModuleId]?: readonly ModuleClasses[M][] };
    readonly messages?: readonly MessageType[];
    readonly rewrites?: { readonly [T in keyof OutboundFields]?: readonly OutboundFields[T][] };
    readonly mount?: boolean;
    readonly style?: boolean;
    readonly tools?: boolean;
    readonly session?: boolean;
    readonly transcript?: boolean;
  };
  readonly patches?: readonly HostPatch[];
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
  readonly patches: readonly HostPatch[];
}

export const EMPTY_USES: Uses = Object.freeze({
  anchors: [],
  classes: {},
  messages: [],
  rewrites: {},
  mount: false,
  style: false,
  tools: false,
  session: false,
  transcript: false,
});

/** A valid name is what npm accepts as an unscoped package name segment and what a directory can be called. */
const NAME = /^[a-z0-9][a-z0-9._-]{0,213}$/;

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
    return { manifest: null, problems: ["prototype.json must be a JSON object"] };
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

  const uses: Record<string, unknown> = { ...EMPTY_USES };
  const rawUses = value.uses;
  if (rawUses !== undefined && !isRecord(rawUses)) {
    problems.push('"uses" must be an object');
  } else if (rawUses !== undefined) {
    const known = new Set<string>(CONTRACTS.map((c) => c.key));
    for (const key of Object.keys(rawUses)) {
      if (!known.has(key)) problems.push(`"uses.${key}" is not a capability`);
    }
    for (const contract of CONTRACTS) {
      const raw = rawUses[contract.key];
      if (raw === undefined) continue;
      const problem = contract.shape(raw);
      if (problem) problems.push(`"uses.${contract.key}" ${problem}`);
      else uses[contract.key] = raw;
    }
  }

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
