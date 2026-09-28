import { describe, expect, it } from "vitest";
import { localTime, localTimeAt } from "./clock.ts";

const AT = Date.parse("2026-09-27T23:56:52.334Z");

describe("localTimeAt", () => {
  it.each([
    [600, "2026-09-28 09:56:52.334 +10:00"],
    [570, "2026-09-28 09:26:52.334 +09:30"],
    [0, "2026-09-27 23:56:52.334 +00:00"],
    [-300, "2026-09-27 18:56:52.334 -05:00"],
    [-210, "2026-09-27 20:26:52.334 -03:30"],
  ])("at an offset of %i minutes reads %s", (offset, expected) => {
    expect(localTimeAt(AT, offset)).toBe(expected);
  });
});

describe("localTime", () => {
  it("uses the date's own offset", () => {
    const at = new Date(AT);
    expect(localTime(at)).toBe(localTimeAt(AT, -at.getTimezoneOffset()));
  });
});
