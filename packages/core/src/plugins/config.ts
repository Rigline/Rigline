/**
 * `~/.rigline/config.yaml`, what a person decides, and `~/.rigline/sources.json`, what `add`
 * recorded (D91).
 *
 * The first is edited by hand as well as by commands, so a command edits the document in place and
 * keeps everything a person wrote there, comments included. The second only the engine writes (D74).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Layout } from "@rigline/plugin-api";
import { Document, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { UserError } from "../errors.ts";

/**
 * Where a plugin came from, recorded by `add` (D49).
 *
 * A discriminated union from its first member, so that the npm source and the git source deferred
 * in D33 arrive as adapters rather than as a migration of everything already written. A plugin
 * somebody put in `~/.rigline/plugins/` by hand has no record at all, and that is the honest cost
 * of dropping a directory in: nothing knows where it came from, so nothing can fetch a newer one.
 */
export type PluginSource = PathSource | NpmSource;

export interface PathSource {
  readonly kind: "path";
  /** The directory it was copied from, absolute. `update` does not follow it; `add` again does. */
  readonly from: string;
  /** When, as an ISO instant. The record is for a person reading it as much as for a command. */
  readonly addedAt: string;
}

export interface NpmSource {
  readonly kind: "npm";
  /** The package name, which need not be the plugin's: the manifest owns that. */
  readonly name: string;
  /** Exact, always. There are no ranges (D58). */
  readonly version: string;
  /** The dist-tag `update` follows, or null when a person named a version and so pinned it. */
  readonly tag: string | null;
  /** What the bytes hashed to, as SRI, checked again on every fetch (D49). */
  readonly integrity: string;
  readonly addedAt: string;
}

/** `~/.rigline/config.yaml`, as far as this engine reads it. */
export interface PluginsConfig {
  /** Where it was read from, so a report about it can name the file somebody has to edit. */
  readonly path: string;
  readonly disabled: readonly string[];
  /** As written, entries that do not resolve included (D92). */
  readonly layout: Layout;
}

/** The three files the split is between, as `riglinePaths` names them. */
export interface ConfigFiles {
  readonly config: string;
  readonly sources: string;
  /** `config.json`, which held both before D91. */
  readonly legacy: string;
}

const HEADER =
  " Rigline's settings. Edit freely: rigline's commands keep your comments.\n" +
  " https://github.com/Rigline/Rigline/blob/main/docs/config.md";

/** `[a]` stays `[a]` rather than becoming `[ a ]`. */
const TO_STRING = { flowCollectionPadding: false } as const;

/** Absent means nothing is disabled; malformed is a person's mistake, loud. */
export function readConfig(path: string): PluginsConfig {
  if (!existsSync(path)) return { path, disabled: [], layout: {} };
  return configOf(path, parseConfig(path, readFileSync(path, "utf8")));
}

/**
 * Applies `edit` to the file's document and writes it back when `edit` says it changed something,
 * in the line endings the file already had. A file that is not there yet starts with a header.
 */
export function editConfig(path: string, edit: (doc: Document) => boolean): boolean {
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  const doc = text === null ? freshConfig() : parseConfig(path, text);
  configOf(path, doc);
  if (!edit(doc)) return false;
  const eol = text?.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(path, doc.toString(TO_STRING).replaceAll("\n", eol));
  return true;
}

/** Appends `name` to the list at `path`, making the list if there is none. False if already there. */
export function addToList(doc: Document, path: readonly string[], name: string): boolean {
  const node = doc.getIn(path, true);
  if (isSeq(node)) {
    if (node.items.some((item) => isScalar(item) && item.value === name)) return false;
    node.add(doc.createNode(name));
  } else {
    doc.setIn(path, doc.createNode([name]));
  }
  return true;
}

/** Takes `name` out of the list at `path`. False if it was not there. */
export function removeFromList(doc: Document, path: readonly string[], name: string): boolean {
  const node = doc.getIn(path, true);
  if (!isSeq(node)) return false;
  const before = node.items.length;
  node.items = node.items.filter((item) => !(isScalar(item) && item.value === name));
  return node.items.length !== before;
}

function freshConfig(): Document {
  const doc = new Document({});
  doc.commentBefore = HEADER;
  return doc;
}

function parseConfig(path: string, text: string): Document {
  const doc = parseDocument(text, { prettyErrors: true });
  const error = doc.errors[0];
  if (error) throw new UserError(`${path} is not valid YAML: ${error.message.trimEnd()}`);
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new UserError(`${path} must be a mapping of setting names to values`);
  }
  return doc;
}

