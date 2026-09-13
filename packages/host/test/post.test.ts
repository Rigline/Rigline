/**
 * The built post hook is one prebuilt file that fits every extension version (decisions.md, P7).
 * plugin-api exports the harvested tables for plugins to compile against, and the post hook
 * imports from the same package, so the guard that nothing version-specific rode along is a
 * check on the built artifact, not on the source.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BUILT = fileURLToPath(new URL("../dist/post.js", import.meta.url));

describe("the built post hook", () => {
  it("exists", () => {
    expect(existsSync(BUILT), `${BUILT} is missing; run pnpm --filter @prototype/host build`).toBe(
      true,
    );
  });

  it("bakes in no harvested identifiers and reads its tables beside itself", () => {
    const js = readFileSync(BUILT, "utf8");
    const withoutSourceMap = js.replace(/\/\/# sourceMappingURL=.*$/m, "");
    expect(withoutSourceMap).not.toMatch(/EXTENSION_VERSION|"2\.1\.\d+"/);
    expect(withoutSourceMap).not.toContain("modelPill_gGYT1w");
    expect(withoutSourceMap).toContain("./generated.js");
    expect(withoutSourceMap).toContain("./registry.js");
  });

  it("shares no chunk with the pre hook", () => {
    const js = readFileSync(BUILT, "utf8");
    expect(js).not.toMatch(/from\s*"\.\/[^"]+\.js"/);
  });
});
