/**
 * The committed schema against the registry it is built from, and the schema against the validator
 * it restates. Two statements of one rule need a test that asks them the same questions.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTRACTS } from "./capabilities/index.ts";
import { validateManifest } from "./manifest.ts";
import { manifestSchema, manifestSchemaJson } from "./schema.ts";

const COMMITTED = fileURLToPath(new URL("../schema/manifest.json", import.meta.url));

type JsonObject = Record<string, unknown>;

function properties(of: unknown): JsonObject {
  return (of as JsonObject).properties as JsonObject;
}

describe("the committed schema", () => {
  it("exists, because a manifest's $schema points at it by relative path", () => {
    expect(
      existsSync(COMMITTED),
      `${COMMITTED} is missing; run pnpm --filter @rigline/plugin-api build`,
    ).toBe(true);
  });

  it("is what the registry currently produces", () => {
    expect(
      readFileSync(COMMITTED, "utf8"),
      "the committed schema is stale; run pnpm --filter @rigline/plugin-api build",
    ).toBe(manifestSchemaJson());
  });
});

describe("manifestSchema", () => {
  it("carries every capability, in both halves, without being told any of their names", () => {
    const uses = properties(manifestSchema()).uses;
    const keys = CONTRACTS.map((c) => c.key);
    expect(
      Object.keys(properties(uses))
        .filter((k) => k !== "optional")
        .sort(),
    ).toEqual([...keys].sort());
    expect(Object.keys(properties(properties(uses).optional)).sort()).toEqual([...keys].sort());
  });

  it("does not let optional nest inside itself, which the validator also refuses", () => {
    const optional = properties(properties(manifestSchema()).uses).optional as JsonObject;
    expect(optional.additionalProperties).toBe(false);
    expect(Object.keys(properties(optional))).not.toContain("optional");
    expect(
      validateManifest(
        { api: 1, name: "demo", entry: "d.js", uses: { optional: { optional: {} } } },
        "demo",
      ).problems,
    ).toEqual(['"uses.optional.optional" is not a capability']);
  });

  it("enumerates the anchor names, so a misspelling is caught while typing", () => {
    const anchors = properties(properties(manifestSchema()).uses).anchors as JsonObject;
    const items = anchors.items as JsonObject;
    expect(items.enum).toContain("modelPill");
    expect(items.enum).not.toContain("notAnAnchor");
  });

  it("uses the same name pattern the validator does", () => {
    const name = properties(manifestSchema()).name as JsonObject;
    const pattern = new RegExp(name.pattern as string);
    expect(pattern.test("session-id")).toBe(true);
    expect(pattern.test("Session-Id")).toBe(false);
    expect(
      validateManifest({ api: 1, name: "Session-Id", entry: "d.js" }, "Session-Id").problems,
    ).toHaveLength(1);
  });

  it("allows $schema itself, since every manifest we ship carries one", () => {
    expect(Object.keys(properties(manifestSchema()))).toContain("$schema");
    expect(
      validateManifest({ $schema: "x", api: 1, name: "demo", entry: "d.js" }, "demo").problems,
    ).toEqual([]);
  });
});