function configOf(path: string, doc: Document): PluginsConfig {
  const value = (doc.toJS() ?? {}) as Record<string, unknown>;
  // `disabled:` with nothing after it is a list somebody emptied by hand.
  const disabled = value.disabled ?? [];
  if (!Array.isArray(disabled) || !disabled.every((d) => typeof d === "string")) {
    throw new UserError(`${path}: "disabled" must be a list of plugin names`);
  }
  return { path, disabled, layout: layoutOf(path, value.layout) };
}

/**
 * The layout's shape, which is a person's mistake when wrong and so loud. What its entries mean is
 * `layoutProblems`', and reported rather than thrown.
 */
function layoutOf(path: string, value: unknown): Layout {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new UserError(`${path}: "layout" must be a mapping of places to lists of elements`);
  }
  const layout: Record<string, readonly string[]> = {};
  for (const [place, names] of Object.entries(value)) {
    if (names === null) layout[place] = [];
    else if (Array.isArray(names) && names.every((n) => typeof n === "string")) {
      layout[place] = names;
    } else {
      throw new UserError(`${path}: "layout.${place}" must be a list of plugin/element names`);
    }
  }
  return layout;
}

/**
 * `~/.rigline/sources.json`, by plugin name.
 *
 * A source whose `kind` this engine does not know is skipped with a line rather than thrown over
 * (D74): the wrapper is routinely newer, and one unreadable entry must not cost every command.
 */
export function readSources(
  path: string,
  log: (line: string) => void = () => {},
): Readonly<Record<string, PluginSource>> {
  const sources: Record<string, PluginSource> = {};
  for (const [name, source] of Object.entries(readJsonObject(path) ?? {})) {
    // Named, not dropped in silence: a plugin whose record cannot be read looks hand-placed, and
    // `update` cannot move one of those (D49).
    if (!isPluginSource(source)) {
      log(
        `${path}: the source recorded for "${name}" is ${describeKind(source)}, so it is ignored`,
      );
      continue;
    }
    sources[name] = source;
  }
  return sources;
}

/**
 * `sources.json` with `mutate` applied, over the raw JSON, so a record this engine cannot read — a
 * newer wrapper's — is written back as it was rather than dropped.
 */
export function updateSources(
  path: string,
  mutate: (sources: Record<string, unknown>) => void,
): void {
  const value = readJsonObject(path) ?? {};
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Splits a `config.json` from before D91 into the two files that replaced it, once. Returns a line
 * saying what it did, or null when there was nothing to do.
 */
export function splitLegacyConfig(files: ConfigFiles): string | null {
  if (!existsSync(files.legacy)) return null;
  if (existsSync(files.config) || existsSync(files.sources)) {
    // Written by an older engine after the split, so what it says is not what loads.
    return (
      `${files.legacy} is not read: ${files.config} and ${files.sources} replaced it. ` +
      "An older rigline wrote it; delete it."
    );
  }
  const { sources, ...rest } = readJsonObject(files.legacy) ?? {};
  if (sources !== undefined) writeFileSync(files.sources, `${JSON.stringify(sources, null, 2)}\n`);
  const doc = freshConfig();
  for (const [key, value] of Object.entries(rest)) doc.set(key, doc.createNode(value));
  writeFileSync(files.config, doc.toString(TO_STRING));
  // Forced, because two engines can split at once — the companion and a terminal — and the second
  // to get here finds it gone, having written what the first did.
  rmSync(files.legacy, { force: true });
  return `moved ${files.legacy} into ${files.config} and ${files.sources}`;
}

/** The file as raw JSON, or null when it is not there. Throws for anything that is not an object. */
function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UserError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError(`${path} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** What to call a source this cannot read: a kind it has not heard of, or an edited file. */
function describeKind(source: unknown): string {
  const kind = (source as { kind?: unknown } | null)?.kind;
  return typeof kind === "string"
    ? `of kind "${kind}", which this engine does not know — a newer rigline may`
    : "not a source this can read";
}

export function isPluginSource(value: unknown): value is PluginSource {
  // Read as a bag of unknowns rather than as a partial of the union: the two members disagree about
  // `kind`, so their intersection has no value for it and every field reads as never.
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  if (typeof source.addedAt !== "string") return false;
  if (source.kind === "path") return typeof source.from === "string";
  if (source.kind === "npm") {
    return (
      typeof source.name === "string" &&
      typeof source.version === "string" &&
      typeof source.integrity === "string" &&
      (source.tag === null || typeof source.tag === "string")
    );
  }
  return false;
}

/** Where a plugin came from, as one phrase a report can put after "added from". */
export function describeSource(source: PluginSource): string {
  return source.kind === "path"
    ? source.from
    : `${source.name}@${source.version} on npm` +
        (source.tag === null ? ", pinned" : `, following ${source.tag}`);
}
