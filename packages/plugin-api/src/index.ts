/**
 * @prototype/plugin-api: what a Prototype plugin is written against.
 *
 * A plugin ships a prototype.json manifest and one browser-target ES module whose default export
 * has setup(ctx). This package holds the PluginContext type, the manifest type and schema, the
 * identifier unions generated from the installed extension, the curated anchor table, and the
 * pure helpers the host and core share so that a rule checked in Node and a rule checked in the
 * webview cannot drift apart.
 */

export const API_VERSION = 1 as const;

export type { AnchorName, AnchorSpec, Surface } from "./anchors.ts";
export { ANCHOR_NAMES, ANCHORS } from "./anchors.ts";
