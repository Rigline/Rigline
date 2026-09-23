/**
 * `messagingIdentity` and the small pure helpers around it, driven at the Node/pure-function level:
 * no stubbed `acquireVsCodeApi`, no built bundle, just the exported functions against plain data.
 * `packages/harness/test/session-id.test.ts` covers the DOM half against the real extension bundle.
 *
 * This file pins two things worth pinning precisely: the exact wording of the CLI's own-session
 * sentence, since both the sentence and the record shape it arrives in were reverse-engineered
 * rather than read from a published contract, and the spoof guard, since a chat message and a tool
 * result share the same `type: "user"` envelope and only the guard tells them apart.
 */
import { describe, expect, it } from "vitest";
import {
  buildEntries,
  buildTooltip,
  copyHint,
  currentAddress,
  formatAddress,
  headlineText,
  type Identity,
  messagingIdentity,
  type Observed,
} from "./index.tsx";

/** One `io_message` carrying a single `tool_result` content block, the shape a real
 * `ListAgents`/`SendMessage` result arrives in. */
function toolResult(text: string): unknown {
  return {
    type: "io_message",
    channelId: "c1",
    done: false,
    message: {
      type: "user",
      uuid: "11111111-1111-1111-1111-111111111111",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_01", content: text }],
      },
    },
  };
}

/** A typed chat message: same `type: "user"` envelope, but no `tool_result` block anywhere in it. */
function typedMessage(text: string): unknown {
  return {
    type: "io_message",
    message: {
      type: "user",
      uuid: "22222222-2222-2222-2222-222222222222",
      message: { role: "user", content: [{ type: "text", text }] },
    },
  };
}

/** An assistant record, so `record.type !== "user"` regardless of what its text contains. */
function assistantMessage(text: string): unknown {
  return {
    type: "io_message",
    message: {
      type: "assistant",
      uuid: "33333333-3333-3333-3333-333333333333",
      message: { role: "assistant", content: [{ type: "text", text }] },
    },
  };
}

