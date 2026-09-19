import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.ts";

describe("@rigline/core", () => {
  it("builds and exports a version", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("states the same version its package.json does", () => {
    // `CORE_VERSION` is written by hand, and it is what `rigline --help` prints and what `doctor`
    // stamps on the report a person pastes into an issue. Nothing else makes the two agree, so a
    // release that bumps the manifest and forgets the constant produces diagnostics that name a
    // version nobody is running — which is the one thing a pasteable report must not do. This is
    // the check that fails at the moment the mistake is easiest to make.
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    expect(CORE_VERSION).toBe(manifest.version);
  });
});
