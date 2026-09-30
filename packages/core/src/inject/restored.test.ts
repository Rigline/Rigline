import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearRestored, markRestored, restoredAt, restoredSince } from "./restored.ts";

const dirs: string[] = [];

function mark(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-restored-"));
  dirs.push(dir);
  return join(dir, "home", "restored");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the restored mark", () => {
  it("says when, until it is cleared, making the home if there is none", () => {
    const path = mark();
    expect(restoredSince(path)).toBeNull();
    markRestored(path, new Date("2026-09-27T01:02:03.000Z"));
    expect(restoredSince(path)).toBe("2026-09-27T01:02:03.000Z");
    expect(clearRestored(path)).toBe(true);
    expect(restoredSince(path)).toBeNull();
    expect(clearRestored(path)).toBe(false);
  });

  it("still holds when emptied by hand, since its being there is what counts", () => {
    const path = mark();
    markRestored(path);
    writeFileSync(path, "");
    expect(restoredSince(path)).toBe("an unrecorded time");
  });
});

describe("restoredAt", () => {
  const now = new Date(2026, 8, 30, 12);

  it("says a time this year as a person reads a clock, in local time", () => {
    expect(restoredAt(new Date(2026, 8, 30, 9, 23).toISOString(), now)).toBe(
      "09:23 on 30 September",
    );
  });

  it("adds the year when it is not this one", () => {
    expect(restoredAt(new Date(2025, 11, 31, 23, 5).toISOString(), now)).toBe(
      "23:05 on 31 December 2025",
    );
  });

  it("leaves text that is not a time as it was", () => {
    expect(restoredAt("an unrecorded time", now)).toBe("an unrecorded time");
  });
});
