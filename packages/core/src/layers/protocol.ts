/**
 * The message protocol between the webview and the extension host, in all four directions.
 *
 * The webview talks to the host over `postMessage`. Outbound, the app calls `sendRequest({type,
 * ...})`, which it wraps into a correlated `{type:"request",channelId,requestId,request:{...}}`
 * envelope, or `send({type, ...})` for a bare notification. Inbound, one listener enqueues every
 * message onto `this.fromHost`, and a `for await` loop dispatches on it with a `switch`; inbound
 * requests from the host are dispatched by a method whose body starts `processRequestInner($,J){
 * switch($.request.type){...`. Every message type is written down at exactly one of these four
 * sites, which is why the harvest anchors on them rather than scanning for `type:"..."` generally:
 * that scan pulls in every other protocol that happens to use the same JSON shape (markdown-AST
 * node types, Zod issue codes, MCP tool names, the Anthropic streaming events nested inside the
 * `io_message` push) and still misses every inbound request type, because requiring an underscore
 * does not separate `content_block_delta` from `invalid_type` (decisions.md, D8).
 *
 * `sendRequest`, `send`, `fromHost` and `processRequestInner` are unminified property names, so
 * anchoring on them is safe at the time this runs: codegen asserts every one of these anchors
 * against the pinned bundle and fails loudly if it moved, which is categorically different from a
 * plugin depending on a name at runtime and rendering a blank panel when it is wrong (P1). The
 * parameter names beside them are not part of the contract — `processRequestInner($,J)` in one
 * build is `processRequestInner(e,t)` in another — so every pattern here matches any identifier
 * shape rather than a specific one.
 */

import { type Bundles, defineLayer, HarvestError, type Layer } from "./types.ts";

const LAYER = "protocol";

