import { ANCHORS } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import { anchorViolation, resolveAnchors } from "./resolve.ts";

const mapWith = (...pairs: [module: string, local: string][]) => {
  const map: Record<string, Record<string, string>> = {};
  for (const [module, local] of pairs) {
    map[module] ??= {};
    map[module][local] = `${local}_${module}`;
  }
  return map;
};

describe("resolveAnchors", () => {
  it("resolves an anchor to the module-scoped class and reports the rest as missing", () => {
    const { module, local } = ANCHORS.modelPill;
    const resolved = resolveAnchors(mapWith([module, local]));
    expect(resolved.classes.modelPill).toBe(`${local}_${module}`);
    expect(resolved.classes.transcriptRow).toBeNull();
    expect(resolved.missing).toContain("transcriptRow");
    expect(resolved.missing).not.toContain("modelPill");
  });

  it("does not resolve a same-named class from another module", () => {
    // `message` is defined in several modules; only the transcript's module counts.
    const resolved = resolveAnchors(mapWith(["ZZZZZZ", "message"]));
    expect(resolved.classes.transcriptRow).toBeNull();
  });

  it("names the pair when an anchor is missing, and rejects a name not in the table", () => {
    const resolved = resolveAnchors({});
    expect(anchorViolation("modelPill", resolved)).toBe(
      'anchor "modelPill" (gGYT1w.modelPill) is not in this extension',
    );
    expect(anchorViolation("nonsense", resolved)).toBe('unknown anchor "nonsense"');
    const ok = resolveAnchors(mapWith(["gGYT1w", "modelPill"]));
    expect(anchorViolation("modelPill", ok)).toBeNull();
  });
});