describe("messagingIdentity", () => {
  it("extracts the address from a realistic multi-line ListAgents result", () => {
    const text = [
      "Known sessions:",
      "  atlas-old [9c1a2b] idle 12m",
      "This session is atlas-ae [61b4a3] - the name other sessions use to message it",
    ].join("\n");
    expect(messagingIdentity(toolResult(text))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("is not fooled by a peer's row appearing before the own-session line", () => {
    // bogus-peer's own bracketed pair looks exactly like a name-and-ref, but carries no "This
    // session is" wording, so the anchor phrase - not position in the string - decides the match.
    const text = ["  bogus-peer [ffffff] idle 5m", "This session is atlas-ae [61b4a3] - hint"].join(
      "\n",
    );
    expect(messagingIdentity(toolResult(text))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("extracts the same shape from the subagent's wording", () => {
    const text = "This process's main session is atlas-ae [61b4a3] - the name OTHER sessions use";
    expect(messagingIdentity(toolResult(text))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("keeps a ref extended past six hex characters whole", () => {
    const text = "This session is atlas-ae [61b4a3ff] - a listing lengthened this one";
    expect(messagingIdentity(toolResult(text))).toEqual({ name: "atlas-ae", ref: "61b4a3ff" });
  });

  it("keeps a name containing a space, set via /rename", () => {
    const text = "This session is atlas renamed [61b4a3] - hint";
    expect(messagingIdentity(toolResult(text))).toEqual({ name: "atlas renamed", ref: "61b4a3" });
  });

  it("does not let a name capture run on to a later bracket when no token actually follows", () => {
    // Regression case for the real bug the length cap and the quote/backslash exclusion exist to
    // prevent: prose describing the sentence format, with nothing following it, used to let an
    // earlier unbounded capture run on to the next bracketed hex string anywhere in the record.
    const prose =
      "This session is " +
      "the exact phrase ListAgents prints just before it names the current session, " +
      "which this sentence keeps describing at some length without ever actually supplying " +
      "one, while a different part of the same tool output happens to mention a session " +
      "named peer-x [abcdef] much further along than any real token would sit";
    expect(messagingIdentity(toolResult(prose))).toBeNull();
  });

  it("cannot stitch a name together across two separate tool_result content blocks", () => {
    const envelope = {
      type: "io_message",
      message: {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "a", content: "This session is atlas" },
            { type: "tool_result", tool_use_id: "b", content: " renamed [61b4a3] - hint" },
          ],
        },
      },
    };
    expect(messagingIdentity(envelope)).toBeNull();
  });

  it("refuses an implausibly long name with no JSON delimiter to stop it", () => {
    const longName = "x".repeat(100);
    expect(messagingIdentity(toolResult(`This session is ${longName} [61b4a3] - hint`))).toBeNull();
  });

  it("returns null for a tool result that plainly carries no address", () => {
    expect(
      messagingIdentity(toolResult("Tool ran successfully with no relevant output.")),
    ).toBeNull();
  });

  it("is not spoofed by a typed message quoting the address text as plain content", () => {
    const pasted = "This session is atlas-ae [61b4a3] - the name other sessions use to message it";
    expect(messagingIdentity(typedMessage(pasted))).toBeNull();
  });

  it("ignores an assistant record even when its text contains the phrase and the word tool_result", () => {
    const text = "tool_result: This session is atlas-ae [61b4a3] - the name other sessions use";
    expect(messagingIdentity(assistantMessage(text))).toBeNull();
  });

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "hello"],
    ["a number", 42],
    ["an empty object", {}],
    ["an io_message envelope with no message field", { type: "io_message" }],
    ["an io_message envelope whose message is null", { type: "io_message", message: null }],
    [
      "an io_message envelope whose message is a string, not an object",
      { type: "io_message", message: "user" },
    ],
    [
      "a differently-typed envelope",
      { type: "update_session_state", message: { type: "user", message: {} } },
    ],
    ["a tool result with empty content", toolResult("")],
  ];

  it.each(malformed)("returns null for %s", (_label, input) => {
    expect(messagingIdentity(input)).toBeNull();
  });

  it("returns null rather than throwing for a record that will not serialise", () => {
    const cyclic: Record<string, unknown> = { type: "user", content: [{ type: "tool_result" }] };
    cyclic.self = cyclic;
    const envelope = { type: "io_message", message: cyclic };
    expect(() => messagingIdentity(envelope)).not.toThrow();
    expect(messagingIdentity(envelope)).toBeNull();
  });
});

describe("formatAddress", () => {
  it("joins name and ref as the CLI's own listing does", () => {
    expect(formatAddress({ name: "atlas-ae", ref: "61b4a3" })).toBe("atlas-ae [61b4a3]");
  });
});

describe("currentAddress", () => {
  const identity: Identity = { name: "atlas-ae", ref: "61b4a3" };
  const observed: Observed = { sessionId: "s1", identity };

  it("is null with nothing observed yet", () => {
    expect(currentAddress(null, "s1")).toBeNull();
  });

  it("returns the address when it was observed for the current session", () => {
    expect(currentAddress(observed, "s1")).toBe(identity);
  });

  it("hides the address once the panel has switched to a different session", () => {
    expect(currentAddress(observed, "s2")).toBeNull();
  });

  it("hides an address observed before the session id had caught up", () => {
    // Observed while sessionId was still null; it must not attach to whatever session shows up next.
    const early: Observed = { sessionId: null, identity };
    expect(currentAddress(early, "s1")).toBeNull();
  });
});

describe("headlineText", () => {
  it("shows the first 8 characters of the session id", () => {
    expect(headlineText("abcdefgh12345")).toBe("abcdefgh");
  });

  it("shows the placeholder before a session id exists", () => {
    expect(headlineText(null)).toBe("...");
  });

  it("never widens with the session, however long its name gets", () => {
    // The reason the pill shows an id rather than the address: a worktree session is named after
    // its directory and a Remote Control session after its title, so an address is as wide as
    // somebody's branch name or sentence. Eight characters is eight characters.
    for (const id of ["a", "abcdefgh12345", "x".repeat(200)]) {
      expect(headlineText(id).length).toBeLessThanOrEqual(8);
    }
  });
});

describe("buildEntries", () => {
  it("notes a missing address without disturbing where the session id rows sit", () => {
    const entries = buildEntries(null, "session-1");
    expect(entries[0]).toMatchObject({ kind: "missing" });
    expect(entries[1]).toEqual({ kind: "copyable", label: "Session id", value: "session-1" });
    expect(entries[2]).toEqual({
      kind: "copyable",
      label: "Short session id",
      value: "session-",
    });
  });

  it("notes a missing session id as its own row", () => {
    const entries = buildEntries(null, null);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ kind: "missing" });
  });

  it("shows every value once everything is known", () => {
    const address: Identity = { name: "atlas-ae", ref: "61b4a3" };
    const entries = buildEntries(address, "session-12345678");
    expect(entries).toEqual([
      { kind: "copyable", label: "Messaging address", value: "atlas-ae [61b4a3]" },
      { kind: "copyable", label: "Session id", value: "session-12345678" },
      { kind: "copyable", label: "Short session id", value: "session-" },
    ]);
  });
});

describe("copyHint and buildTooltip", () => {
  it("has no hint before there is a session id to copy", () => {
    expect(copyHint(null)).toBeNull();
    expect(buildTooltip(buildEntries(null, null), null)).not.toMatch(/Alt-click/);
  });

  it("offers the session id, not the address, because that is what the pill shows", () => {
    const address: Identity = { name: "atlas-ae", ref: "61b4a3" };
    expect(copyHint("session-1")).toMatch(/copy the session id/);
    expect(copyHint("session-1")).not.toMatch(/address/);
    // The address is still in the tooltip, and still first: it left the pill, not the pop-up.
    expect(buildTooltip(buildEntries(address, "session-1"), "session-1")).toMatch(
      /Messaging address: atlas-ae \[61b4a3\]/,
    );
  });
});
