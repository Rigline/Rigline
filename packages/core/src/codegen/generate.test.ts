import { ANCHORS } from "@prototype/plugin-api";
import { describe, expect, it } from "vitest";
import type { Harvest } from "../layers/index.ts";
import { generate } from "./generate.ts";

const harvest = (overrides: Partial<Harvest> = {}): Harvest => ({
  version: "9.9.9",
  classes: {
    gGYT1w: { modelPill: "modelPill_gGYT1w", modelPillRow: "modelPillRow_gGYT1w" },
    OOQiHg: { tab: "tab_OOQiHg", sessionItem: "sessionItem_OOQiHg" },
    yumWmQ: { tab: "tab_yumWmQ" },
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

  it("renders every protocol direction, the replies and the fields as types", () => {
    const { source } = generate(harvest());
    for (const name of [
      "OutboundRequest",
      "OutboundNotification",
      "InboundPush",
      "InboundRequest",
      "InboundResponse",
    ]) {
      expect(source).toContain(`export type ${name} =`);
    }
    expect(source).toMatch(/"rename_tab":\n\s+\| "hasPendingPermissions"\n\s+\| "title";/);
    expect(source).toContain('"visibility_changed":never;');
    expect(source).not.toMatch(/\| "type"/);
    expect(source).toContain("export const TABLES: IdentifierTables = {");
  });

  it("renders the runtime tables as one plain ES module with the same data", async () => {
    const { runtime, tables } = generate(harvest());
    expect(runtime.startsWith("// Written by prototype")).toBe(true);
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
