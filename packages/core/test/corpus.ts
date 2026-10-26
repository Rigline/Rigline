/**
 * The reference-bundle corpus tests read real minified output from.
 *
 * Kept outside the repo because each version is several megabytes of somebody else's bundle. Each
 * version directory holds `extension.js`, `webview/index.js`, `webview/index.css` and
 * `package.json`, the same layout as an installed extension directory. Snapshot a newly installed
 * version with `pnpm corpus:add` before VS Code deletes it; older ones can be fetched as a VSIX from
 * the Marketplace. `corpus.json` is the committed record of which versions the tests sweep, written
 * by that command, because the directory itself is on one machine and CI cannot see it.
 *
 * Tests that need a version skip with a reason when it is absent rather than failing, so a fresh
 * clone is not blocked on a download; the corpus is nonetheless the only guard against a harvest
 * regex drifting, so a machine that develops Rigline should have it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bundles } from "../src/layers/types.ts";

const RECORD: { readonly dir: string; readonly versions: readonly string[] } = JSON.parse(
  readFileSync(new URL("./corpus.json", import.meta.url), "utf8"),
);

export const CORPUS = RECORD.dir;

/** A skip reason when `version` is not in the corpus, or false when it is. */
export function missing(version: string): string | false {
  return existsSync(versionDir(version)) ? false : `corpus lacks ${version} under ${CORPUS}`;
}

export function versionDir(version: string): string {
  return join(CORPUS, version);
}

/** Read one corpus version as the bundles a layer harvests from. */
export function corpusBundles(version: string): Bundles {
  const dir = versionDir(version);
  return {
    version,
    webview: readFileSync(join(dir, "webview", "index.js"), "utf8"),
    host: readFileSync(join(dir, "extension.js"), "utf8"),
    css: readFileSync(join(dir, "webview", "index.css"), "utf8"),
  };
}

/** Every version in the corpus, oldest first, for tests that want to run across all of them. */
export const CORPUS_VERSIONS = RECORD.versions;
