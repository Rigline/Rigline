import { ANCHORS } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import type { Harvest } from "../layers/index.ts";
import { generate } from "./generate.ts";

const harvest = (overrides: Partial<Harvest> = {}): Harvest => ({
  version: "9.9.9",
  classes: {
    map: {
      gGYT1w: { modelPill: "modelPill_gGYT1w", modelPillRow: "modelPillRow_gGYT1w" },
      OOQiHg: { tab: "tab_OOQiHg", sessionItem: "sessionItem_OOQiHg" },
      yumWmQ: { tab: "tab_yumWmQ" },
    },
    sites: {
      gGYT1w: { modelPill: 3, modelPillRow: 1 },
      OOQiHg: { tab: 2, sessionItem: 1 },
      yumWmQ: { tab: 1 },
    },
    uncounted: [],
  },
  protocol: {
    outboundRequests: ["rename_tab", "get_asset_uris"],
    outboundNotifications: ["request", "response", "io_message"],
    inboundPushes: ["io_message"],
    inboundRequests: ["selection_changed"],
  },
  fields: {
    fields: { rename_tab: ["title", "hasPendingPermissions"], visibility_changed: [] },
    partial: ["update_session_state"],
  },
  replies: { responses: ["rename_tab_response", "asset_uris_response"], unanswered: [] },
  react: { hook: "__REACT_DEVTOOLS_GLOBAL_HOOK__", version: "18.3.1" },
  css: ".tab_OOQiHg{}.tab_yumWmQ{}.taskRow_oblbPg{}.modelPill_gGYT1w{}",
  ...overrides,
});

describe("generate", () => {
  it("builds tables that merge every direction with the replies and resolve anchors", () => {
    const { tables } = generate(harvest());
    expect(tables.version).toBe("9.9.9");
    expect(tables.messageTypes).toEqual([
      "asset_uris_response",
      "get_asset_uris",
      "io_message",
      "rename_tab",
      "rename_tab_response",
      "request",
      "response",
      "selection_changed",
    ]);
    expect(tables.inboundResponses).toEqual(["asset_uris_response", "rename_tab_response"]);
    expect(tables.outboundFields.rename_tab).toEqual(["hasPendingPermissions", "title"]);
    expect(tables.outboundFields.request).toBeUndefined();
    expect(tables.partialFieldTypes).toEqual(["update_session_state"]);
    expect(tables.anchors.modelPill).toBe("modelPill_gGYT1w");
    expect(tables.anchors.transcriptRow).toBeNull();
    expect(tables.react.version).toBe("18.3.1");
  });

  it("reports whole unreachable modules and refuses a partially harvested one", () => {
    expect(generate(harvest()).unreachableModules).toEqual(["oblbPg"]);
    const partial = harvest({ css: ".tab_OOQiHg{}.gone_OOQiHg{}" });
    expect(() => generate(partial)).toThrow(/partially harvested module: OOQiHg \(gone\)/);
  });

  it("renders module-scoped class unions, one member per line", () => {
    const { source } = generate(harvest());
    expect(source).toContain('export const EXTENSION_VERSION = "9.9.9";');
    expect(source).toMatch(/"gGYT1w":\n\s+\| "modelPill"\n\s+\| "modelPillRow";/);
    expect(source).toMatch(/"OOQiHg":\n\s+\| "sessionItem"\n\s+\| "tab";/);
    // No union is packed onto one line.
    expect(source).not.toMatch(/\|.*\|.*\|.*\|/);
  });

  it("renders one augmentation of the published interface, and no harvested type of its own", () => {
    const { source } = generate(harvest());
    expect(source).toContain('declare module "@rigline/plugin-api" {');
    expect(source).toContain("interface RiglineIdentifiers {");
    for (const key of ["modules:", "classes: {", "messages:", "outboundFields: {"]) {
      expect(source).toContain(key);
    }
    // D40: the published package ships no harvested identifier types, so codegen writes none —
    // not even ones an author might find handy. Everything it says, it says by augmentation.
    expect(source).not.toMatch(/^export (type|interface) /m);
    expect(source).toMatch(/"rename_tab":\n\s+\| "hasPendingPermissions"\n\s+\| "title";/);
    expect(source).toContain('"visibility_changed":never;');
    expect(source).not.toMatch(/\| "type"/);
  });

  it("imports nothing, so it survives being moved to whichever root an author keeps it at", () => {
    const { source } = generate(harvest());
    expect(source).not.toMatch(/^\s*import /m);
    expect(source).not.toContain(' from "');
  });

  it("carries the scan as the baseline the update flow diffs against", () => {
    const { source, scan } = generate(harvest());
    expect(source).toContain("export const SCAN = {");
    expect(scan.views["classes.modules"]).toEqual(new Set(["OOQiHg", "gGYT1w", "yumWmQ"]));
    expect(source).toContain('"version": "9.9.9"');
    // Views, not tables: "what moved" is a question about identifier sets, and the runtime tables
    // answer a different one. The full class names are what a person searches the diff for.
    expect(source).toContain('"modelPill_gGYT1w"');
  });

  it("names what a person would otherwise have to go and look up", () => {
    const { source } = generate(
      harvest({
        replies: { responses: ["rename_tab_response"], unanswered: ["authenticate_mcp_server"] },
      }),
    );
    expect(source).toContain("//   authenticate_mcp_server");
    expect(source).toContain("//   update_session_state");
    expect(source).toContain("oblbPg");
  });

  it("renders the runtime tables as one plain ES module with the same data", async () => {
    const { runtime, tables } = generate(harvest());
    expect(runtime.startsWith("// Written by rigline")).toBe(true);
    const url = `data:text/javascript;base64,${Buffer.from(runtime).toString("base64")}`;
    const mod = (await import(url)) as { TABLES: unknown };
    expect(mod.TABLES).toEqual(JSON.parse(JSON.stringify(tables)));
  });

  it("summarises counts in one line and names missing anchors", () => {
    const { counts } = generate(harvest());
    expect(counts).toContain("3 modules, 5 classes");
    expect(counts).toContain("2+3 outbound / 1+1 inbound messages");
    expect(counts).toContain("2 replies, 2 payload fields");
    expect(counts).toContain(`${Object.keys(ANCHORS).length - 3} anchors missing`);
  });
});
