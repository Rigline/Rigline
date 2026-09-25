/**
 * Declarable fields of every outbound request and notification payload, one level under the
 * protocol layer's message types.
 *
 * A plugin that rewrites a message may only touch fields the app is actually seen sending, and
 * only fields present at every site that sends that type — a field present at just one send site
 * is not present in every message of that type, and the host refuses to apply a patch to a field
 * that is absent from the message being sent. Reads never need this declaration (a missing read
 * degrades visibly as `undefined`); a missing write would land on nothing, in silence. So the
 * field harvest exists only to gate writes, and intersects rather than unions across sites
 * (decisions.md, D10).
 */

import { ENVELOPE_TYPES, OUTBOUND_NOTIFY, OUTBOUND_REQUEST } from "./protocol.ts";
import { type Bundles, defineLayer, HarvestError, type Layer } from "./types.ts";

const LAYER = "fields";

/** Per message type, its declarable field names and whether that list is a lower bound. */
export interface OutboundPayloads {
  readonly fields: Readonly<Record<string, string[]>>;
  /** Types whose field list may be missing keys: a spread hid some, or sites disagreed. */
  readonly partial: string[];
}

interface SiteFields {
  readonly keys: ReadonlySet<string>;
  readonly spread: boolean;
}

const SIMPLE_KEY = /^\s*(?:["'`]([A-Za-z_$][\w$]*)["'`]|([A-Za-z_$][\w$]*))\s*:/;

/**
 * Depth-1 keys of the object literal opening at `open` (the index of its `{`). Tracks all three
 * bracket kinds — `{`, `(` and `[` — because a field's value can itself be a call (`args:f(a,b)`)
 * or an array (`env:[1,2]`) without ending the entry, and entries split on depth-1 commas only, so
 * `opts:{x:1,y:2}` is one entry, not two. String-literal aware in the same way the protocol
 * layer's switch walk is, so a comma or bracket inside a nested string does not perturb depth. An
 * entry that does not parse as a simple `key:` or `"key":` prefix — a `...rest` spread or a
 * computed key — sets `spread`, because either means this site's key list is a lower bound.
 */
function topLevelKeys(js: string, open: number): SiteFields {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let entryStart = open + 1;
  const keys = new Set<string>();
  let spread = false;

  const closeEntry = (end: number) => {
    const entry = js.slice(entryStart, end);
    if (entry.trim().length === 0) return;
    const found = SIMPLE_KEY.exec(entry);
    const key = found?.[1] ?? found?.[2];
    if (key === undefined) {
      spread = true;
    } else if (key !== "type") {
      keys.add(key);
    }
  };

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
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) {
        closeEntry(i);
        return { keys, spread };
      }
      continue;
    }
    if (depth === 1 && c === ",") {
      closeEntry(i);
      entryStart = i + 1;
    }
  }
  throw new HarvestError(
    LAYER,
    "unbalanced brackets walking an outbound payload — the anchor matched the wrong place",
  );
}

/** Read every outbound send site's field names out of the webview bundle. */
export function harvestOutboundPayloads(js: string): OutboundPayloads {
  const sitesByType = new Map<string, SiteFields[]>();

  for (const pattern of [OUTBOUND_REQUEST, OUTBOUND_NOTIFY]) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match = re.exec(js);
    while (match !== null) {
      const type = match[1];
      if (type !== undefined && !(ENVELOPE_TYPES as readonly string[]).includes(type)) {
        const open = js.indexOf("{", match.index);
        const site = topLevelKeys(js, open);
        const sites = sitesByType.get(type);
        if (sites) sites.push(site);
        else sitesByType.set(type, [site]);
      }
      match = re.exec(js);
    }
  }

  const fields: Record<string, string[]> = {};
  const partial: string[] = [];
  for (const [type, sites] of sitesByType) {
    const union = new Set<string>();
    for (const site of sites) {
      for (const key of site.keys) union.add(key);
    }
    let intersection = new Set(union);
    for (const site of sites) {
      intersection = new Set([...intersection].filter((key) => site.keys.has(key)));
    }
    fields[type] = [...intersection].sort();
    if (intersection.size < union.size || sites.some((site) => site.spread)) {
      partial.push(type);
    }
  }
  partial.sort();

  return { fields, partial };
}

export const fieldsLayer: Layer<OutboundPayloads> = defineLayer({
  id: "fields",
  describe: "Declarable fields of every outbound request and notification payload.",
  harvest: (bundles: Bundles) => harvestOutboundPayloads(bundles.webview),
  views: {
    fields: (data) => {
      const out = new Set<string>();
      for (const [type, keys] of Object.entries(data.fields)) {
        for (const key of keys) out.add(`${type}.${key}`);
      }
      return out;
    },
  },
});
