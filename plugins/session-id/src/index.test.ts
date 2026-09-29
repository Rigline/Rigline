/**
 * `messagingIdentity` and the small pure helpers around it, driven at the Node/pure-function level:
 * no stubbed `acquireVsCodeApi`, no built bundle, just the exported functions against plain data.
 * `packages/harness/test/session-id.test.ts` covers the DOM half against the real extension bundle.
 *
 * This file pins two things worth pinning precisely: the exact wording of the CLI's own-session
 * sentence, reverse-engineered rather than read from a published contract, and the spoof guard,
 * which is the tool's name: any other tool's output may quote the sentence.
 */
import type { ToolResult } from "@rigline/plugin-api";
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
  survivesRestart,
} from "./index.tsx";

/** One settled tool call, as `ctx.onToolResult` hands it over. */
function result(content: unknown, name = "ListAgents"): ToolResult {
  return { id: "toolu_01", name, input: {}, ok: true, content };
}

describe("messagingIdentity", () => {
  it("extracts the address from a realistic multi-line ListAgents result", () => {
    const text = [
      "Known sessions:",
      "  atlas-old [9c1a2b] idle 12m",
      "This session is atlas-ae [61b4a3] - the name other sessions use to message it",
    ].join("\n");
    expect(messagingIdentity(result(text))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("reads SendMessage's result too", () => {
    const text = "Sent. This session is atlas-ae [61b4a3] - the name other sessions use";
    expect(messagingIdentity(result(text, "SendMessage"))).toEqual({
      name: "atlas-ae",
      ref: "61b4a3",
    });
  });

  it.each(["Read", "Grep", "Bash", "WebFetch"])(
    "is not moved by %s output quoting the sentence, such as this plugin's own tests",
    (tool) => {
      const text = "This session is atlas-ae [61b4a3] - the name other sessions use to message it";
      expect(messagingIdentity(result(text, tool))).toBeNull();
    },
  );

  it("reads a result whose content is text blocks", () => {
    const blocks = [
      { type: "text", text: "Known sessions:" },
      { type: "text", text: "This session is atlas-ae [61b4a3] - hint" },
    ];
    expect(messagingIdentity(result(blocks))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("cannot stitch a name together across two text blocks", () => {
    const blocks = [
      { type: "text", text: "This session is atlas" },
      { type: "text", text: " renamed [61b4a3] - hint" },
    ];
    expect(messagingIdentity(result(blocks))).toBeNull();
  });

  it("is not fooled by a peer's row appearing before the own-session line", () => {
    // bogus-peer's own bracketed pair looks exactly like a name-and-ref, but carries no "This
    // session is" wording, so the anchor phrase - not position in the string - decides the match.
    const text = ["  bogus-peer [ffffff] idle 5m", "This session is atlas-ae [61b4a3] - hint"].join(
      "\n",
    );
    expect(messagingIdentity(result(text))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("extracts the same shape from the subagent's wording", () => {
    const text = "This process's main session is atlas-ae [61b4a3] - the name OTHER sessions use";
    expect(messagingIdentity(result(text))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("keeps a ref extended past six hex characters whole", () => {
    const text = "This session is atlas-ae [61b4a3ff] - a listing lengthened this one";
    expect(messagingIdentity(result(text))).toEqual({ name: "atlas-ae", ref: "61b4a3ff" });
  });

  it("keeps a name containing a space, set via /rename", () => {
    const text = "This session is atlas renamed [61b4a3] - hint";
    expect(messagingIdentity(result(text))).toEqual({ name: "atlas renamed", ref: "61b4a3" });
  });

  it("does not let a name capture run on to a later bracket when no token actually follows", () => {
    const prose =
      "This session is " +
      "the exact phrase ListAgents prints just before it names the current session, " +
      "which this sentence keeps describing at some length without ever actually supplying " +
      "one, while a different part of the same tool output happens to mention a session " +
      "named peer-x [abcdef] much further along than any real token would sit";
    expect(messagingIdentity(result(prose))).toBeNull();
  });

  it("does not let a name capture cross a line", () => {
    const text = ["This session is", "peer-x [abcdef] idle 5m"].join("\n");
    expect(messagingIdentity(result(text))).toBeNull();
  });

  it("refuses an implausibly long name", () => {
    const longName = "x".repeat(100);
    expect(messagingIdentity(result(`This session is ${longName} [61b4a3] - hint`))).toBeNull();
  });

  it("returns null for a result that plainly carries no address", () => {
    expect(messagingIdentity(result("Tool ran successfully with no relevant output."))).toBeNull();
  });

  it.each([
    ["empty content", ""],
    ["no content", undefined],
    ["a number", 42],
    ["an object", { text: "This session is atlas-ae [61b4a3]" }],
    ["blocks without text", [{ type: "image" }, null, 4]],
  ])("returns null for %s", (_label, content) => {
    expect(messagingIdentity(result(content))).toBeNull();
  });
});

describe("formatAddress", () => {
  it("joins name and ref as the CLI's own listing does", () => {
    expect(formatAddress({ name: "atlas-ae", ref: "61b4a3" })).toBe("atlas-ae [61b4a3]");
  });
});

describe("survivesRestart", () => {
  /** The CLI's own-session line when its address is keyed on the session, as it prints it. */
  const STABLE_LINE =
    "This session is atlas-ae [61b4a3] — the name other sessions use to message it (it is not " +
    "listed below; a message to it would be a message to yourself). Session names and [ref]s " +
    "listed here normally stay the same when a session restarts or is resumed; if one stops " +
    "resolving, list again.";

  it("is true where the CLI says the address outlives a restart", () => {
    expect(survivesRestart(result(STABLE_LINE))).toBe(true);
    expect(messagingIdentity(result(STABLE_LINE))).toEqual({ name: "atlas-ae", ref: "61b4a3" });
  });

  it("is false where it says nothing, which is the safe reading", () => {
    const text = "This session is atlas-ae [61b4a3] — the name other sessions use to message it";
    expect(survivesRestart(result(text))).toBe(false);
  });
});

describe("currentAddress", () => {
  const identity: Identity = { name: "atlas-ae", ref: "61b4a3" };
  const observed: Observed = { sessionId: "s1", launch: 1, stable: false, identity };

  it("is null with nothing observed yet", () => {
    expect(currentAddress(null, "s1", 1)).toBeNull();
  });

  it("returns the address when it was observed for the current session", () => {
    expect(currentAddress(observed, "s1", 1)).toBe(identity);
  });

  it("hides the address once the panel has switched to a different session", () => {
    expect(currentAddress(observed, "s2", 1)).toBeNull();
  });

  it("hides an address observed before the session id had caught up", () => {
    // Observed while sessionId was still null; it must not attach to whatever session shows up next.
    const early: Observed = { ...observed, sessionId: null };
    expect(currentAddress(early, "s1", 1)).toBeNull();
  });

  it("hides the address once the panel has launched another Claude process", () => {
    expect(currentAddress(observed, "s1", 2)).toBeNull();
  });

  it("keeps one the CLI said outlives a restart, for the same session only", () => {
    const stable: Observed = { ...observed, stable: true };
    expect(currentAddress(stable, "s1", 2)).toBe(identity);
    expect(currentAddress(stable, "s2", 2)).toBeNull();
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
