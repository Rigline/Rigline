/**
 * The fake host's reply table against the identifiers the extension actually has. Not tier 3: it
 * reads the committed `generated.ts` and needs neither the corpus nor a browser, so it runs
 * wherever vitest does — which is the point, because the fault it catches is a plausible reply name
 * that the extension does not use, and that stays invisible until a plugin taps the message.
 */

import { fileURLToPath } from "node:url";
import { readGeneratedScan, replyCandidates } from "@rigline/core";
import { describe, expect, it } from "vitest";
import { REPLY_TABLE } from "../src/page.ts";
import { HARNESS_VERSION } from "../src/suite.ts";

const GENERATED = fileURLToPath(new URL("../../../generated.ts", import.meta.url));

describe("the fake host's reply table", () => {
  const scan = readGeneratedScan(GENERATED);
  const replies = new Set(scan.views["replies.replies"] ?? []);
  const messages = new Set(scan.views["protocol.messages"] ?? []);

  it("checks against the same extension the rest of the harness drives", () => {
    // Both are this checkout's answer to "what is installed", so they move together — but nothing
    // makes them, and a check against a different version's identifiers would pass or fail for
    // reasons that have nothing to do with the table.
    expect(scan.version).toBe(HARNESS_VERSION);
  });

  it("keys the table on message types the protocol has", () => {
    // Coarse on purpose: the scan keeps one flat set of message types rather than the outbound
    // requests on their own, so this catches a retired or misspelled key and not a key that is a
    // real message of some other direction. A request nothing sends falls through to a console
    // warning and a `{}` reply, which is quiet in both directions.
    expect(messages.size).toBeGreaterThan(0);
    for (const request of Object.keys(REPLY_TABLE)) {
      expect(messages, request).toContain(request);
    }
  });

  it("answers each request with the reply the extension pairs to it", () => {
    // Membership in the replies layer is not enough: it would accept any real reply name against
    // any request, and the table is hand-written. `replyCandidates` is how the harvest pairs them,
    // so asking it the same question is exactly as right as the harvest is.
    expect(replies.size).toBeGreaterThan(0);
    for (const [request, body] of Object.entries(REPLY_TABLE)) {
      const paired = replyCandidates(request).find((candidate) => replies.has(candidate));
      expect(paired, `${request} pairs with no harvested reply`).toBeDefined();
      expect(body.type, request).toBe(paired);
    }
  });
});
