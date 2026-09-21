/**
 * The assets core ships beside its own code: the injected payload, and the bundled plugins
 * (decisions.md, D71).
 *
 * `pre.js`, `post.js` and the four first-party plugins are published inside `@rigline/core`, under
 * `dist/bundled/`, because core is what injects and what discovers — and because a payload that
 * only exists in this checkout is a payload nobody who installed from npm has ever had, which is
 * the whole of what milestone 7 exists to end.
 *
 * Everything here rests on one primitive: walk up from this module to the nearest `package.json`.
 * That is the package root under every resolution this code meets — `packages/core/src` under
 * vitest's alias, `packages/core/dist` when built, `node_modules/@rigline/core/dist` when
 * published — where a fixed offset from `import.meta.url` is a different answer in each.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "./errors.ts";

/** The workspace root's `name`: the marker that says this engine is running from our own checkout. */
const WORKSPACE_NAME = "rigline-workspace";

const BUILD_HINT = "run `pnpm build`";

/**
 * The nearest directory at or above `from` holding a `package.json`.
 *
 * Returns null rather than throwing at the filesystem root, because the one caller that can
 * reasonably meet that is a test running this module from somewhere improbable, and a null it
 * handles is better than a throw it has to catch.
 */
function nearestPackageDir(from: string): string | null {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** `@rigline/core`'s own package root, wherever this module was resolved from. */
export function corePackageDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = nearestPackageDir(here);
  if (dir === null)
    throw new UserError(`no package.json above ${here}: @rigline/core is not intact`);
  return dir;
}

/**
 * This repository's root when the engine is running out of it, else null.
 *
 * Two directories above core's own package root is the workspace root in a checkout
 * (`packages/core` -> `packages`-> the root) and `node_modules` in a published install, so the
 * `name` is what separates them. What this replaces is fixed path arithmetic that resolved to
 * `<npm-global-prefix>/plugins` from a published install: a directory that does not exist and was
 * therefore skipped, which is a right answer arrived at by accident and the shape of the accident
 * this milestone is about.
 */
export function workspaceRoot(): string | null {
  const root = join(corePackageDir(), "..", "..");
  const manifest = join(root, "package.json");
  if (!existsSync(manifest)) return null;
  try {
    const value = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
    return value.name === WORKSPACE_NAME ? root : null;
  } catch {
    // A package.json above us that will not parse belongs to somebody else's tree, and saying so
    // would be an error about a file this install has no business having an opinion on.
    return null;
  }
}

/**
 * The checkout's own `plugins/`, or null when the engine is not running from this workspace.
 *
 * The first discovery root (D56), and the reason a first-party plugin edited here is the one that
 * loads rather than the copy baked into `dist/bundled`.
 */
export function checkoutPluginsDir(): string | null {
  const root = workspaceRoot();
  return root === null ? null : join(root, "plugins");
}

/** The newest mtime anywhere under `dir`, or 0 for a directory that is not there. */
function newestMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const at = entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs;
    if (at > newest) newest = at;
  }
  return newest;
}

/** The oldest mtime anywhere under `dir`, or 0 for a directory that is not there. */
function oldestMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const at = entry.isDirectory() ? oldestMtime(path) : statSync(path).mtimeMs;
    if (at > 0 && at < oldest) oldest = at;
  }
  return Number.isFinite(oldest) ? oldest : 0;
}

/** One link of the staleness chain: a built directory, and the sources it was built from. */
interface Link {
  readonly label: string;
  readonly built: string;
  readonly src: string;
}

/** Every `plugins/*` directory in the checkout that has a `src` to have been built from. */
function pluginLinks(root: string): Link[] {
  const plugins = join(root, "plugins");
  if (!existsSync(plugins)) return [];
  return readdirSync(plugins, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(plugins, entry.name, "src")))
    .map((entry) => ({
      label: `plugins/${entry.name}`,
      built: join(plugins, entry.name, "dist"),
      src: join(plugins, entry.name, "src"),
    }));
}

/**
 * Refuse a `dist/bundled` that does not hold what the sources in this checkout say it should.
 *
 * The chain is two links and both are needed. `dist/bundled` must be newer than each thing it was
 * copied from, and each of those must be newer than its own `src` — because a stale `host/dist`
 * copied faithfully into a newer `bundled` passes the first link on its own, and what you then get
 * is a green run reporting a property of code that is not loaded. That is worse than a red one, and
 * it is the exact failure `preparePayload` was written to stop; this is the same rule, whole,
 * somewhere every reader of the payload goes through.
 *
 * It runs only in this workspace. A published install has no `packages/host/src` to compare
 * against, and nothing there can be stale in this sense: the tarball's `dist/bundled` was built by
 * the release that produced it.
 *
 * Mtimes rather than content hashes, as `preparePayload` had it: the question is only "was this
 * built after it was edited", a rebuild of unchanged sources answers it correctly, and the cost is
 * a stat per file.
 */
function assertBundledIsCurrent(bundled: string, root: string): void {
  const links: Link[] = [
    {
      label: "packages/host",
      built: join(root, "packages", "host", "dist"),
      src: join(root, "packages", "host", "src"),
    },
    ...pluginLinks(root),
  ];

  const bundledAt = oldestMtime(bundled);
  for (const link of links) {
    const builtAt = newestMtime(link.built);
    if (builtAt === 0) {
      throw new UserError(
        `${link.label} is not built, so ${bundled} cannot hold its output — ${BUILD_HINT}`,
      );
    }
    if (newestMtime(link.src) > builtAt) {
      throw new UserError(
        `${link.label} has sources newer than its build, so the payload would carry code that is ` +
          `not what this checkout says — ${BUILD_HINT}`,
      );
    }
    if (builtAt > bundledAt) {
      throw new UserError(
        `${bundled} is older than ${link.label}'s build, so it holds a previous one — ${BUILD_HINT}`,
      );
    }
  }
}

/**
 * `dist/bundled`, checked.
 *
 * Every caller that reads a bundled asset goes through here, so the staleness chain is asked at the
 * point of use rather than trusted to have been asked by whoever built last.
 */
export function bundledDir(): string {
  const dir = join(corePackageDir(), "dist", "bundled");
  const root = workspaceRoot();
  if (!existsSync(dir)) {
    throw new UserError(
      `@rigline/core carries no bundled assets at ${dir}` +
        (root === null ? "" : ` — ${BUILD_HINT}`),
    );
  }
  if (root !== null) assertBundledIsCurrent(dir, root);
  return dir;
}

/** The first-party plugins, discovered in place and never copied into `~/.rigline/plugins` (D71). */
export function bundledPluginsDir(): string {
  return join(bundledDir(), "plugins");
}
