import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { harvestProtocol } from "./protocol.ts";
import { harvestResponses, repliesLayer } from "./replies.ts";
import { HarvestError } from "./types.ts";

/** `n` `{type:"<prefix>_<i>_response"}` reply literals, the host bundle's own shape. */
function replyLiterals(n: number, prefix = "resp"): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `x={type:"${prefix}_${i}_response"};`;
  }
  return out;
}

/**
 * A webview bundle that clears every protocol-layer floor, so `repliesLayer.harvest` (which runs
 * `harvestProtocol` over the webview to get its outbound requests) does not fail before replies
 * are ever considered. `extraRequests` are folded into the outbound-request set alongside the
 * padding needed to clear the floor.
 */
function webviewBundleWithRequests(extraRequests: string[]): string {
  const requestSites = extraRequests.map((name) => `this.sendRequest({type:"${name}"});`).join("");
  const padding = Array.from({ length: 60 }, (_, i) => `this.sendRequest({type:"pad_${i}"});`).join(
    "",
  );
  const notifications = Array.from({ length: 6 }, (_, i) => `this.send({type:"note_${i}"});`).join(
    "",
  );
  const pushCases = Array.from({ length: 6 }, (_, i) => `case"push_${i}":{noop()}break;`).join("");
  const requestCases = Array.from({ length: 10 }, (_, i) => `case"inreq_${i}":{noop()}break;`).join(
    "",
  );
  return [
    requestSites,
    padding,
    notifications,
    `async readMessages(){for await(let $ of this.fromHost)switch($.type){${pushCases}}}`,
    `processRequestInner($,J){switch($.request.type){${requestCases}}}`,
  ].join("\n");
}

describe("harvestResponses", () => {
  it("pairs candidates in order: <request>_response first", () => {
    const outboundRequests = ["rename_tab"];
    const hostJs = `x={type:"rename_tab_response"};${replyLiterals(60)}`;
    const { responses, unanswered } = harvestResponses(hostJs, outboundRequests);
    expect(responses).toContain("rename_tab_response");
    expect(unanswered).toEqual([]);
  });

  it("pairs <name>_request -> <name>_response when the plain suffix swap wins", () => {
    const outboundRequests = ["list_sessions_request"];
    const hostJs = `x={type:"list_sessions_response"};${replyLiterals(60)}`;
    const { responses, unanswered } = harvestResponses(hostJs, outboundRequests);
    expect(responses).toContain("list_sessions_response");
    expect(unanswered).toEqual([]);
  });

  it("pairs get_<name> -> <name>_response when the get_ prefix is stripped", () => {
    const outboundRequests = ["get_asset_uris"];
    const hostJs = `x={type:"asset_uris_response"};${replyLiterals(60)}`;
    const { responses, unanswered } = harvestResponses(hostJs, outboundRequests);
    expect(responses).toContain("asset_uris_response");
    expect(unanswered).toEqual([]);
  });

  it("tries candidates in order: <request>_response beats the get_ strip when both exist", () => {
    // get_widget: candidate order is get_widget_response, then widget_response (get_ stripped).
    // Both literals are present in the host; the first candidate must be the one chosen.
    const outboundRequests = ["get_widget"];
    const hostJs = `x={type:"get_widget_response"};x={type:"widget_response"};${replyLiterals(60)}`;
    const { responses } = harvestResponses(hostJs, outboundRequests);
    expect(responses).toEqual(["get_widget_response"]);
    expect(responses).not.toContain("widget_response");
  });

  it("reports a request with no matching reply as unanswered", () => {
    const outboundRequests = ["rename_tab", "authenticate_mcp_server"];
    const hostJs = `x={type:"rename_tab_response"};${replyLiterals(60)}`;
    const { responses, unanswered } = harvestResponses(hostJs, outboundRequests);
    expect(responses).toContain("rename_tab_response");
    expect(unanswered).toEqual(["authenticate_mcp_server"]);
  });

  it("never claims control_response: a literal present in the host with no requesting site", () => {
    const outboundRequests = ["rename_tab"];
    const hostJs = `x={type:"rename_tab_response"};x={type:"control_response"};${replyLiterals(60)}`;
    const { responses } = harvestResponses(hostJs, outboundRequests);
    expect(responses).not.toContain("control_response");
  });

  it("throws HarvestError when the host bundle has fewer than 60 reply literals", () => {
    const hostJs = replyLiterals(5);
    expect(() => harvestResponses(hostJs, ["rename_tab"])).toThrow(HarvestError);
    expect(() => harvestResponses(hostJs, ["rename_tab"])).toThrow(/literals in the host bundle/);
  });

  it("throws HarvestError when fewer than half the requests pair with a response", () => {
    // 60 literals to clear the first floor, none of which answer any of these five requests.
    const hostJs = replyLiterals(60, "unrelated");
    const outboundRequests = ["one", "two", "three", "four", "five"];
    expect(() => harvestResponses(hostJs, outboundRequests)).toThrow(/paired with a response/);
  });

  it("throws HarvestError when there are no outbound requests to pair against", () => {
    const hostJs = replyLiterals(60);
    expect(() => harvestResponses(hostJs, [])).toThrow(/no outbound requests/);
  });

  it("repliesLayer composes harvestResponses over harvestProtocol's outboundRequests", () => {
    const requestNames = Array.from({ length: 5 }, (_, i) => `req_${i}`);
    const webview = webviewBundleWithRequests(requestNames);
    const host = [...requestNames, ...Array.from({ length: 60 }, (_, i) => `pad_${i}`)]
      .map((name) => `x={type:"${name}_response"};`)
      .join("");
    const bundles = { version: "0.0.0", webview, host, css: "" };

    const data = repliesLayer.harvest(bundles);
    const expected = harvestResponses(host, harvestProtocol(webview).outboundRequests);
    expect(data).toEqual(expected);
    for (const name of requestNames) {
      expect(data.responses).toContain(`${name}_response`);
    }

    const view = repliesLayer.views.replies?.(data);
    expect(view).toEqual(new Set(data.responses));
  });
});

describe("harvestResponses against the corpus", () => {
  it.each(CORPUS_VERSIONS)("matches ground truth on %s", (version) => {
    const skip = missing(version);
    if (skip) {
      console.warn(skip);
      return;
    }
    const bundles = corpusBundles(version);
    const outboundRequests = harvestProtocol(bundles.webview).outboundRequests;
    const { responses, unanswered } = harvestResponses(bundles.host, outboundRequests);

    for (const name of [
      "rename_tab_response",
      "list_sessions_response",
      "get_session_response",
      "asset_uris_response",
    ]) {
      expect(responses).toContain(name);
    }
    expect(responses).not.toContain("control_response");
    expect(responses).not.toContain("get_auth_status_response");

    expect(unanswered).toEqual([
      "authenticate_mcp_server",
      "clear_mcp_server_auth",
      "submit_mcp_oauth_callback_url",
    ]);
  });
});
