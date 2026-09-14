/**
 * Reading the bundles an identifier layer harvests from, and choosing between an extension's own
 * bytes and the backup we made of them: a harvest must read the extension's own code, never the
 * loader Rigline added, so it does not learn a substitution as if it were the extension's.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../errors.ts";
import type { Bundles } from "../layers/types.ts";
import { extensionVersion } from "./locate.ts";

export const WEBVIEW_BUNDLE = "webview/index.js";
export const WEBVIEW_BACKUP = "webview/index.js.orig";
export const HOST_BUNDLE = "extension.js";
export const HOST_BACKUP = "extension.js.orig";
export const WEBVIEW_CSS = "webview/index.css";

/**
 * Whether a host backup still belongs to the live file it backs up. A declared host substitution
 * never resizes the file, so a backup of a different length belongs to a different build — the
 * extension was replaced in place — and reading it would hand a harvest an older build's protocol
 * and hand a restore a downgrade. Exported because the injector asks the same question, and the
 * two must not answer differently.
 */
export function hostBackupIsCurrent(backupPath: string, livePath: string): boolean {
  return statSync(backupPath).size === statSync(livePath).size;
}

/** The webview bundle to harvest from: the backup if one exists, else the live bundle. */
export function pristineWebviewPath(ext: string): string {
  const backup = join(ext, WEBVIEW_BACKUP);
  if (existsSync(backup)) {
    return backup;
  }
  const live = join(ext, WEBVIEW_BUNDLE);
  if (existsSync(live)) {
    return live;
  }
  throw new UserError(`${ext} has neither ${WEBVIEW_BACKUP} nor ${WEBVIEW_BUNDLE}`);
}

/** The host bundle to harvest from: the backup only when it is still current, else the live file. */
export function pristineHostPath(ext: string): string {
  const live = join(ext, HOST_BUNDLE);
  if (!existsSync(live)) {
    throw new UserError(`${ext} has no ${HOST_BUNDLE}`);
  }
  const backup = join(ext, HOST_BACKUP);
  if (existsSync(backup) && hostBackupIsCurrent(backup, live)) {
    return backup;
  }
  return live;
}

/**
 * Reads the four files a layer harvests from, from one extension directory. Read as utf8 for
 * harvesting; byte-faithful I/O for a patch or a restore belongs to the injector, not here.
 */
export function readBundles(ext: string): Bundles {
  const cssPath = join(ext, WEBVIEW_CSS);
  return {
    version: extensionVersion(ext),
    webview: readFileSync(pristineWebviewPath(ext), "utf8"),
    host: readFileSync(pristineHostPath(ext), "utf8"),
    css: existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "",
  };
}

/** Whether a directory looks like an installed Claude Code extension at all. */
export function isExtensionDir(dir: string): boolean {
  return existsSync(join(dir, WEBVIEW_BUNDLE)) && existsSync(join(dir, "package.json"));
}
