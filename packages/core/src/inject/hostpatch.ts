/**
 * Applying a plugin's declared host-bundle byte substitutions, entirely over Buffers (D25).
 *
 * `extension.js` is rebuilt from `extension.js.orig` plus every enabled plugin's declared patches
 * on every install, rather than patched incrementally, so `find` always sees the bytes the
 * extension shipped and applying the same declarations twice in a row produces the same bytes
 * both times. Callers must pass the extension's own pristine bytes here, never the live file as it
 * stands: the live file may already carry a previous install's substitutions, and locating an
 * anchor inside output this module produced itself would not be idempotent.
 */
import type { HostPatch } from "@rigline/plugin-api";

/** One plugin's declared substitution, named by the plugin that declared it. */
export interface DeclaredPatch {
  readonly plugin: string;
  readonly patch: HostPatch;
}

/**
 * What became of one declared patch. Kept so the webview can act on it without reading
 * `extension.js` itself: the CSP has no `connect-src`, and the only process that ever tried to
 * apply the patch is the installer, so it is the only one that can say whether it landed.
 */
export interface PatchOutcome {
  readonly plugin: string;
  readonly why: string;
  readonly required: boolean;
  readonly applied: boolean;
  readonly reason?: string;
}

interface Located {
  readonly declared: DeclaredPatch;
  readonly start: number;
  readonly end: number;
}

/** Every byte offset `needle` occurs at in `haystack`. */
function occurrences(haystack: Buffer, needle: Buffer): number[] {
  const found: number[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found.push(at);
    at = haystack.indexOf(needle, at + 1);
  }
  return found;
}

function addOverlap(map: Map<Located, Set<string>>, loc: Located, plugin: string): void {
  const existing = map.get(loc);
  if (existing) {
    existing.add(plugin);
  } else {
    map.set(loc, new Set([plugin]));
  }
}

/**
 * Substitutes every declared patch that locates cleanly in a copy of `pristine`, and reports one
 * outcome per declared patch, in the order given.
 *
 * An anchor that matches nowhere and one that matches more than once are the same class of drift:
 * both mean the bundle this was written against no longer holds a single, unambiguous site, and
 * guessing which of several matches was meant would patch a location nobody reviewed. Two patches
 * whose located ranges overlap are refused on both sides, each naming every plugin it overlaps,
 * because nothing here defines how two substitutions of the same bytes compose, and silently
 * preferring one would make the outcome depend on discovery order. Every other located patch is
 * written at its offset into a fresh copy of `pristine`; offsets never move because a patch's
 * `replace` is validated to keep `find`'s exact byte length when the manifest is read.
 */
export function applyPatches(
  pristine: Buffer,
  declared: readonly DeclaredPatch[],
): { bytes: Buffer; outcomes: PatchOutcome[] } {
  const outcomes = new Map<DeclaredPatch, PatchOutcome>();
  const located: Located[] = [];

  for (const d of declared) {
    const needle = Buffer.from(d.patch.find, "utf8");
    const hits = occurrences(pristine, needle);
    const required = d.patch.required ?? false;
    if (hits.length === 0) {
      outcomes.set(d, {
        plugin: d.plugin,
        why: d.patch.why,
        required,
        applied: false,
        reason: "anchor not found in the host bundle",
      });
      continue;
    }
    if (hits.length > 1) {
      outcomes.set(d, {
        plugin: d.plugin,
        why: d.patch.why,
        required,
        applied: false,
        reason: "anchor matches in more than one place",
      });
      continue;
    }
    const start = hits[0] as number;
    located.push({ declared: d, start, end: start + needle.length });
  }

  const overlapsWith = new Map<Located, Set<string>>();
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i] as Located;
      const b = located[j] as Located;
      const disjoint = a.end <= b.start || b.end <= a.start;
      if (!disjoint) {
        addOverlap(overlapsWith, a, b.declared.plugin);
        addOverlap(overlapsWith, b, a.declared.plugin);
      }
    }
  }

  const bytes = Buffer.from(pristine);
  for (const loc of located) {
    const others = overlapsWith.get(loc);
    const required = loc.declared.patch.required ?? false;
    if (others) {
      outcomes.set(loc.declared, {
        plugin: loc.declared.plugin,
        why: loc.declared.patch.why,
        required,
        applied: false,
        reason: `overlaps a patch declared by ${[...others].join(", ")}`,
      });
      continue;
    }
    bytes.write(loc.declared.patch.replace, loc.start, "utf8");
    outcomes.set(loc.declared, {
      plugin: loc.declared.plugin,
      why: loc.declared.patch.why,
      required,
      applied: true,
    });
  }

  return { bytes, outcomes: declared.map((d) => outcomes.get(d) as PatchOutcome) };
}

/**
 * Why `plugin` cannot load because of a host patch, or null. Only a required patch refuses: an
 * optional one that did not apply leaves a plugin that works without it, which is the entire point
 * of declaring a patch optional.
 */
export function patchRefusal(plugin: string, outcomes: readonly PatchOutcome[]): string | null {
  const failed = outcomes.find((o) => o.plugin === plugin && o.required && !o.applied);
  return failed ? `required host patch did not apply: ${failed.reason}` : null;
}
