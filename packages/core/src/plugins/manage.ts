/**
 * `add` and `remove`: what makes `~/.rigline/plugins/` a managed directory rather than one people
 * copy into (decisions.md, D33, D47, D49, D56).
 *
 * Copying a directory in by hand already works, and goes on working — a plugin is a manifest and a
 * built module, discovered by being there (P6). What `add` buys is everything around the copy: the
 * manifest is validated as data before anything is written, a name that would shadow a plugin
 * already discovered elsewhere is refused instead of silently winning or silently losing, and the
 * source is recorded so a later `update` has somewhere to look. `remove` is the inverse, and knows
 * what to delete and what to leave alone.
 *
 * Nothing here runs a package manager, resolves a dependency, or evaluates a line of the plugin
 * (D47, D12). A plugin that needs any of those is a plugin Rigline does not install.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { describeUses, type Uses, type ValidManifest } from "@rigline/plugin-api";
import { UserError } from "../errors.ts";
import { isPluginOutput, readManifest, updateConfig } from "./discover.ts";

export interface AddOptions {
  /** The plugin directory to copy from. */
  readonly from: string;
  /** Where plugins are installed: `~/.rigline/plugins`. */
  readonly pluginsDir: string;
  readonly configPath: string;
  /**
   * The other roots this install discovers from, so a name already taken in one of them is refused
   * rather than shadowed (D56). `pluginsDir` itself does not belong here: a name already there is
   * the plugin being replaced, which is what re-adding one you are working on means.
   */
  readonly otherRoots?: readonly string[];
  /** For a test that asserts on the recorded instant. */
  readonly now?: () => Date;
}

export interface AddResult {
  readonly name: string;
  /** Where it now lives. */
  readonly dir: string;
  /** Where it was copied from, absolute. */
  readonly from: string;
  /** Whether a plugin of this name was already in `~/.rigline/plugins` and has been replaced. */
  readonly replaced: boolean;
  /** True when `config.json` has this name switched off, so it will not load until that changes. */
  readonly disabled: boolean;
  /**
   * One sentence per thing the manifest declares, as `list` prints them. Carried here rather than
   * left for the caller to derive, so that the one moment a person is told what they have just
   * installed (D26) says the same thing `list` will say afterwards.
   */
  readonly can: readonly string[];
  readonly manifest: ValidManifest;
}

export interface RemoveResult {
  readonly name: string;
  readonly dir: string;
  /** Whether there was a source record to drop, which says whether `add` put it there (D49). */
  readonly hadSource: boolean;
  /** Whether the name was also switched off in config, which is now a rule about nothing. */
  readonly wasDisabled: boolean;
}

/**
 * Copies one plugin directory into `~/.rigline/plugins` and records where it came from.
 *
 * Validation happens against the source, before anything is written, so a manifest that does not
 * hold up leaves no half-installed directory behind. The copy goes through the same filter the
 * injector uses, which excludes tests, `node_modules` and anything dotted: a plugin's shipped form
 * is its whole directory, because it may split itself across modules or carry assets, so exclusion
 * is the only filter that can be written without guessing.
 */
export function addPlugin(options: AddOptions): AddResult {
  const from = resolve(options.from);
  if (!existsSync(from) || !statSync(from).isDirectory()) {
    throw new UserError(`${from} is not a directory`);
  }

  // The source directory has not been renamed to match the plugin, and for the tarball `add` will
  // one day unpack it never will be, so the name to check the manifest against is the manifest's
  // own. Read here rather than inferred, because it is also the destination.
  const manifest = readManifest(from, declaredName(from));
  const name = manifest.name;
  const dir = join(options.pluginsDir, name);

  for (const root of options.otherRoots ?? []) {
    const taken = join(resolve(root), name);
    if (taken !== dir && existsSync(join(taken, "rigline.json"))) {
      throw new UserError(
        `a plugin called "${name}" is already discovered at ${taken}, which rigline did not ` +
          "install; installing another of that name would shadow one of them. Remove that one, or " +
          "rename yours.",
      );
    }
  }

  const replaced = existsSync(dir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(from, dir, {
    recursive: true,
    filter: (source) => isPluginOutput(relative(from, source)),
  });

  let disabled = false;
  updateConfig(options.configPath, (config) => {
    // `disabled` is left exactly as it is, and reported instead. It is the one thing in this file a
    // person chose rather than a command wrote, and `add` over a plugin already here is also how
    // you update one — quietly switching it back on would overrule a decision nobody revisited.
    disabled = Array.isArray(config.disabled) && config.disabled.includes(name);
    const sources = asObject(config.sources);
    sources[name] = {
      kind: "path",
      from,
      addedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    config.sources = sources;
  });

  return {
    name,
    dir,
    from,
    replaced,
    disabled,
    can: describeUses(manifest.uses as Uses),
    manifest,
  };
}

export interface RemoveOptions {
  readonly name: string;
  readonly pluginsDir: string;
  readonly configPath: string;
  /** The other roots this install discovers from, so a refusal can say where the plugin actually is. */
  readonly otherRoots?: readonly string[];
}

/**
 * Deletes one plugin from `~/.rigline/plugins` and forgets it.
 *
 * It refuses anything outside that directory, and says where the plugin really is rather than just
 * that it is not here: a first-party plugin in a checkout is switched off in `config.json`, not
 * deleted, and deleting somebody's working tree because they typed its name is not a thing a
 * package manager gets to do.
 */
export function removePlugin(options: RemoveOptions): RemoveResult {
  const { name } = options;
  const dir = join(options.pluginsDir, name);
  if (!existsSync(dir)) {
    for (const root of options.otherRoots ?? []) {
      const elsewhere = join(resolve(root), name);
      if (existsSync(join(elsewhere, "rigline.json"))) {
        throw new UserError(
          `"${name}" is at ${elsewhere}, which rigline did not install and will not delete. ` +
            `Switch it off by adding it to "disabled" in ${options.configPath}.`,
        );
      }
    }
    throw new UserError(`no plugin called "${name}" is installed in ${options.pluginsDir}`);
  }

  rmSync(dir, { recursive: true, force: true });

  let hadSource = false;
  let wasDisabled = false;
  updateConfig(options.configPath, (config) => {
    const sources = asObject(config.sources);
    hadSource = name in sources;
    delete sources[name];
    config.sources = sources;
    if (Array.isArray(config.disabled) && config.disabled.includes(name)) {
      // Dropped, unlike in `add`: a rule about a plugin that is gone is a line the install would go
      // on reporting as disabling something it cannot find.
      wasDisabled = true;
      config.disabled = config.disabled.filter((d: unknown) => d !== name);
    }
  });

  return { name, dir, hadSource, wasDisabled };
}

/**
 * The name the source manifest gives itself, or the directory's own when there is nothing readable
 * to take it from — in which case `readManifest` is about to produce the real complaint, and this
 * one staying quiet is what keeps a malformed manifest to one error message.
 */
function declaredName(dir: string): string {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, "rigline.json"), "utf8"));
    const name = (value as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name : basename(dir);
  } catch {
    return basename(dir);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
