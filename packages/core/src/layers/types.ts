/**
 * The identifier-layer registry's contract.
 *
 * A layer is one place in the extension that plugins may depend on, together with the harvest
 * that reads it out of the installed bundles. Codegen, the stability diff and the update gate
 * iterate the registry in `./index.ts`; nothing else enumerates the layers, so adding one is a
 * module that implements `Layer` plus a line in the registry.
 *
 * Every harvest anchors on names that cross a serialisation boundary or on unminified property
 * names, and asserts its anchors against the bundle in front of it (decisions.md, P1). A harvest
 * that cannot find an anchor, or that finds far fewer identifiers than any real bundle has ever
 * held, throws `HarvestError` rather than returning a plausible-looking partial result. The floors
 * are smoke alarms for the harvest's own regex, not judgements about the extension: a bundle that
 * changed shape enough to defeat a pattern would otherwise regenerate gutted tables and refuse
 * every plugin with a confident-looking "unknown class".
 */

/** The bundles one extension directory holds, read once and shared by every layer. */
export interface Bundles {
  /** The extension's version, read from its package.json rather than its directory name. */
  readonly version: string;
  /** webview/index.js: the React app, a single minified ES module. */
  readonly webview: string;
  /** extension.js: the extension-host bundle. Reply type names exist only here. */
  readonly host: string;
  /** webview/index.css: the CSS-modules output. Used to report unreachable classes, never harvested from. */
  readonly css: string;
}

/**
 * A harvest that cannot be trusted. Thrown, never returned: a missing anchor means the extension
 * moved something this depends on, and the right response is to stop and say which.
 */
export class HarvestError extends Error {
  /** The layer that failed. */
  readonly layer: string;

  constructor(layer: string, message: string) {
    super(`${layer}: ${message}`);
    this.name = "HarvestError";
    this.layer = layer;
  }
}

/**
 * One identifier layer.
 *
 * `T` is the layer's own shape (a class map, a protocol split by direction, ...). `views` project
 * it onto flat identifier sets for the stability diff, named so that a report can say which view
 * moved: the class layer, for example, exposes `classes`, `modules` and `locals`, because "a
 * module was retired" and "a local name changed" are different news.
 */
export interface Layer<T = unknown> {
  readonly id: string;
  /** One sentence for reports: what this layer holds. */
  readonly describe: string;
  /** Read the layer out of the bundles, or throw `HarvestError`. Pure: no I/O. */
  harvest(bundles: Bundles): T;
  /** Flat identifier sets for diffing, by view name. Stable across versions in name. */
  readonly views: Readonly<Record<string, (data: T) => ReadonlySet<string>>>;
}

/** Build a layer with its `T` inferred from `harvest`, so `views` type-check against it. */
export function defineLayer<T>(layer: Layer<T>): Layer<T> {
  return layer;
}
