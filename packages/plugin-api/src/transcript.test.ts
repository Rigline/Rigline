/**
 * The two derivations behind `ctx.decorateTranscript`: where a real time comes from, and which
 * fiber is a row. Both are read off a minified bundle and both fail quietly when wrong — a
 * missing time looks like a message the CLI has not reported yet, and an unrecognised fiber looks
 * like a row that has not rendered. So the cases that would otherwise only show up as "the feature
 * does nothing" are pinned here instead.
 */

import { describe, expect, it } from "vitest";
import {
  entriesDiffer,
  type FiberLike,
  messageTimes,
  rowIdentity,
  type TranscriptEntry,
} from "./transcript.ts";

const A = "6b1c2d3e-4f50-4a1b-8c9d-0e1f2a3b4c5d";
const B = "1a2b3c4d-5e6f-4718-9a0b-c1d2e3f4a5b6";
const WHEN = "2026-09-11T04:00:59.631Z";
const WHEN_MS = Date.parse(WHEN);

/** Builds a fiber chain, innermost first: fiber(a, b) makes a node `a` whose `.return` is a node wrapping `b`. */
const fiber = (...props: unknown[]): FiberLike | null =>
  props.reduceRight<FiberLike | null>(
    (parent, memoizedProps) => ({ memoizedProps, return: parent }),
    null,
  );

describe("messageTimes", () => {
  it("yields one pair per record in a get_session_response, in order", () => {
    const times = messageTimes({
      type: "get_session_response",
      messages: [
        { type: "user", uuid: A, timestamp: WHEN, message: { role: "user", content: "hi" } },
        { type: "assistant", uuid: B, timestamp: WHEN, message: { role: "assistant" } },
      ],
    });
    expect(times).toEqual([
      { id: A, at: WHEN_MS },
      { id: B, at: WHEN_MS },
    ]);
  });

  it("yields exactly its own one pair for a relayed io_message", () => {
    const times = messageTimes({
      type: "io_message",
      channelId: "c1",
      message: { type: "assistant", uuid: A, timestamp: WHEN, message: {} },
    });
    expect(times).toEqual([{ id: A, at: WHEN_MS }]);
  });

  it("takes a numeric timestamp as-is, not reinterpreted", () => {
    const times = messageTimes({
      type: "io_message",
      message: { type: "assistant", uuid: A, timestamp: WHEN_MS, message: {} },
    });
    expect(times).toEqual([{ id: A, at: WHEN_MS }]);
  });

  it.each(["meta", "compact", "refusal_fallback", "system", "stream_event"])(
    "skips rows the webview mints for itself (type %s)",
    (type) => {
      const times = messageTimes({
        type: "get_session_response",
        messages: [{ type, uuid: A, timestamp: WHEN }],
      });
      expect(times).toEqual([]);
    },
  );

  it.each([
    ["empty string", ""],
    ["an unparseable string", "yesterday"],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
    ["NaN", Number.NaN],
  ])("yields nothing for an unparseable timestamp (%s)", (_label, timestamp) => {
    const times = messageTimes({
      type: "get_session_response",
      messages: [{ type: "assistant", uuid: A, timestamp }],
    });
    expect(times).toEqual([]);
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
  ])("yields nothing for a record with an id that is %s", (_label, uuid) => {
    const times = messageTimes({
      type: "get_session_response",
      messages: [{ type: "user", uuid, timestamp: WHEN }],
    });
    expect(times).toEqual([]);
  });

  it.each([
    ["not object-shaped", "nope"],
    ["null", null],
    ["the wrong envelope type", { type: "visibility_changed" }],
    // Right type, wrong inner shape: the case a version change would produce.
    [
      "a get_session_response with a non-array messages",
      { type: "get_session_response", messages: "none" },
    ],
  ])("yields nothing for input that is %s", (_label, message) => {
    expect(messageTimes(message)).toEqual([]);
  });
});

describe("rowIdentity", () => {
  it("identifies a row directly when the fiber's own props carry the message", () => {
    const node = fiber({ message: { uuid: A, type: "assistant", content: [] } });
    expect(rowIdentity(node)).toEqual({ id: A, role: "assistant" });
  });

  it("walks up to the ancestor whose props carry the message", () => {
    // What the DOM node actually has on it: the div's attributes. The message is on the
    // component above, which is the whole reason this walks rather than reading one fiber.
    const node = fiber(
      { className: "message_07S1Yg", children: [] },
      { session: {}, index: 3, message: { uuid: B, type: "user" } },
    );
    expect(rowIdentity(node)).toEqual({ id: B, role: "user" });
  });

  it("bounds the walk so an ancestor row cannot be mistaken for this one", () => {
    const node = fiber({}, {}, {}, {}, { message: { uuid: A, type: "assistant" } });
    expect(rowIdentity(node)).toBeNull();
  });

  it("is not yet an entry while the row is still streaming (no uuid)", () => {
    const node = fiber({ message: { uuid: undefined, type: "assistant" } });
    expect(rowIdentity(node)).toBeNull();
  });

  it("is not an entry for a row type that is rendered but never timed", () => {
    const node = fiber({ message: { uuid: A, type: "compact" } });
    expect(rowIdentity(node)).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a chain of junk nodes", fiber(null, "text", 42)],
  ])("returns null for non-fiber-shaped input (%s)", (_label, node) => {
    expect(rowIdentity(node)).toBeNull();
  });
});

describe("entriesDiffer", () => {
  const list: readonly TranscriptEntry[] = [
    { id: A, role: "user", at: WHEN_MS, index: 0 },
    { id: B, role: "assistant", at: null, index: 1 },
  ];

  it("is false for structurally-identical copies", () => {
    const copy: readonly TranscriptEntry[] = [
      { id: A, role: "user", at: WHEN_MS, index: 0 },
      { id: B, role: "assistant", at: null, index: 1 },
    ];
    expect(entriesDiffer(list, copy)).toBe(false);
  });

  it("is true when a previously-null at becomes non-null", () => {
    const changed: readonly TranscriptEntry[] = [
      { id: A, role: "user", at: WHEN_MS, index: 0 },
      { id: B, role: "assistant", at: WHEN_MS, index: 1 },
    ];
    expect(entriesDiffer(list, changed)).toBe(true);
  });

  it("is true when the same ids appear with their index swapped", () => {
    // Rows are keyed by index upstream, so comparing sets rather than sequences would call this
    // unchanged and leave every decoration one row out of place.
    const swapped: readonly TranscriptEntry[] = [
      { id: B, role: "assistant", at: null, index: 0 },
      { id: A, role: "user", at: WHEN_MS, index: 1 },
    ];
    expect(entriesDiffer(list, swapped)).toBe(true);
  });

  it.each([
    ["truncated", list.slice(0, 1), list],
    ["extended", list, list.slice(0, 1)],
  ])("is true when an entry appears or disappears (%s)", (_label, a, b) => {
    expect(entriesDiffer(a, b)).toBe(true);
  });
});
