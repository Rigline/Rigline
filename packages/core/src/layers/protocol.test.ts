import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { allMessageTypes, ENVELOPE_TYPES, harvestProtocol, protocolLayer } from "./protocol.ts";
import { HarvestError } from "./types.ts";

/** `n` distinct `sendRequest({type:"<prefix>_<i>"})` call sites. */
function requestSites(n: number, prefix = "req"): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `this.sendRequest({type:"${prefix}_${i}",value:${i}});`;
  }
  return out;
}

/** `n` distinct `send({type:"<prefix>_<i>"})` call sites. */
function notifySites(n: number, prefix = "note"): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `this.send({type:"${prefix}_${i}"});`;
  }
  return out;
}

/** The inbound-push dispatch loop, one case per entry, each case body given verbatim. */
function pushSwitch(cases: Record<string, string>): string {
  const body = Object.entries(cases)
    .map(([name, block]) => `case"${name}":{${block}}break;`)
    .join("");
  return `async readMessages(){for await(let $ of this.fromHost)switch($.type){${body}}}`;
}

/** The inbound-request dispatch switch, one case per entry, each case body given verbatim. */
function requestSwitch(cases: Record<string, string>): string {
  const body = Object.entries(cases)
    .map(([name, block]) => `case"${name}":{${block}}break;`)
    .join("");
  return `processRequestInner($,J){switch($.request.type){${body}}}`;
}

function namedCases(prefix: string, n: number): Record<string, string> {
  const cases: Record<string, string> = {};
  for (let i = 0; i < n; i++) cases[`${prefix}_${i}`] = `handle("${prefix}_${i}")`;
  return cases;
}

/** A webview bundle with every anchor present and every floor comfortably cleared by default. */
function webviewBundle(opts?: {
  requestCount?: number;
  notifyCount?: number;
  pushCases?: Record<string, string>;
  requestCases?: Record<string, string>;
}): string {
  const requestCount = opts?.requestCount ?? 70;
  const notifyCount = opts?.notifyCount ?? 8;
  const pushCases = opts?.pushCases ?? namedCases("push", 8);
  const requestCases = opts?.requestCases ?? namedCases("inreq", 12);
  return [
    "var minifiedPreamble=1;function noop(){}",
    requestSites(requestCount),
    notifySites(notifyCount),
    pushSwitch(pushCases),
    requestSwitch(requestCases),
  ].join("\n");
}

describe("harvestProtocol", () => {
  it("harvests all four directions from a realistic bundle", () => {
    const protocol = harvestProtocol(webviewBundle());
    expect(protocol.outboundRequests).toHaveLength(70);
    expect(protocol.outboundNotifications).toHaveLength(8);
    expect(protocol.inboundPushes).toHaveLength(8);
    expect(protocol.inboundRequests).toHaveLength(12);
    expect(protocol.outboundRequests).toEqual([...protocol.outboundRequests].sort());
  });

  it("dedupes a type sent from more than one site", () => {
    const js = webviewBundle({
      requestCount: 60,
    }).replace(
      "var minifiedPreamble=1;function noop(){}",
      'var minifiedPreamble=1;function noop(){}this.sendRequest({type:"req_0",other:1});',
    );
    const protocol = harvestProtocol(js);
    expect(protocol.outboundRequests.filter((r) => r === "req_0")).toHaveLength(1);
  });

  it("does not let a nested switch's cases leak into the outer switch", () => {
    const js = webviewBundle({
      pushCases: {
        push_0: 'switch(x){case"inner_a":break;case"inner_b":break;}',
        push_1: "noop()",
        ...namedCases("filler", 6),
      },
    });
    const protocol = harvestProtocol(js);
    expect(protocol.inboundPushes).toEqual(expect.arrayContaining(["push_0", "push_1"]));
    expect(protocol.inboundPushes).not.toContain("inner_a");
    expect(protocol.inboundPushes).not.toContain("inner_b");
  });

  it("does not let braces inside string or template literals perturb the depth walk", () => {
    const js = webviewBundle({
      pushCases: {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: this literally is the JS source under test.
        push_0: 'let s="{not a case}";let t=`template ${1 + 1} more {}`;noop()',
        push_1: "noop()",
        ...namedCases("filler", 6),
      },
    });
    const protocol = harvestProtocol(js);
    expect(protocol.inboundPushes).toEqual(expect.arrayContaining(["push_0", "push_1"]));
  });

  it("throws matching /anchor/ when a bundle has none of the four anchors", () => {
    expect(() => harvestProtocol("this bundle has nothing in it at all")).toThrow(/anchor/);
  });

  it("throws HarvestError naming the direction when outboundRequests is under its floor", () => {
    const js = webviewBundle({ requestCount: 5 });
    expect(() => harvestProtocol(js)).toThrow(HarvestError);
    expect(() => harvestProtocol(js)).toThrow(/outboundRequests/);
  });

  it("throws HarvestError naming the direction when outboundNotifications is under its floor", () => {
    const js = webviewBundle({ notifyCount: 1 });
    expect(() => harvestProtocol(js)).toThrow(/outboundNotifications/);
  });

  it("throws HarvestError naming the direction when inboundPushes is under its floor", () => {
    const js = webviewBundle({ pushCases: namedCases("push", 2) });
    expect(() => harvestProtocol(js)).toThrow(/inboundPushes/);
  });

  it("throws HarvestError naming the direction when inboundRequests is under its floor", () => {
    const js = webviewBundle({ requestCases: namedCases("inreq", 3) });
    expect(() => harvestProtocol(js)).toThrow(/inboundRequests/);
  });

  it("fails loudly when the inbound-push switch runs off the end unbalanced", () => {
    const full = webviewBundle();
    const marker = "async readMessages(){for await(let $ of this.fromHost)switch($.type){";
    const anchorIdx = full.indexOf(marker);
    // Cut partway into the first case body, well before anything closes the switch.
    const truncated = full.slice(0, anchorIdx + marker.length + 20);
    expect(() => harvestProtocol(truncated)).toThrow(/unbalanced/);
  });

  it("computes allMessageTypes as the sorted union of all four directions, envelopes included", () => {
    const js = webviewBundle({
      notifyCount: 0,
    }).replace(
      "var minifiedPreamble=1;function noop(){}",
      'var minifiedPreamble=1;function noop(){}this.send({type:"request",channelId:1,requestId:2,request:{}});this.send({type:"response",requestId:2,response:{}});' +
        notifySites(7, "extra"),
    );
    const protocol = harvestProtocol(js);
    expect(protocol.outboundNotifications).toEqual(expect.arrayContaining([...ENVELOPE_TYPES]));
    const all = allMessageTypes(protocol);
    expect(all).toEqual([...all].sort());
    expect(all).toEqual(expect.arrayContaining(["request", "response"]));
  });

  it("protocolLayer's messages view matches allMessageTypes(harvestProtocol(...))", () => {
    const webview = webviewBundle();
    const data = protocolLayer.harvest({ version: "0.0.0", webview, host: "", css: "" });
    const view = protocolLayer.views.messages?.(data);
    expect(view).toEqual(new Set(allMessageTypes(data)));
  });
});