/** One outbound `sendRequest({type:"...", ...})` call: the app expects a correlated reply. */
export const OUTBOUND_REQUEST = /sendRequest\(\{\s*type:\s*"([a-z][a-z0-9_]*)"/g;

/** One outbound `send({type:"...", ...})` call: a bare notification, no reply expected. */
export const OUTBOUND_NOTIFY = /[.\s]send\(\{\s*type:\s*"([a-z][a-z0-9_]*)"/g;

/**
 * The literal that opens the inbound-push dispatch loop: `for await (<ident> of this.fromHost)
 * switch (<ident>.type) {`. A plain string, not a regex, because nothing about it varies.
 */
const INBOUND_PUSH_ANCHOR = "of this.fromHost)switch(";

/**
 * The inbound-request dispatch method's signature, with any parameter names. This is the *Inner*
 * method, not its caller, which only sets up an `AbortController` and delegates; anchoring on the
 * caller would mean stepping over a whole function body to reach the switch, and would silently
 * latch onto some other switch if the delegation were ever inlined.
 */
const INBOUND_REQUEST_ANCHOR =
  /processRequestInner\([A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\)\s*\{/;

/** How many characters past an inbound-dispatch anchor its `switch` keyword may sit. */
const SWITCH_PROXIMITY = 40;

/** The message protocol, one sorted and deduplicated list of type names per direction. */
export interface Protocol {
  readonly outboundRequests: string[];
  readonly outboundNotifications: string[];
  readonly inboundPushes: string[];
  readonly inboundRequests: string[];
}

/**
 * Minimums for each direction's harvested count, well under every count this harvest has measured
 * (roughly 97 to 111, 9, 9 and 14 to 20). These guard the regexes above, not the extension: a
 * bundle that changed shape enough to defeat a pattern would otherwise regenerate a near-empty
 * table and refuse every plugin with a confident-looking "unknown message", rather than failing
 * where the real problem is.
 */
const FLOORS = {
  outboundRequests: 60,
  outboundNotifications: 6,
  inboundPushes: 6,
  inboundRequests: 10,
} as const satisfies Record<keyof Protocol, number>;

/**
 * Outbound "types" that wrap a payload rather than being one: `sendRequest`'s own envelope, and
 * the `"response"` the webview sends back for an inbound request. A plugin may still tap either,
 * since both travel the same bus as every other message, but their fields (`channelId`,
 * `requestId`) are correlation state that the fields layer never lets a plugin declare.
 */
export const ENVELOPE_TYPES = ["request", "response"] as const;

function drainSorted(js: string, pattern: RegExp): string[] {
  const re = new RegExp(pattern.source, pattern.flags);
  const found = new Set<string>();
  let match = re.exec(js);
  while (match !== null) {
    const captured = match[1];
    if (captured !== undefined) found.add(captured);
    match = re.exec(js);
  }
  return [...found].sort();
}

/**
 * Depth-1 `case "..."` labels inside the switch opening at `open` (the index of its `{`).
 * String-literal aware — single, double and template quotes, with escapes — so a brace or a
 * `case`-looking substring inside a string does not perturb depth or get mistaken for a label. A
 * nested switch's own cases sit at depth 2 or deeper and are excluded by construction, which is
 * the reason this tracks depth explicitly rather than regex-scanning the whole switch body.
 */
function topLevelSwitchCases(js: string, open: number): string[] {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  const cases = new Set<string>();
  const caseLabel = /^case\s*"([a-z][a-z0-9_]*)"/;

  for (let i = open; i < js.length; i++) {
    const c = js.charAt(i);
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") {
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) return [...cases].sort();
      continue;
    }
    if (depth === 1 && c === "c") {
      const found = caseLabel.exec(js.slice(i));
      if (found?.[1] !== undefined) cases.add(found[1]);
    }
  }
  throw new HarvestError(
    LAYER,
    "unbalanced braces walking a protocol switch — the anchor matched the wrong place",
  );
}

/** Find the `switch` within `SWITCH_PROXIMITY` characters after `anchorEnd`, then its cases. */
function switchCasesAfter(js: string, anchorEnd: number, anchorName: string): string[] {
  const window = js.slice(anchorEnd, anchorEnd + SWITCH_PROXIMITY);
  const offset = window.indexOf("switch");
  if (offset === -1) {
    throw new HarvestError(
      LAYER,
      `no switch within ${SWITCH_PROXIMITY} characters of the ${anchorName} anchor — the switch has moved`,
    );
  }
  const open = js.indexOf("{", anchorEnd + offset);
  if (open === -1) {
    throw new HarvestError(
      LAYER,
      `found 'switch' near the ${anchorName} anchor but no opening brace after it`,
    );
  }
  return topLevelSwitchCases(js, open);
}

/** Read the protocol out of the webview bundle, or throw `HarvestError`. */
export function harvestProtocol(js: string): Protocol {
  const outboundRequests = drainSorted(js, OUTBOUND_REQUEST);
  const outboundNotifications = drainSorted(js, OUTBOUND_NOTIFY);

  const pushAnchor = js.indexOf(INBOUND_PUSH_ANCHOR);
  if (pushAnchor === -1) {
    throw new HarvestError(LAYER, `inbound-push anchor not found: '${INBOUND_PUSH_ANCHOR}'`);
  }
  const pushOpen = js.indexOf("{", pushAnchor);
  if (pushOpen === -1) {
    throw new HarvestError(
      LAYER,
      "inbound-push anchor matched but its switch has no opening brace",
    );
  }
  const inboundPushes = topLevelSwitchCases(js, pushOpen);

  const requestAnchor = INBOUND_REQUEST_ANCHOR.exec(js);
  if (requestAnchor === null) {
    throw new HarvestError(
      LAYER,
      "inbound-request anchor not found: 'processRequestInner(<ident>,<ident>){'",
    );
  }
  const inboundRequests = switchCasesAfter(
    js,
    requestAnchor.index + requestAnchor[0].length,
    "inbound-request",
  );

  const protocol: Protocol = {
    outboundRequests,
    outboundNotifications,
    inboundPushes,
    inboundRequests,
  };
  for (const direction of Object.keys(FLOORS) as (keyof Protocol)[]) {
    const found = protocol[direction].length;
    const floor = FLOORS[direction];
    if (found < floor) {
      throw new HarvestError(
        LAYER,
        `only ${found} ${direction} harvested, expected at least ${floor}`,
      );
    }
  }
  return protocol;
}

/**
 * The sorted union of all four directions. Named explicitly rather than taken via
 * `Object.values(protocol)`, so that a field added to `Protocol` later cannot silently become a
 * declarable message type without a line here to say so.
 */
export function allMessageTypes(protocol: Protocol): string[] {
  return [
    ...new Set([
      ...protocol.outboundRequests,
      ...protocol.outboundNotifications,
      ...protocol.inboundPushes,
      ...protocol.inboundRequests,
    ]),
  ].sort();
}

export const protocolLayer: Layer<Protocol> = defineLayer({
  id: "protocol",
  describe:
    "The message protocol between the webview and the extension host, in all four directions.",
  harvest: (bundles: Bundles) => harvestProtocol(bundles.webview),
  views: {
    messages: (data) => new Set(allMessageTypes(data)),
  },
});
