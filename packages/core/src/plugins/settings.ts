/**
 * Writing per-plugin settings, and the panel's Save of them (D138). The read half is `readConfig`'s
 * and the bake is `bakedSettings`'; this is the write.
 */
import { decodeSettingsPayload } from "@rigline/plugin-api/internal";
import { type Document, isMap } from "yaml";
import { UserError } from "../errors.ts";
import { editConfig, readConfig } from "./config.ts";
import { readToken, sameToken } from "./save.ts";

/** What one plugin's section holds, as far as this engine reads it. */
type Section = Readonly<Record<string, unknown>>;

export interface SettingsSaved {
  readonly changed: boolean;
  /** Sections whose file copy had moved since the panel loaded, by name (D92's rule, per section). */
  readonly overChange: readonly string[];
}

/**
 * Make each named section equal its new value, touching only the keys that moved.
 *
 * Key by key rather than replacing the section, so a comment on a key the save did not change
 * survives — which is what `disable`, `enable` and `rigline layout` already promise of this file
 * (D91). A key absent from the new value is deleted; an empty section, and an empty `settings`, go.
 */
export function writeSettings(
  configPath: string,
  sections: Readonly<Record<string, Section>>,
): boolean {
  return editConfig(configPath, (doc) => {
    let changed = false;
    for (const [name, wanted] of Object.entries(sections)) {
      changed = setSection(doc, name, wanted) || changed;
    }
    const node = doc.get("settings", true);
    if (isMap(node) && node.items.length === 0) doc.delete("settings");
    return changed;
  });
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
    const current = doc.getIn(["settings", name, key]);
    if (current !== undefined && same(current, value)) continue;
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

/** Deep equality over what YAML and JSON both carry, so an unchanged key is left untouched. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * The panel's settings Save, by the route D93 built for the layout: the link's payload, checked
 * against this machine's token, written per section.
 */
export function saveSettingsFromPanel(
  configPath: string,
  tokenPath: string,
  encoded: string,
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
  const held = readConfig(configPath).settings;
  const overChange = Object.entries(payload.sections)
    .filter(([name, section]) => !same(held[name] ?? {}, section.from))
    .map(([name]) => name);
  const wanted = Object.fromEntries(
    Object.entries(payload.sections).map(([name, section]) => [name, section.to]),
  );
  return { changed: writeSettings(configPath, wanted), overChange };
}
