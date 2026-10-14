/**
 * A layout preset as the registry carries it (D131). Baked by `install`, read by the panel's
 * editor, so the one shape the bake defines has one definition — as `save.ts` is for a Save.
 *
 * The engine's own `Preset` is richer: it holds the file's path and what the file claims about the
 * plugins it names, neither of which the panel can act on. Only a terminal can install a plugin, and
 * a terminal already prints the claim.
 */
import type { Layout } from "./layout.ts";

export interface BakedPreset {
  /** The name a person types, and what `apply` is keyed on; unique, the directories being deduped. */
  readonly name: string;
  /** Whether it is a person's own or shipped inside the engine, which groups the list. */
  readonly origin: "yours" | "shipped";
  readonly description: string | null;
  /** Why it cannot be read, which makes it a row saying so rather than an absence. */
  readonly problem: string | null;
  /** Empty for one that cannot be read, which nothing applies. */
  readonly layout: Layout;
}

/**
 * The most presets of a person's own that are baked, beyond the shipped ones, which are always in.
 *
 * Deliberately not near `MAX_PRESET_BYTES`, which is 64 KB *per file*: a total under that would let
 * one file the engine accepts push out every other preset somebody owns.
 */
export const MAX_BAKED_PRESETS = 32;

/** The most baked JSON the presets may come to, well above 32 of any realistic one. */
export const MAX_BAKED_PRESET_BYTES = 256 * 1024;

/** Whether a baked preset is one a person can apply, rather than a row saying why it cannot. */
export function isApplicable(preset: BakedPreset): boolean {
  return preset.problem === null;
}
