import { describe, expect, it } from "vitest";
import { applyPatches, type DeclaredPatch, patchRefusal } from "./hostpatch.ts";

function patch(plugin: string, find: string, replace: string, required = false): DeclaredPatch {
  return { plugin, patch: { find, replace, why: `${plugin} needs it`, required } };
}

describe("applyPatches", () => {
  it("substitutes a unique anchor and leaves everything else byte-identical", () => {
    const pristine = Buffer.from("before[TARGET]after", "utf8");
    const { bytes, outcomes } = applyPatches(pristine, [patch("a", "[TARGET]", "[PATCH!]")]);

    expect(bytes.length).toBe(pristine.length);
    expect(bytes.toString("utf8")).toBe("before[PATCH!]after");
    expect(outcomes).toEqual([{ plugin: "a", why: "a needs it", required: false, applied: true }]);
  });

  it("does not mutate the caller's buffer", () => {
    const pristine = Buffer.from("before[TARGET]after", "utf8");
    const original = Buffer.from(pristine);

    applyPatches(pristine, [patch("a", "[TARGET]", "[PATCH!]")]);

    expect(pristine).toEqual(original);
  });

  it("reports an anchor that is not found, without touching the bytes", () => {
    const pristine = Buffer.from("nothing relevant here", "utf8");

    const { bytes, outcomes } = applyPatches(pristine, [patch("a", "[TARGET]", "[PATCH!]")]);

    expect(bytes).toEqual(pristine);
    expect(outcomes[0]?.applied).toBe(false);
    expect(outcomes[0]?.reason).toMatch(/not found/);
  });

  it("refuses an anchor that matches in more than one place, rather than guessing", () => {
    const pristine = Buffer.from("[TARGET]...[TARGET]", "utf8");

    const { bytes, outcomes } = applyPatches(pristine, [patch("a", "[TARGET]", "[PATCH!]")]);

    expect(bytes).toEqual(pristine);
    expect(outcomes[0]?.applied).toBe(false);
    expect(outcomes[0]?.reason).toMatch(/more than one place/);
  });

  it("applies several non-overlapping patches correctly regardless of declaration order", () => {
    const pristine = Buffer.from("[ONE][TWO][THREE]", "utf8");
    const patches = [
      patch("a", "[ONE]", "[111]"),
      patch("b", "[TWO]", "[222]"),
      patch("c", "[THREE]", "[33333]"),
    ];

    const forward = applyPatches(pristine, patches);
    const backward = applyPatches(pristine, [...patches].reverse());

    expect(forward.bytes.toString("utf8")).toBe("[111][222][33333]");
    expect(backward.bytes).toEqual(forward.bytes);
  });

  it("refuses both sides of an overlapping pair, each naming the other plugin, and touches neither", () => {
    // "[ABCDEF]": "one" locates "ABC" at [1,4), "two" locates "CDE" at [3,6) — they share byte 3.
    const pristine = Buffer.from("[ABCDEF]", "utf8");

    const { bytes, outcomes } = applyPatches(pristine, [
      patch("one", "ABC", "xyz"),
      patch("two", "CDE", "cde"),
    ]);

    expect(bytes).toEqual(pristine);
    expect(outcomes[0]?.applied).toBe(false);
    expect(outcomes[0]?.reason).toBe("overlaps a patch declared by two");
    expect(outcomes[1]?.applied).toBe(false);
    expect(outcomes[1]?.reason).toBe("overlaps a patch declared by one");
  });

  it("does not treat two patches to different, non-overlapping locations as a conflict", () => {
    const pristine = Buffer.from("[ONE]---[TWO]", "utf8");

    const { bytes, outcomes } = applyPatches(pristine, [
      patch("a", "[ONE]", "[111]"),
      patch("b", "[TWO]", "[222]"),
    ]);

    expect(bytes.toString("utf8")).toBe("[111]---[222]");
    expect(outcomes.every((o) => o.applied)).toBe(true);
  });

  it("one plugin's unusable patch does not block another plugin's valid patch", () => {
    const pristine = Buffer.from("[TARGET]", "utf8");

    const { bytes, outcomes } = applyPatches(pristine, [
      patch("bad", "[MISSING]", "[XXXXXXX]"),
      patch("good", "[TARGET]", "[PATCH!]"),
    ]);

    expect(bytes.toString("utf8")).toBe("[PATCH!]");
    expect(outcomes[0]?.applied).toBe(false);
    expect(outcomes[1]?.applied).toBe(true);
  });
});

describe("patchRefusal", () => {
  it("refuses the plugin whose required patch failed", () => {
    const { outcomes } = applyPatches(Buffer.from("nothing", "utf8"), [
      patch("a", "[MISSING]", "[XXXXXXX]", true),
    ]);

    expect(patchRefusal("a", outcomes)).toBe(
      "required host patch did not apply: anchor not found in the host bundle",
    );
  });

  it("does not refuse a plugin whose optional patch failed", () => {
    const { outcomes } = applyPatches(Buffer.from("nothing", "utf8"), [
      patch("a", "[MISSING]", "[XXXXXXX]", false),
    ]);

    expect(patchRefusal("a", outcomes)).toBeNull();
  });

  it("returns null for a plugin with no patches, or one whose patch succeeded", () => {
    const { outcomes } = applyPatches(Buffer.from("[TARGET]", "utf8"), [
      patch("a", "[TARGET]", "[PATCH!]", true),
    ]);

    expect(patchRefusal("a", outcomes)).toBeNull();
    expect(patchRefusal("nobody", outcomes)).toBeNull();
  });
});
