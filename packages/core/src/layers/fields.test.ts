import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { fieldsLayer, harvestOutboundPayloads } from "./fields.ts";
import { HarvestError } from "./types.ts";

describe("harvestOutboundPayloads", () => {
  it("splits entries on depth-1 commas only, even when a value is a call or an array", () => {
    const js = 'this.sendRequest({type:"complex_call",args:f(a,b),env:[1,2],opts:{x:1,y:2}});';
    const payloads = harvestOutboundPayloads(js);
    expect(payloads.fields.complex_call).toEqual(["args", "env", "opts"]);
    expect(payloads.partial).not.toContain("complex_call");
  });

  it("never includes 'type' in a field list", () => {
    const js = 'this.sendRequest({type:"plain",a:1,b:2});';
    const payloads = harvestOutboundPayloads(js);
    expect(payloads.fields.plain).not.toContain("type");
  });

  it("marks a payload partial when a send site spreads a variable in", () => {
    const js = 'this.sendRequest({type:"spready",a:1,...rest});';
    const payloads = harvestOutboundPayloads(js);
    expect(payloads.fields.spready).toEqual(["a"]);
    expect(payloads.partial).toContain("spready");
  });

  it("intersects, rather than unions, key sets across multiple send sites of the same type", () => {
    const js = [
      'this.sendRequest({type:"multi",a:1,b:2});',
      'this.sendRequest({type:"multi",a:1,c:3});',
    ].join("\n");
    const payloads = harvestOutboundPayloads(js);
    expect(payloads.fields.multi).toEqual(["a"]);
    expect(payloads.partial).toContain("multi");
  });

  it("does not mark partial a type sent identically from every site", () => {
    const js = [
      'this.sendRequest({type:"rename_tab",title:$,hasPendingPermissions:J,hasUnseenCompletion:Z});',
    ].join("\n");
    const payloads = harvestOutboundPayloads(js);
    expect(payloads.fields.rename_tab).toEqual([
      "hasPendingPermissions",
      "hasUnseenCompletion",
      "title",
    ]);
    expect(payloads.partial).not.toContain("rename_tab");
  });

  it("gives envelope types no entry at all, not an empty one", () => {
    const js = [
      'this.send({type:"request",channelId:$,requestId:J,request:Z});',
      'this.send({type:"response",requestId:$,response:Z});',
    ].join("\n");
    const payloads = harvestOutboundPayloads(js);
    expect(Object.keys(payloads.fields)).not.toContain("request");
    expect(Object.keys(payloads.fields)).not.toContain("response");
  });

  it("handles both sendRequest and send call sites", () => {
    const js = [
      'this.sendRequest({type:"a_request",x:1});',
      'this.send({type:"a_notify",y:2});',
    ].join("\n");
    const payloads = harvestOutboundPayloads(js);
    expect(payloads.fields.a_request).toEqual(["x"]);
    expect(payloads.fields.a_notify).toEqual(["y"]);
  });

  it("throws HarvestError matching /unbalanced/ when the payload walk runs off the end", () => {
    const js = 'this.sendRequest({type:"broken",a:1,b:f(1,2';
    expect(() => harvestOutboundPayloads(js)).toThrow(HarvestError);
    expect(() => harvestOutboundPayloads(js)).toThrow(/unbalanced/);
  });

  it("fieldsLayer's view projects 'type.field' strings", () => {
    const js = 'this.sendRequest({type:"rename_tab",title:$,hasPendingPermissions:J});';
    const data = fieldsLayer.harvest({ version: "0.0.0", webview: js, host: "", css: "" });
    const view = fieldsLayer.views.fields?.(data);
    expect(view).toEqual(new Set(["rename_tab.hasPendingPermissions", "rename_tab.title"]));
  });
});

describe("harvestOutboundPayloads against the corpus", () => {
  it.each(CORPUS_VERSIONS)("matches ground truth on %s", (version) => {
    const skip = missing(version);
    if (skip) {
      console.warn(skip);
      return;
    }
    const bundles = corpusBundles(version);
    const payloads = harvestOutboundPayloads(bundles.webview);

    expect(payloads.fields.rename_tab).toEqual([
      "hasPendingPermissions",
      "hasUnseenCompletion",
      "title",
    ]);
    expect(payloads.partial).not.toContain("rename_tab");

    expect(payloads.fields.update_session_state).toEqual(["sessionId", "state", "title"]);
    expect(payloads.partial).toContain("update_session_state");

    expect(Object.keys(payloads.fields)).not.toContain("request");
    expect(Object.keys(payloads.fields)).not.toContain("response");

    for (const keys of Object.values(payloads.fields)) {
      expect(keys).not.toContain("type");
    }
  });
});
