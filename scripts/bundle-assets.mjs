#!/usr/bin/env node
/**
 * Copy the injected payload and the first-party plugins into `@rigline/core`'s `dist/bundled`,
 * which is how they reach anybody who installed from npm (D71).
 *
 * A workspace step rather than part of core's own build, because the plugins are built by
 * `rigline-engine build`, which is core's own bin: a build-order edge from core to the plugins
 * would be a cycle. So the root `build` runs `pnpm -r build` and then this, and every caller that
 * matters — `ci.yml`, `release.yml` and the release script's pre-cut gate — already runs the root
 * `build`.
 *
 * Bytes, through `cpSync`, never text-mode I/O: a round trip through `"utf8"` here rewrites every
 * line ending in the payload on a Windows machine before it is ever injected (D37).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fail as failWith, ROOT, say } from "./lib/workspace.mjs";

const fail = (message) => failWith(message, "bundle-assets");

const BUNDLED = join(ROOT, "packages", "core", "dist", "bundled");
const PLUGINS_DIR = join(ROOT, "plugins");

/** The two hook files the host builds to, taken from its `dist` and laid flat in `dist/bundled`. */
const PAYLOAD_FILES = ["pre.js", "post.js"];

/** The modules plugins import, which the host builds beside the hooks; copied whole. */
const RUNTIME_DIR = "runtime";

/**
 * Every plugin in `plugins/`, found rather than listed. Everything in there is first-party and
 * bundled, so a list here would be a thing to remember on the day a fifth one arrives.
 */
function firstPartyPlugins() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(PLUGINS_DIR, entry.name, "rigline.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * The plugin's entry, as its own manifest names it, so nothing here rewrites a manifest.
 *
 * Flattening `dist/index.js` to `index.js` beside the manifest would mean the bytes a user's engine
 * validates are not the bytes any test ran against, and the copy would stop being a copy.
 */
function entryOf(dir) {
  const { entry } = JSON.parse(readFileSync(join(dir, "rigline.json"), "utf8"));
  if (typeof entry !== "string" || entry.length === 0) fail(`${dir}/rigline.json has no "entry"`);
  return entry;
}

/**
 * Copy one file, and stamp the copy with the time it was made.
 *
 * The stamp is not cosmetic. `bundledDir()` refuses a `dist/bundled` older than the builds it was
 * copied from, and `cpSync` carries the source's modification time across on Windows — where
 * `CopyFileW` preserves timestamps whatever Node's `preserveTimestamps` is set to — so every copy
 * would read as exactly as old as its source and the guard would fire on a bundle made seconds
 * ago. `utimesSync` makes the question "when was this produced" answerable on every platform the
 * same way.
 */
function copy(from, to) {
  if (!existsSync(from)) fail(`${from} is missing: run \`pnpm -r build\` first`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  const now = new Date();
  utimesSync(to, now, now);
}

// Rebuilt from empty every time. `tsc` does not clean `packages/core/dist`, so a plugin renamed or
// dropped would otherwise leave its last build in the tarball for as long as nobody looked.
rmSync(BUNDLED, { recursive: true, force: true });
mkdirSync(BUNDLED, { recursive: true });

for (const file of PAYLOAD_FILES) {
  copy(join(ROOT, "packages", "host", "dist", file), join(BUNDLED, file));
}
const runtimeFrom = join(ROOT, "packages", "host", "dist", RUNTIME_DIR);
if (!existsSync(runtimeFrom)) fail(`${runtimeFrom} is missing: run \`pnpm -r build\` first`);
for (const file of readdirSync(runtimeFrom)) {
  copy(join(runtimeFrom, file), join(BUNDLED, RUNTIME_DIR, file));
}

const plugins = firstPartyPlugins();
for (const name of plugins) {
  const from = join(PLUGINS_DIR, name);
  const to = join(BUNDLED, "plugins", name);
  const entry = entryOf(from);
  copy(join(from, "rigline.json"), join(to, "rigline.json"));
  copy(join(from, entry), join(to, entry));
}

// The companion, so `rigline` can install it without a second fetch (D76, D80).
//
// Deliberately not added to `assertBundledIsCurrent`'s links. That chain exists because a stale
// *payload* means injecting code which is not what this checkout says; a stale VSIX only means an
// older extension is offered, which carries its own version and is visible. Adding it would let an
// unbuilt `packages/vscode/src` refuse `bundledDir()`, and with it `restore` — coupling the
// recovery path to the companion's build state is a much worse trade than an old VSIX.
copy(join(ROOT, "packages", "vscode", "rigline.vsix"), join(BUNDLED, "rigline.vsix"));

say(
  `bundled ${PAYLOAD_FILES.length} payload files, the runtime, ${plugins.length} plugins and the companion ` +
    `into ${BUNDLED}`,
);
