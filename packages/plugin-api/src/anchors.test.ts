import { describe, expect, it } from "vitest";
import { ANCHOR_NAMES, ANCHORS, type AnchorName, type AnchorSpec } from "./anchors.ts";

/**
 * What the table must be true about itself, as against what it claims about the extension — that
 * is core's corpus test, which resolves every entry against real bundles.
 *
 * These are the invariants a type cannot state. `within` is typed `string` to keep the table from
 * circularly referencing its own key union, so "the ancestor exists, is an element, and no chain of
 * them loops" is asserted here; and a `refine` is pasted into a selector the host queries with, so
 * the ways a refinement can quietly widen that selector instead of narrowing it are asserted here
 * too. A comma is the one that matters: `.x, .y` is not a narrower `.x`, it is everything.
 */
describe("the anchor table", () => {
  const entries = ANCHOR_NAMES.map((name) => [name, ANCHORS[name] as AnchorSpec] as const);

  it("gives every entry a module hash, a local name and a description", () => {
    for (const [name, spec] of entries) {
      expect(spec.module, name).toMatch(/^[-_A-Za-z0-9]{6}$/);
      expect(spec.local, name).not.toBe("");
      expect(spec.description, name).not.toBe("");
    }
  });

  it("names no pair twice, because two names for one class would drift apart", () => {
    const pairs = entries.map(([, spec]) => `${spec.module}.${spec.local}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("keeps refinements and containment off the style anchors, which are never queried", () => {
    for (const [name, spec] of entries) {
      if (spec.kind !== "style") continue;
      expect(spec.refine, name).toBeUndefined();
      expect(spec.within, name).toBeUndefined();
    }
  });

  it("refines with a suffix selector and nothing that could widen it", () => {
    for (const [name, spec] of entries) {
      if (spec.refine === undefined) continue;
      // A comma makes the selector a list, which matches more rather than less — the one
      // refinement mistake that turns the whole mechanism inside out.
      expect(spec.refine, name).not.toContain(",");
      // A combinator would reach past the element the refinement is meant to be describing.
      expect(spec.refine, name).not.toMatch(/[\s>+~]/);
      // Attribute, pseudo-class or a second literal class: anything else is not a suffix.
      expect(spec.refine, name).toMatch(/^[[:.]/);
      // A hashed class would need resolving, and a refinement is not resolved.
      expect(spec.refine, name).not.toMatch(/_[-_A-Za-z0-9]{6}(?![\w-])/);
    }
  });

  it("keeps `knownSites` to singletons, above the default, and never without a reason", () => {
    for (const [name, spec] of entries) {
      if (spec.knownSites === undefined) continue;
      // Only a singleton claims to be one element, so only a singleton can acknowledge references
      // that are not it. On anything else the field would read as documentation and check nothing.
      expect(spec.kind, name).toBe("singleton");
      // One is the default. Stating it acknowledges nothing and reads as though it did.
      expect(spec.knownSites.count, name).toBeGreaterThan(1);
      // A refinement is the better answer wherever there is something to refine against; carrying
      // both means the acknowledgement is dead weight, since a refined anchor is already exempt.
      expect(spec.refine, name).toBeUndefined();
      expect(spec.within, name).toBeUndefined();
      // The whole value of the field is that somebody wrote down what they read.
      expect(spec.knownSites.why.length, name).toBeGreaterThan(20);
    }
  });

  it("points every `within` at an element anchor that exists", () => {
    for (const [name, spec] of entries) {
      if (spec.within === undefined) continue;
      expect(ANCHOR_NAMES, name).toContain(spec.within);
      expect(ANCHORS[spec.within as AnchorName].kind, name).not.toBe("style");
      expect(spec.within, name).not.toBe(name);
    }
  });

  it("lets no chain of `within` loop", () => {
    for (const [name] of entries) {
      const seen = new Set<string>();
      let current: string | undefined = name;
      while (current !== undefined) {
        expect(seen, name).not.toContain(current);
        seen.add(current);
        current = (ANCHORS[current as AnchorName] as AnchorSpec).within;
      }
    }
  });

  // Sixteen, the fifteen the ambiguity measurement was taken over plus `footerSpacer` (D54). The
  // number is asserted so that adding an anchor is a deliberate act with a test to update, not so
  // that it stays at any particular value.
  it("holds the sixteen element anchors, so a new one cannot arrive unnoticed", () => {
    const elements = entries.filter(([, spec]) => spec.kind !== "style");
    expect(elements).toHaveLength(16);
    expect(
      elements.every(([, spec]) => spec.kind === "singleton" || spec.kind === "collection"),
    ).toBe(true);
  });
});
