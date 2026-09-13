import { describe, expect, it } from "vitest";
import { EMPTY_USES } from "../manifest.ts";
import type { IdentifierTables } from "../tables.ts";
import {
  capabilityDrift,
  capabilityUse,
  capabilityViolation,
  patchViolation,
  permissionSummary,
  sharedFields,
} from "./index.ts";
import type { Uses } from "./types.ts";

const tables: IdentifierTables = {
  version: "9.9.9",
  moduleClasses: {
    gGYT1w: { modelPill: "modelPill_gGYT1w" },
    "07S1Yg": { message: "message_07S1Yg" },
  },
  messageTypes: [
    "rename_tab",
    "list_sessions_response",
    "io_message",
    "update_session_state",
    "get_session_response",
  ],
  inboundResponses: ["list_sessions_response"],
  outboundFields: { rename_tab: ["title", "hasPendingPermissions"], visibility_changed: [] },
  partialFieldTypes: [],
  anchors: { modelPill: "modelPill_gGYT1w", transcriptRow: "message_07S1Yg", worktreePill: null },
  react: { hook: "__REACT_DEVTOOLS_GLOBAL_HOOK__", version: "18.3.1" },
};

const uses = (partial: Partial<Uses>): Uses => ({ ...EMPTY_USES, ...partial });

describe("capabilityViolation", () => {
  it("passes an empty declaration and one whose identifiers all exist", () => {
    expect(capabilityViolation(EMPTY_USES, tables)).toBeNull();
    const full = uses({
      anchors: ["modelPill"],
      classes: { gGYT1w: ["modelPill"] },
      messages: ["rename_tab"],
      rewrites: { rename_tab: ["title"] },
      mount: true,
      style: true,
      tools: true,
      session: true,
      transcript: true,
    });
    expect(capabilityViolation(full, tables)).toBeNull();
  });

  it("names the anchor, module, class, message type or field that is missing", () => {
    expect(capabilityViolation(uses({ anchors: ["worktreePill"] }), tables)).toBe(
      'anchor "worktreePill" (OOQiHg.worktreePill) is not in this extension',
    );
    expect(capabilityViolation(uses({ classes: { ZZZZZZ: ["x"] } }), tables)).toBe(
      'unknown module "ZZZZZZ"',
    );
    expect(capabilityViolation(uses({ classes: { gGYT1w: ["modelPillRow"] } }), tables)).toBe(
      "unknown class gGYT1w.modelPillRow",
    );
    expect(capabilityViolation(uses({ messages: ["usage_update"] }), tables)).toBe(
      'unknown message type "usage_update"',
    );
    expect(capabilityViolation(uses({ rewrites: { rename_tab: ["subtitle"] } }), tables)).toBe(
      "unknown field rename_tab.subtitle",
    );
  });

  it("refuses a rewrite of a type with no field table, whether inbound or an envelope", () => {
    expect(capabilityViolation(uses({ rewrites: { list_sessions_response: [] } }), tables)).toBe(
      'unrewritable message type "list_sessions_response"',
    );
    expect(capabilityViolation(uses({ rewrites: { request: ["x"] } }), tables)).toBe(
      'unrewritable message type "request"',
    );
    // Known but with nothing to patch: declaring no fields passes, declaring one fails.
    expect(capabilityViolation(uses({ rewrites: { visibility_changed: [] } }), tables)).toBeNull();
    expect(
      capabilityViolation(uses({ rewrites: { visibility_changed: ["visible"] } }), tables),
    ).toBe("unknown field visibility_changed.visible");
  });

  it("expands a switch to the message types and anchors the host taps for it", () => {
    const noSession = {
      ...tables,
      messageTypes: tables.messageTypes.filter((t) => t !== "update_session_state"),
    };
    expect(capabilityViolation(uses({ session: true }), noSession)).toBe(
      '"session" needs message type "update_session_state", which is gone: onSessionId() would never fire',
    );
    expect(capabilityViolation(uses({ session: false }), noSession)).toBeNull();
    const noRow = { ...tables, anchors: { ...tables.anchors, transcriptRow: null } };
    expect(capabilityViolation(uses({ transcript: true }), noRow)).toBe(
      '"transcript" needs anchor "transcriptRow", which is gone: decorateTranscript() would find nothing',
    );
    const noIo = { ...tables, messageTypes: tables.messageTypes.filter((t) => t !== "io_message") };
    expect(capabilityViolation(uses({ tools: true }), noIo)).toMatch(
      /"tools" needs message type "io_message"/,
    );
  });
});

