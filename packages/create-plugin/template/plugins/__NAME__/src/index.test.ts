/**
 * The pure half of the plugin, under plain `vitest`.
 *
 * Verification splits three ways, and knowing which tier a question belongs to is most of writing
 * a test that is worth having. A pure function is this tier. Whether a decoration lands in the
 * right place, survives a re-render, or costs the row a line of height is a question about the app,
 * and only the app can answer it: `pnpm build`, `pnpm rigline add`, reload the webview, look.
 */
import { describe, expect, it } from "vitest";
import { badgeText } from "./index.tsx";

describe("badgeText", () => {
  it("says something before anything has happened", () => {
    expect(badgeText(0)).toBe("no tools yet");
  });

  it("does not make a reader read (s)", () => {
    expect(badgeText(1)).toBe("1 tool call");
    expect(badgeText(2)).toBe("2 tool calls");
  });
});
