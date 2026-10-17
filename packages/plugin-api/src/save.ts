/**
 * Saving a layout from the panel (D93). The panel builds a Save link's payload and the engine reads
 * it, both through these functions, so the one format the save defines has one definition.
 */
import { type Layout, MAX_LAYOUT_ENTRIES, plainText } from "./layout.ts";
import { type ModelSettings, readModelSettings } from "./models.ts";

/** What `install` bakes for the panel's Save. */
export interface SaveRecord {
  /** This machine's token, or null where the file does not hold one, which leaves Copy commands. */
  readonly token: string | null;
  /** Whether an installed companion answers a Save link. */
  readonly companion: boolean;
  /** The link's scheme: the product whose extensions directory was injected. */
  readonly scheme: string;
}

/**
 * The companion's extension id, which a Save link names as its authority.
 *
 * Here rather than in the host because both halves of the host need it and they bundle separately:
 * the kernel forms a settings link and the shell forms the layout's, and a value imported across
 * that line would be bundled twice.
 */
export const COMPANION = "rigline.rigline";

export const SAVE_PAYLOAD_VERSION = 1;

export interface SavePayload {
  readonly v: typeof SAVE_PAYLOAD_VERSION;
  readonly token: string;
  /** The layout the panel's copy started from, which says whether the file has moved since. */
  readonly from: Layout;
  readonly to: Layout;
}

/**
 * The longest encoded payload the engine reads, well inside the Windows command line it reaches
 * the engine on. A real layout is a few hundred characters.
 */
export const MAX_SAVE_PAYLOAD = 16 * 1024;

