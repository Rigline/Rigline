/**
 * Saving a layout from the panel (D93). The panel builds a Save link's payload and the engine reads
 * it, both through these functions, so the one format the save defines has one definition.
 */
import type { Layout } from "./layout.ts";

/** What `install` bakes for the panel's Save. */
export interface SaveRecord {
  /** This machine's token, or null where the file does not hold one, which leaves Copy commands. */
  readonly token: string | null;
  /** Whether an installed companion answers a Save link. */
  readonly companion: boolean;
  /** The link's scheme: the product whose extensions directory was injected. */
  readonly scheme: string;
}

export const SAVE_PAYLOAD_VERSION = 1;

export interface SavePayload {
  readonly v: typeof SAVE_PAYLOAD_VERSION;
  readonly token: string;
  /** The layout the panel's copy started from, which says whether the file has moved since. */
  readonly from: Layout;
  readonly to: Layout;
}

/** The longest encoded payload the engine reads. A real layout is a few hundred characters. */
export const MAX_SAVE_PAYLOAD = 64 * 1024;
const MAX_ENTRIES = 1024;
const MAX_TEXT = 256;

export function encodeSavePayload(payload: SavePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
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

/** Non-empty, bounded, and free of control characters, which have no business in a place or a name. */
function plainText(text: string): boolean {
  if (text.length === 0 || text.length > MAX_TEXT) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

/** A layout, or why it is not one. `fromEntries`, so a `__proto__` key stays an ordinary key. */
function readLayout(value: unknown, label: string): Layout | string {
  if (!isRecord(value)) return `"${label}" is not a layout`;
  const entries = Object.entries(value);
  let count = 0;
  for (const [place, names] of entries) {
    if (!plainText(place)) return `"${label}" names a place that is empty, too long or not text`;
    if (!Array.isArray(names) || !names.every((n) => typeof n === "string" && plainText(n))) {
      return `"${label}.${place}" is not a list of plugin/element names`;
    }
    count += 1 + names.length;
    if (count > MAX_ENTRIES) return `"${label}" has more than ${MAX_ENTRIES} entries`;
  }
  return Object.fromEntries(entries) as Layout;
}