describe("patchViolation", () => {
  const target = { type: "rename_tab", title: "a title", hasPendingPermissions: false };
  const declared = ["title", "hasPendingPermissions"];

  it("accepts a same-kind replacement of a declared field, and an empty patch", () => {
    expect(patchViolation({ title: "new" }, declared, target)).toBeNull();
    expect(patchViolation({}, declared, target)).toBeNull();
  });

  it("refuses undeclared, absent and retyped fields, non-objects and promises", () => {
    expect(patchViolation({ hasUnseenCompletion: true }, declared, target)).toBe(
      'patched undeclared field "hasUnseenCompletion"',
    );
    expect(patchViolation({ title: "x" }, ["title", "subtitle"], { type: "t" })).toBe(
      'patched "title", which this message does not carry',
    );
    expect(patchViolation({ title: 42 }, declared, target)).toBe(
      'patched "title" with a number, replacing a string',
    );
    expect(patchViolation({ title: null }, declared, target)).toBe(
      'patched "title" with an object, replacing a string',
    );
    for (const bad of ["title", 42, [], true]) {
      expect(patchViolation(bad, declared, target)).toMatch(/expected an object of fields/);
    }
    expect(patchViolation(Promise.resolve({}), declared, target)).toMatch(/cannot be awaited/);
  });
});

describe("summaries and the advisory scan", () => {
  it("lists what a plugin will be able to do", () => {
    const lines = permissionSummary(
      uses({ anchors: ["modelPill"], rewrites: { rename_tab: ["title"] }, tools: true }),
    );
    expect(lines).toEqual([
      "attaches to modelPill: The model picker pill in the composer footer",
      "rewrites rename_tab on its way to the extension host: title",
      "watches the tool calls the assistant makes, including their arguments",
    ]);
  });

  it("reports shared rewrite fields in composition order", () => {
    expect(
      sharedFields([
        { name: "a", rewrites: { rename_tab: ["title"] } },
        { name: "b", rewrites: { rename_tab: ["title", "hasPendingPermissions"] } },
        { name: "c", rewrites: { rename_tab: ["title"] } },
      ]),
    ).toEqual([{ type: "rename_tab", field: "title", plugins: ["a", "b", "c"] }]);
  });

  it("finds grants in call position only, and reports drift both ways", () => {
    expect(capabilityUse("ctx.onSessionId((id) => {});")).toEqual(["session"]);
    expect(capabilityUse("const off = ctx.onToolUse(handler);")).toEqual(["tools"]);
    // A mention without a call is prose, and stays out; a mention with one counts, wherever it is.
    expect(capabilityUse("// see ctx.onSessionId for the derivation")).toEqual([]);
    expect(capabilityUse("// like ctx.onSessionId(handler) does")).toEqual(["session"]);
    expect(capabilityUse("ctx.onMessage('rename_tab', fn)")).toEqual(["messages"]);
    expect(capabilityDrift(uses({ session: true }), [])).toEqual([
      'declares "session" but never calls onSessionId()',
    ]);
    expect(capabilityDrift(EMPTY_USES, ["tools"])).toEqual([
      'calls onToolUse() without declaring "tools": it will throw and disable the plugin',
    ]);
    expect(capabilityDrift(uses({ tools: true }), ["tools"])).toEqual([]);
  });
});
