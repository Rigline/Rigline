/**
 * Saving a panel's layout (D93): one token per Rigline home, made once and never rewritten, and what
 * `rigline layout save` does with the payload of a panel's Save link, which the companion hands it.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { decodeSavePayload, type SaveRecord, sameLayout } from "@rigline/plugin-api";
import { UserError } from "../errors.ts";
import { URL_SCHEME } from "../extension/locate.ts";
import { readConfig } from "./config.ts";
import { writeLayout } from "./layout.ts";

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const COMPANION_PREFIX = "rigline.rigline-";

type TokenResult = { readonly token: string } | { readonly problem: string };

/** The token in `path`, or why there is none. */
export function readToken(path: string): TokenResult {
  if (!existsSync(path))
    return { problem: `${path} does not exist yet; \`rigline install\` makes it` };
  const token = readFileSync(path, "utf8").trim();
  return TOKEN.test(token)
    ? { token }
    : { problem: `${path} does not hold a token; delete it and run \`rigline install\`` };
}

/**
 * This home's token, made when there is none and never otherwise. Written aside and linked into
 * place, which fails when the file exists, so tools racing to make it all end with the first one's.
 */
export function ensureToken(path: string): TokenResult {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const text = `${randomBytes(16).toString("base64url")}\n`;
    const aside = `${path}.${process.pid}.${randomBytes(4).toString("hex")}`;
    writeFileSync(aside, text, { mode: 0o600 });
    try {
      linkSync(aside, path);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // A file system without hard links still gets an exclusive create, if not an atomic one.
      if (code !== "EEXIST") writeExclusive(path, text);
    } finally {
      rmSync(aside, { force: true });
    }
  }
  return readToken(path);
}

function writeExclusive(path: string, text: string): void {
  try {
    writeFileSync(path, text, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/**
 * Whether a companion in `extensionsDir` answers a Save link, which its manifest says by listing
 * `onUri`. Any of them rather than the newest: an update leaves the old directory behind for a
 * while, and nothing here orders versions.
 */
export function companionHandlesSave(extensionsDir: string): boolean {
  if (!existsSync(extensionsDir)) return false;
  return readdirSync(extensionsDir, { withFileTypes: true }).some((entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith(COMPANION_PREFIX)) return false;
    try {
      const manifest = JSON.parse(
        readFileSync(join(extensionsDir, entry.name, "package.json"), "utf8"),
      ) as { activationEvents?: unknown };
      return (
        Array.isArray(manifest.activationEvents) && manifest.activationEvents.includes("onUri")
      );
    } catch {
      return false;
    }
  });
}

/** What `install` bakes for the Save of a panel running from `ext`. */
export function saveRecord(
  ext: string,
  tokenPath: string,
  log: (line: string) => void,
): SaveRecord {
  const token = ensureToken(tokenPath);
  if ("problem" in token) log(`Save in the panel copies commands instead: ${token.problem}`);
  return {
    token: "token" in token ? token.token : null,
    companion: companionHandlesSave(dirname(ext)),
    scheme: URL_SCHEME,
  };
}

export interface PanelSave {
  /** False when the file already held the panel's layout. */
  readonly changed: boolean;
  /** Whether the file's layout had moved from the one the panel started from, and was overwritten. */
  readonly overChange: boolean;
}

/** Writes the layout a Save link carries over the file's, or refuses it and says why. */
export function saveFromPanel(configPath: string, tokenPath: string, encoded: string): PanelSave {
  const decoded = decodeSavePayload(encoded);
  if ("problem" in decoded) throw new UserError(`not saved: ${decoded.problem}`);
  const { payload } = decoded;
  const mine = readToken(tokenPath);
  if ("problem" in mine) throw new UserError(`not saved: ${mine.problem}`);
  if (!sameToken(payload.token, mine.token)) {
    throw new UserError(
      "not saved: the Save link's token is not this machine's; reload the panel to pick up the current one",
    );
  }
  const overChange = !sameLayout(readConfig(configPath).layout, payload.from);
  return { changed: writeLayout(configPath, payload.to), overChange };
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
