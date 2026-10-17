/**
 * Writing per-plugin settings and Rigline's own, and the panel's Save of them (D138). The read half
 * is `readConfig`'s and the bake is `bakedSettings`'; this is the write.
 */
import {
  decodeSettingsPayload,
  type ModelSettings,
  readModelSettings,
  type RiglineSettings,
  sameValue,
} from "@rigline/plugin-api/internal";
import { type Document, isMap, isNode } from "yaml";
import { UserError } from "../errors.ts";
import { editConfig, readConfig } from "./config.ts";
import { readToken, sameToken } from "./save.ts";

/** What one plugin's section holds, as far as this engine reads it. */
type Section = Readonly<Record<string, unknown>>;

export interface SettingsSaved {
  readonly changed: boolean;
  /** The sections the save applied, by name — which is not the same as the file having moved. */
  readonly wrote: readonly string[];
  /** Sections whose file copy had moved since the panel loaded, by name (D92's rule, per section). */
  readonly overChange: readonly string[];
  /** Sections naming a plugin this machine has not got, skipped rather than written. */
  readonly unknown: readonly string[];
  /** Rigline's own blocks the save applied, by their key in the file. */
  readonly own: readonly (keyof RiglineSettings)[];
  /** Those of them whose file copy had moved since the panel loaded. */
  readonly ownOverChange: readonly (keyof RiglineSettings)[];
}

/**
 * Make each named section equal its new value, and each of Rigline's own blocks read as its new
 * value, touching only the keys that moved.
 *
 * Key by key rather than replacing the section, so a comment on a key the save did not change
 * survives — which is what `disable`, `enable` and `rigline layout` already promise of this file
 * (D91). A key absent from the new value is deleted; an empty section, and an empty `settings`, go.
 */
export function writeSettings(
  configPath: string,
  sections: Readonly<Record<string, Section>>,
  own: Partial<RiglineSettings> = {},
): boolean {
  return editConfig(configPath, (doc) => {
    let changed = false;
    for (const [name, wanted] of Object.entries(sections)) {
      changed = setSection(doc, name, wanted) || changed;
    }
    const node = doc.get("settings", true);
    if (isMap(node) && node.items.length === 0) doc.delete("settings");
    if (own.model !== undefined) changed = setModel(doc, own.model) || changed;
    return changed;
  });
}

/**
 * The `model` block made to read as `wanted`. A key at its default — `off`, no default — is
 * deleted rather than written, and the block goes when that empties it. A key a later Rigline wrote
 * stays (D110), as does a mode this one reads as `off` while `off` is what is wanted.
 */
function setModel(doc: Document, wanted: ModelSettings): boolean {
  const read = readModelSettings((doc.toJS() as Record<string, unknown> | null)?.model);
  // `editConfig` read the file through `readConfig` first, which refuses a malformed block.
  if ("problem" in read) throw new UserError(read.problem);
  const held = read.settings;
  const set = (key: string, value: unknown): void => {
    if (!isMap(doc.get("model", true))) doc.set("model", doc.createNode({}));
    doc.setIn(["model", key], value);
  };
  let changed = false;
  if (held.requireChoice !== wanted.requireChoice) {
    if (wanted.requireChoice === "off") doc.deleteIn(["model", "requireChoice"]);
    else set("requireChoice", wanted.requireChoice);
    changed = true;
  }
  if (!sameValue(held.default, wanted.default)) {
    if (wanted.default === null) doc.deleteIn(["model", "default"]);
    else set("default", doc.createNode(wanted.default, { flow: true }));
    changed = true;
  }
  const node = doc.get("model", true);
  if (isMap(node) && node.items.length === 0) doc.delete("model");
  return changed;
}

// No repair of a section that is not a mapping: `editConfig` reads the file first, so `readConfig`
// has already refused it by name and left it for the person who wrote it (D91).
function setSection(doc: Document, name: string, wanted: Section): boolean {
  let changed = false;
  for (const key of keysIn(doc, name)) {
    if (Object.hasOwn(wanted, key)) continue;
    doc.deleteIn(["settings", name, key]);
    changed = true;
  }
  for (const [key, value] of Object.entries(wanted)) {
    // A collection comes back as its node, which compares unequal to anything a payload holds.
    const current: unknown = doc.getIn(["settings", name, key]);
    if (current !== undefined && sameValue(isNode(current) ? current.toJS(doc) : current, value)) {
      continue;
    }
    doc.setIn(["settings", name, key], value);
    changed = true;
  }
  const node = doc.getIn(["settings", name], true);
  if (isMap(node) && node.items.length === 0) {
    doc.deleteIn(["settings", name]);
    changed = true;
  }
  return changed;
}

/** The keys the file's section names, as it names them. */
function keysIn(doc: Document, name: string): string[] {
  const node = doc.getIn(["settings", name], true);
  if (!isMap(node)) return [];
  return node.items.flatMap((item) => {
    const key = (item.key as { value?: unknown } | null)?.value;
    return typeof key === "string" ? [key] : [];
  });
}

/**
 * The panel's settings Save, by the route D93 built for the layout: the link's payload, checked
 * against this machine's token, written per section and per block of Rigline's own.
 *
 * `installed` is every discovered plugin's name, not every enabled one: a section naming a plugin
 * that is only switched off belongs in the file, and one naming a plugin this machine has never had
 * is skipped rather than refused, so the payload's other sections still land (D138).
 */
export function saveSettingsFromPanel(
  configPath: string,
  tokenPath: string,
  encoded: string,
  installed: ReadonlySet<string>,
): SettingsSaved {
  const decoded = decodeSettingsPayload(encoded);
  if ("problem" in decoded) throw new UserError(`not saved: ${decoded.problem}`);
  const { payload } = decoded;
  const mine = readToken(tokenPath);
  if ("problem" in mine) throw new UserError(`not saved: ${mine.problem}`);
  if (!sameToken(payload.token, mine.token)) {
    throw new UserError(
      "not saved: the Save link's token is not this machine's; reload the panel to pick up the current one",
    );
  }
  const sections = Object.entries(payload.sections);
  const unknown = sections.filter(([name]) => !installed.has(name)).map(([name]) => name);
  const known = sections.filter(([name]) => installed.has(name));
  const config = readConfig(configPath);
  const overChange = known
    .filter(([name, section]) => !sameValue(config.settings[name] ?? {}, section.from))
    .map(([name]) => name);
  const wanted = Object.fromEntries(known.map(([name, section]) => [name, section.to]));
  const ownTo = payload.rigline?.to ?? {};
  const ownFrom = payload.rigline?.from ?? {};
  const held: RiglineSettings = { model: config.model };
  const own = (Object.keys(ownTo) as (keyof RiglineSettings)[]).filter((block) =>
    Object.hasOwn(held, block),
  );
  return {
    changed: writeSettings(configPath, wanted, ownTo),
    wrote: known.map(([name]) => name),
    overChange,
    unknown,
    own,
    ownOverChange: own.filter((block) => !sameValue(held[block], ownFrom[block])),
  };
}