describe("harvestProtocol against the corpus", () => {
  const floors = {
    outboundRequests: 60,
    outboundNotifications: 6,
    inboundPushes: 6,
    inboundRequests: 10,
  } as const;

  it.each(CORPUS_VERSIONS)("clears every floor and matches ground truth on %s", (version) => {
    const skip = missing(version);
    if (skip) {
      console.warn(skip);
      return;
    }
    const bundles = corpusBundles(version);
    const protocol = harvestProtocol(bundles.webview);

    expect(protocol.outboundRequests.length).toBeGreaterThanOrEqual(floors.outboundRequests);
    expect(protocol.outboundNotifications.length).toBeGreaterThanOrEqual(
      floors.outboundNotifications,
    );
    expect(protocol.inboundPushes.length).toBeGreaterThanOrEqual(floors.inboundPushes);
    expect(protocol.inboundRequests.length).toBeGreaterThanOrEqual(floors.inboundRequests);

    for (const name of [
      "rename_tab",
      "set_model",
      "update_session_state",
      "list_sessions_request",
      "get_session_request",
      "get_asset_uris",
      "init",
    ]) {
      expect(protocol.outboundRequests).toContain(name);
    }

    expect(protocol.outboundNotifications).toEqual([
      "cancel_request",
      "close_channel",
      "interrupt_claude",
      "io_message",
      "launch_claude",
      "request",
      "response",
      "start_speech_to_text",
      "stop_speech_to_text",
    ]);

    expect(protocol.inboundPushes).toContain("io_message");
    expect(protocol.inboundRequests).toContain("tool_permission_request");
    expect(protocol.inboundRequests).toContain("selection_changed");

    const all = allMessageTypes(protocol);
    for (const bogus of [
      "content_block_delta",
      "text_delta",
      "invalid_type",
      "not_multiple_of",
      "blockquote",
      "paragraph",
    ]) {
      expect(all).not.toContain(bogus);
    }
  });

  it("the messages view is identical between 2.1.268 and 2.1.270, or differs by a small number of changes", () => {
    const skipA = missing("2.1.268");
    const skipB = missing("2.1.270");
    if (skipA || skipB) {
      console.warn(skipA || skipB);
      return;
    }
    const a = allMessageTypes(harvestProtocol(corpusBundles("2.1.268").webview));
    const b = allMessageTypes(harvestProtocol(corpusBundles("2.1.270").webview));
    const added = b.filter((type) => !a.includes(type));
    const removed = a.filter((type) => !b.includes(type));
    if (added.length > 0 || removed.length > 0) {
      console.log("protocol messages view, 2.1.268 -> 2.1.270:", { added, removed });
    }
    expect(added.length + removed.length).toBeLessThan(20);
  });
});
