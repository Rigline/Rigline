/**
 * The farewell rule, which decides which session a panel is hosting. Read off minified code, its
 * one branch is easy to invert; these are the cases that pin the direction of that branch.
 */

import { describe, expect, it } from "vitest";
import { nextSessionId } from "./session.ts";

const A = "3f7a9c10-4b21-4e3d-9a6f-1a2b3c4d5e6f";
const B = "8d2e5f31-9c47-4a10-b6e2-7f8a9b0c1d2e";

describe("nextSessionId", () => {
  it("adopts an ordinary report's sessionId regardless of current", () => {
    expect(nextSessionId(null, { sessionId: A })).toBe(A);
    expect(nextSessionId(B, { sessionId: A })).toBe(A);
  });

  it("clears to null when the farewell matches current", () => {
    expect(nextSessionId(A, { sessionId: A, isFarewell: true })).toBeNull();
  });

  it("leaves current unchanged when the farewell is for some other session", () => {
    // The inverted rule fails here: it would clear on every switch instead of following it.
    expect(nextSessionId(A, { sessionId: B, isFarewell: true })).toBe(A);
  });

  it("follows a full switch through null to the new session", () => {
    let current: string | null = null;
    current = nextSessionId(current, { sessionId: A });
    expect(current).toBe(A);
    current = nextSessionId(current, { sessionId: A, isFarewell: true });
    expect(current).toBeNull();
    current = nextSessionId(current, { sessionId: B });
    expect(current).toBe(B);
  });

  it("leaves the id at null when only the farewell for the old id arrives", () => {
    // The effect sends only the farewell in this case: there is no id to report for the arrival.
    let current: string | null = A;
    current = nextSessionId(current, { sessionId: A, isFarewell: true });
    expect(current).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", "text"],
    ["an empty object", {}],
    ["an object with no sessionId", { state: "idle" }],
    ["an empty-string sessionId", { sessionId: "" }],
  ])("leaves current unchanged for %s", (_label, message) => {
    expect(nextSessionId(A, message)).toBe(A);
  });
});
