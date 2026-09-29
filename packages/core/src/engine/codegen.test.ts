/**
 * `rigline codegen`: what `--check` compares, and where an ambiguous anchor fails it (W39, D7).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { writeFixtureExtension } from "../../test/fixtures.ts";
import { runEngine } from "./main.ts";

const state = vi.hoisted(() => ({ ambiguous: false, checkout: true }));

vi.mock("../codegen/generate.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../codegen/generate.ts")>();
  return {
    ...actual,
    generate: (...args: Parameters<typeof actual.generate>) => {
      const generated = actual.generate(...args);
      if (!state.ambiguous) return generated;
      const ambiguous = [{ name: "modelPill", sites: 3 }];
      return { ...generated, anchors: { ...generated.anchors, ambiguous } };
    },
  };
});

vi.mock("../assets.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../assets.ts")>();
  return { ...actual, workspaceRoot: () => (state.checkout ? actual.workspaceRoot() : null) };
});

let dir: string;
let ext: string;
let out: string;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rigline-codegen-"));
  ext = writeFixtureExtension(join(dir, "ext"));
  out = join(dir, "generated.ts");
  state.ambiguous = false;
  state.checkout = true;
  vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const printed = (): string => error.mock.calls.flat().join("\n");

describe("codegen", () => {
  it("reads a CRLF checkout of the file it writes as up to date", async () => {
    expect(await runEngine(["codegen", ext, "--out", out])).toBe(0);
    const lf = readFileSync(out, "utf8");
    writeFileSync(out, lf.split("\n").join(String.fromCharCode(13, 10)));
    expect(await runEngine(["codegen", "--check", ext, "--out", out])).toBe(0);
    writeFileSync(out, `${lf}// edited\n`);
    expect(await runEngine(["codegen", "--check", ext, "--out", out])).toBe(1);
  });

  it("fails over an ambiguous anchor in Rigline's own checkout, where the table is a maintainer's", async () => {
    state.ambiguous = true;
    expect(await runEngine(["codegen", ext, "--out", out])).toBe(1);
    expect(printed()).toContain("packages/plugin-api/src/anchors.ts");
  });

  it("notes an ambiguous anchor in an author's workspace, and writes the file all the same", async () => {
    state.ambiguous = true;
    state.checkout = false;
    expect(await runEngine(["codegen", ext, "--out", out])).toBe(0);
    expect(await runEngine(["codegen", "--check", ext, "--out", out])).toBe(0);
    expect(printed()).toContain("ambiguous anchor: modelPill");
    expect(printed()).toContain("~/.rigline/anchors.json");
    expect(printed()).not.toContain("packages/plugin-api");
  });
});
