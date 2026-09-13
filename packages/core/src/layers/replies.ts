/**
 * Host reply type names reachable from this webview.
 *
 * Reply type names exist only in the extension-host bundle, nearly all written as
 * `{type:"..._response"}` object literals, but not every literal in that bundle is reachable from
 * here: `control_response` belongs to the CLI's own control protocol, and
 * `get_auth_status_response` has a handler in the host with no sender in this webview. Declaring
 * either would tap nothing, silently. So a reply is declarable exactly when this webview sends the
 * request it answers — that is what "reachable on this bus" means — and the set is derived from
 * the request side by naming convention rather than taken wholesale from the host bundle
 * (decisions.md, D9). Scanning forward from a host dispatch case to the reply literal that follows
 * was tried and does not work either: a case that delegates to a method has no literal of its own,
 * so the scan runs into the next case and mispairs.
 */

import { harvestProtocol } from "./protocol.ts";
import { type Bundles, defineLayer, HarvestError, type Layer } from "./types.ts";

const LAYER = "replies";

/** Reply type names this webview can receive, and the requests nothing answers by convention. */
export interface Responses {
  readonly responses: string[];
  readonly unanswered: string[];
}

/** Every `{type:"..._response"}` literal in the host bundle. */
const RESPONSE_LITERAL = /\{\s*type:\s*"([a-z][a-z0-9_]*_response)"/g;

/** Well under the roughly 98 to 109 measured; a bundle under this matched almost nothing. */
const RESPONSE_LITERAL_FLOOR = 60;

/**
 * A fraction, not a count: this measures a relationship between two harvested sets rather than
 * the size of one, so an absolute floor would encode today's protocol size and fire on every
 * smaller fixture, including a synthetic one built for a test.
 */
const MIN_PAIRED_FRACTION = 0.5;

/** Read the reply-literal set out of the host bundle, or throw `HarvestError`. */
function harvestResponseLiterals(hostJs: string): ReadonlySet<string> {
  const re = new RegExp(RESPONSE_LITERAL.source, RESPONSE_LITERAL.flags);
  const present = new Set<string>();
  let match = re.exec(hostJs);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) present.add(name);
    match = re.exec(hostJs);
  }
  if (present.size < RESPONSE_LITERAL_FLOOR) {
    throw new HarvestError(
      LAYER,
      `only ${present.size} literals in the host bundle, expected at least ${RESPONSE_LITERAL_FLOOR} — the anchor '{type:"..._response"}' matched almost nothing`,
    );
  }
  return present;
}

/** Reply-name candidates for one outbound request, tried in order; first present one wins. */
function replyCandidates(request: string): string[] {
  const candidates = [`${request}_response`];
  if (request.endsWith("_request")) {
    candidates.push(`${request.slice(0, -"_request".length)}_response`);
  }
  if (request.startsWith("get_")) {
    candidates.push(`${request.slice("get_".length)}_response`);
  }
  return candidates;
}

/**
 * Derive the reachable replies from the host bundle's reply literals and this webview's outbound
 * requests. `outboundRequests` normally comes from `harvestProtocol` run over the webview bundle.
 */
export function harvestResponses(hostJs: string, outboundRequests: readonly string[]): Responses {
  const present = harvestResponseLiterals(hostJs);

  if (outboundRequests.length === 0) {
    throw new HarvestError(LAYER, "no outbound requests to pair replies against");
  }

  const responses = new Set<string>();
  const unanswered: string[] = [];
  for (const request of outboundRequests) {
    const found = replyCandidates(request).find((candidate) => present.has(candidate));
    if (found !== undefined) responses.add(found);
    else unanswered.push(request);
  }

  const pairedFraction = responses.size / outboundRequests.length;
  if (pairedFraction < MIN_PAIRED_FRACTION) {
    throw new HarvestError(
      LAYER,
      `only ${responses.size} of ${outboundRequests.length} requests paired with a response, expected at least ${MIN_PAIRED_FRACTION * 100}% — the naming convention has moved`,
    );
  }

  return { responses: [...responses].sort(), unanswered: unanswered.sort() };
}

export const repliesLayer: Layer<Responses> = defineLayer({
  id: "replies",
  describe: "Host reply type names reachable from this webview.",
  harvest: (bundles: Bundles) =>
    harvestResponses(bundles.host, harvestProtocol(bundles.webview).outboundRequests),
  views: {
    replies: (data) => new Set(data.responses),
  },
});