export function encodeSavePayload(payload: SavePayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export const SETTINGS_PAYLOAD_VERSION = 1;

/** One plugin's section: what the panel's copy started from, and what to write (D138). */
export interface SettingsSave {
  readonly from: Readonly<Record<string, unknown>>;
  readonly to: Readonly<Record<string, unknown>>;
}

/** Rigline's own settings as the settings screen edits them: `config.yaml`'s blocks it owns. */
export interface RiglineSettings {
  readonly model: ModelSettings;
}

/** The blocks of Rigline's own settings, by the key each has in `config.yaml`. */
export const RIGLINE_BLOCKS: readonly (keyof RiglineSettings)[] = ["model"];

/** Rigline's own blocks in a save, each side naming only the blocks being written. */
export interface RiglineSave {
  readonly from: Partial<RiglineSettings>;
  readonly to: Partial<RiglineSettings>;
}

export interface SettingsPayload {
  readonly v: typeof SETTINGS_PAYLOAD_VERSION;
  readonly token: string;
  /** By plugin name, and only the sections being written — never every section the panel holds. */
  readonly sections: Readonly<Record<string, SettingsSave>>;
  /** Rigline's own settings, beside the plugins' rather than among them. */
  readonly rigline?: RiglineSave;
}

/**
 * The same cap as a layout's, and for the same reason: this reaches the engine on a command line.
 *
 * So the panel saves far less than `install` will bake (`MAX_SETTINGS_SECTION`). A plugin keeping
 * bulk data under its own key can read it and cannot save it from the panel, which is the right way
 * round — the panel's editor is for settings a person edits.
 */
export const MAX_SETTINGS_PAYLOAD = 16 * 1024;

export function encodeSettingsPayload(payload: SettingsPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

/** The payload a settings Save link carried, or why it is not one. */
export function decodeSettingsPayload(
  encoded: string,
): { readonly payload: SettingsPayload } | { readonly problem: string } {
  if (encoded.length > MAX_SETTINGS_PAYLOAD) {
    return { problem: `the payload is longer than ${MAX_SETTINGS_PAYLOAD} characters` };
  }
  const text = fromBase64Url(encoded);
  if (text === null) return { problem: "the payload is not base64url-encoded UTF-8" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: "the payload is not JSON" };
  }
  if (!isRecord(value)) return { problem: "the payload is not an object" };
  if (value.v !== SETTINGS_PAYLOAD_VERSION) {
    return {
      problem: `the payload is version ${String(value.v)}, and this engine reads ${SETTINGS_PAYLOAD_VERSION}`,
    };
  }
  if (typeof value.token !== "string" || !plainText(value.token)) {
    return { problem: "the payload has no token" };
  }
  if (!isRecord(value.sections)) return { problem: '"sections" is not a mapping of plugin names' };
  const entries: [string, SettingsSave][] = [];
  for (const [name, section] of Object.entries(value.sections)) {
    if (!plainText(name)) return { problem: '"sections" names a plugin that is not plain text' };
    if (!isRecord(section)) return { problem: `"sections.${name}" is not an object` };
    if (!isRecord(section.from)) return { problem: `"sections.${name}.from" is not an object` };
    if (!isRecord(section.to)) return { problem: `"sections.${name}.to" is not an object` };
    entries.push([name, { from: section.from, to: section.to }]);
  }
  const rigline = value.rigline === undefined ? undefined : readRiglineSave(value.rigline);
  if (typeof rigline === "string") return { problem: rigline };
  // fromEntries, so a `__proto__` key stays an ordinary key, as the layout's reader does.
  return {
    payload: {
      v: SETTINGS_PAYLOAD_VERSION,
      token: value.token,
      sections: Object.fromEntries(entries),
      ...(rigline === undefined ? {} : { rigline }),
    },
  };
}

/**
 * Rigline's own blocks, each read by `readConfig`'s rules for it, or why not. Where the file
 * carries forward what this version does not know (D110), a save refuses it: the panel builds this
 * from a closed set of controls, so something unknown here was not put there by this Rigline.
 */
function readRiglineSave(value: unknown): RiglineSave | string {
  if (!isRecord(value)) return '"rigline" is not an object';
  const sides: Partial<RiglineSettings>[] = [];
  for (const side of ["from", "to"] as const) {
    const blocks = value[side];
    if (!isRecord(blocks)) return `"rigline.${side}" is not an object`;
    const read: { model?: ModelSettings } = {};
    for (const [block, settings] of Object.entries(blocks)) {
      if (block !== "model")
        return `"rigline.${side}" has "${block}", which this engine does not know`;
      const model = readModelSettings(settings);
      if ("problem" in model) return `"rigline.${side}": ${model.problem}`;
      if (model.unknown.length > 0) {
        return `"rigline.${side}" has ${model.unknown.join(", ")}, which this engine does not know`;
      }
      read.model = model.settings;
    }
    sides.push(read);
  }
  const [from = {}, to = {}] = sides;
  const named = (blocks: Partial<RiglineSettings>) => Object.keys(blocks).sort().join(",");
  if (named(from) !== named(to)) return '"rigline.from" and "rigline.to" name different blocks';
  return { from, to };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The payload a Save link carried, or why it is not one. */
export function decodeSavePayload(
  encoded: string,
): { readonly payload: SavePayload } | { readonly problem: string } {
  if (encoded.length > MAX_SAVE_PAYLOAD) {
    return { problem: `the payload is longer than ${MAX_SAVE_PAYLOAD} characters` };
  }
  const text = fromBase64Url(encoded);
  if (text === null) return { problem: "the payload is not base64url-encoded UTF-8" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: "the payload is not JSON" };
  }
  if (!isRecord(value)) return { problem: "the payload is not an object" };
  if (value.v !== SAVE_PAYLOAD_VERSION) {
    return {
      problem: `the payload is version ${String(value.v)}, and this engine reads ${SAVE_PAYLOAD_VERSION}`,
    };
  }
  if (typeof value.token !== "string" || !plainText(value.token)) {
    return { problem: "the payload has no token" };
  }
  const from = readLayout(value.from, "from");
  if (typeof from === "string") return { problem: from };
  const to = readLayout(value.to, "to");
  if (typeof to === "string") return { problem: to };
  return { payload: { v: SAVE_PAYLOAD_VERSION, token: value.token, from, to } };
}

function fromBase64Url(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  let binary: string;
  try {
    binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A layout, or why it is not one. `fromEntries`, so a `__proto__` key stays an ordinary key. */
export function readLayout(value: unknown, label: string): Layout | string {
  if (!isRecord(value)) return `"${label}" is not a layout`;
  const entries = Object.entries(value);
  let count = 0;
  for (const [place, names] of entries) {
    if (!plainText(place)) return `"${label}" names a place that is empty, too long or not text`;
    if (!Array.isArray(names) || !names.every((n) => typeof n === "string" && plainText(n))) {
      return `"${label}.${place}" is not a list of plugin/element names`;
    }
    count += 1 + names.length;
    if (count > MAX_LAYOUT_ENTRIES) return `"${label}" has more than ${MAX_LAYOUT_ENTRIES} entries`;
  }
  return Object.fromEntries(entries) as Layout;
}
