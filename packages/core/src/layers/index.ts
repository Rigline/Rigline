/**
 * The identifier-layer registry.
 *
 * This is the one list of layers. Codegen renders every layer's harvest, the stability diff
 * compares every layer's views, and the update gate checks declarations against the tables built
 * from them; none of those enumerates the layers itself. Adding a layer is a module implementing
 * `Layer` plus an entry here and a field on `Harvest`.
 */

import { type Classes, classesLayer } from "./classes.ts";
import type { Scan } from "./diff.ts";
import { fieldsLayer, type OutboundPayloads } from "./fields.ts";
import { type Protocol, protocolLayer } from "./protocol.ts";
import { type ReactAnchors, reactLayer } from "./react.ts";
import { type Responses, repliesLayer } from "./replies.ts";
import type { Bundles, Layer } from "./types.ts";

export const LAYERS = [classesLayer, protocolLayer, fieldsLayer, repliesLayer, reactLayer] as const;

/** Every layer's harvest of one extension version, typed per layer. */
export interface Harvest {
  readonly version: string;
  readonly classes: Classes;
  readonly protocol: Protocol;
  readonly fields: OutboundPayloads;
  readonly replies: Responses;
  readonly react: ReactAnchors;
  /** The stylesheet, kept for the unreachable-class report; never harvested from. */
  readonly css: string;
}

/** Run every layer over one extension's bundles. Throws `HarvestError` from the first layer that cannot be trusted. */
export function harvestAll(bundles: Bundles): Harvest {
  return {
    version: bundles.version,
    classes: classesLayer.harvest(bundles),
    protocol: protocolLayer.harvest(bundles),
    fields: fieldsLayer.harvest(bundles),
    replies: repliesLayer.harvest(bundles),
    react: reactLayer.harvest(bundles),
    css: bundles.css,
  };
}

/** A harvest reduced to its views, keyed `layer.view`, for the stability diff and the baseline file. */
export function scanOf(harvest: Harvest): Scan {
  const data: Record<string, unknown> = {
    classes: harvest.classes,
    protocol: harvest.protocol,
    fields: harvest.fields,
    replies: harvest.replies,
    react: harvest.react,
  };
  const views: Record<string, ReadonlySet<string>> = {};
  // A layer's views take its own harvest type, so the tuple above is not a `Layer<unknown>[]`;
  // this is the one place the types are erased, and each layer is handed its own data by id.
  for (const layer of LAYERS as unknown as readonly Layer<unknown>[]) {
    for (const [name, view] of Object.entries(layer.views)) {
      views[`${layer.id}.${name}`] = view(data[layer.id]);
    }
  }
  return { version: harvest.version, views };
}

export type { Classes, ClassMap, SiteCounts } from "./classes.ts";
export {
  classCount,
  collidingLocalNames,
  cssClasses,
  harvestClasses,
  harvestClassMap,
  harvestClassSites,
  serialiseClassMap,
  siteCount,
  unreachableCssClasses,
} from "./classes.ts";
export type { Scan, ScanJson, ViewDiff } from "./diff.ts";
export { diffScans, formatDiff, scanFromJson, scansDiffer, scanToJson } from "./diff.ts";
export type { OutboundPayloads } from "./fields.ts";
export { harvestOutboundPayloads } from "./fields.ts";
export type { Protocol } from "./protocol.ts";
export { allMessageTypes, ENVELOPE_TYPES, harvestProtocol } from "./protocol.ts";
export type { ReactAnchors } from "./react.ts";
export { DEVTOOLS_HOOK, harvestReact } from "./react.ts";
export type { Responses } from "./replies.ts";
export { harvestResponses } from "./replies.ts";
export type { Bundles, Layer } from "./types.ts";
export { HarvestError } from "./types.ts";
