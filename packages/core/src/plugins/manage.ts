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
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  describeElements,
  describeUses,
  type Uses,
  type ValidManifest,
} from "@rigline/plugin-api/internal";
import { UserError } from "../errors.ts";
import { parseJson } from "../json.ts";
import {
  addToList,
  editConfig,
  type PluginSource,
  readConfig,
  removeFromList,
  updateSources,
} from "./config.ts";
import { isPluginOutput, readManifest } from "./discover.ts";

export interface AddOptions {
  /** The plugin directory to copy from. */
  readonly from: string;
  /** Where plugins are installed: `~/.rigline/plugins`. */
  readonly pluginsDir: string;
  readonly configPath: string;
  readonly sourcesPath: string;
  /**
   * The other roots this install discovers from, so a name already taken in one of them is refused
   * rather than shadowed (D56). `pluginsDir` itself does not belong here: a name already there is
   * the plugin being replaced, which is what re-adding one you are working on means.
   */
  readonly otherRoots?: readonly string[];
  /**
   * Which of `otherRoots` is the bundled set. `add` skips it, because taking a bundled name is
   * allowed and is the whole escape hatch (D71); `remove` reads the same field, because a bundled
   * plugin is the one refusal with somewhere better to send you. One list, one carve-out — two
   * lists would put the distinction in every caller.
   */
  readonly bundledRoot?: string;
  /**
   * Where the bytes in `from` really came from, since a staging directory cannot say (D74). Absent,
   * `from` is recorded as a `path` source.
   */
  readonly source?: PluginSource;
  /** For a test that asserts on the recorded instant. */
  readonly now?: () => Date;
}

export interface AddResult {
  readonly name: string;
  /** Where it now lives. */
  readonly dir: string;
  /** Where it was copied from, absolute. */
  readonly from: string;
  /** What was recorded in `sources.json`, which names an npm plugin where `from` cannot. */
  readonly source: PluginSource;
  /** Whether a plugin of this name was already in `~/.rigline/plugins` and has been replaced. */
  readonly replaced: boolean;
  /** Whether it takes its name from a bundled plugin, which now loads only if this one goes (D71). */
  readonly overridesBundled: boolean;
  /** True when `config.yaml` has this name switched off, so it will not load until that changes. */
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

  // The source directory has not been renamed to match the plugin, and a tarball's never is, so the
  // name to check the manifest against is the manifest's own. Read here rather than inferred,
  // because it is also the destination.
  const manifest = readManifest(from, declaredName(from));

  return place({
    manifest,
    from,
    pluginsDir: options.pluginsDir,
    configPath: options.configPath,
    sourcesPath: options.sourcesPath,
    otherRoots: options.otherRoots,
    bundledRoot: options.bundledRoot,
    source: options.source ?? { kind: "path", from, addedAt: stamp(options.now) },
    write: (dir) =>
      cpSync(from, dir, {
        recursive: true,
        filter: (source) => isPluginOutput(relative(from, source)),
      }),
  });
}

/** Everything `place` needs, whichever route the plugin arrived by. */
interface Placement {
  readonly manifest: ValidManifest;
  /** What to call where it came from, for the report. */
  readonly from: string;
  readonly pluginsDir: string;
  readonly configPath: string;
  readonly sourcesPath: string;
  readonly otherRoots?: readonly string[];
  readonly bundledRoot?: string;
  readonly source: PluginSource;
  /** Writes the plugin's files into `dir`, which is empty and exists by the time this is called. */
  readonly write: (dir: string) => void;
}

/**
 * The half `add <path>` and `add <name>` share: refuse a name that is not ours to take, replace
 * what is there, write, and record where it came from.
 *
 * Validation has already happened by here, against the source, so this never half-installs a plugin
 * that was never going to hold up.
 */
function place(placement: Placement): AddResult {
  const { manifest } = placement;
  const name = manifest.name;
  const dir = join(placement.pluginsDir, name);
  const bundledRoot =
    placement.bundledRoot === undefined ? undefined : resolve(placement.bundledRoot);
  let overridesBundled = false;

  for (const root of placement.otherRoots ?? []) {
    const resolved = resolve(root);
    const taken = join(resolved, name);
    if (taken === dir || !existsSync(join(taken, "rigline.json"))) continue;
    if (resolved === bundledRoot) {
      // Allowed, and the one collision that is. `~/.rigline/plugins` outranks the bundled set, so
      // this is a fork standing in front of a first-party plugin — the escape hatch that repairs a
      // broken bundled plugin without waiting for a release, in the spirit of D44 (D71).
      overridesBundled = true;
      continue;
    }
    throw new UserError(
      `a plugin called "${name}" is already discovered at ${taken}, which rigline did not ` +
        "install; installing another of that name would shadow one of them. Remove that one, or " +
        "rename yours.",
    );
  }

  // Reported, never changed: `add` over a plugin already here is also how you update one, and
  // quietly switching it back on would overrule a decision nobody revisited. Read before anything
  // is written, so a config that does not parse costs nothing.
  const config = readConfig(placement.configPath);
  const disabled = config.disabled.includes(name);

  const link = linkTarget(dir);
  if (link !== null) {
    throw new UserError(
      `${dir} is a link to ${link}, so rigline will not replace it with a copy. Remove the link ` +
        `first, or keep it and build through it: \`rigline dev ${dir}\` builds it where it is.`,
    );
  }
  const replaced = existsSync(dir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  placement.write(dir);

  updateSources(placement.sourcesPath, (sources) => {
    sources[name] = placement.source;
  });

  return {
    name,
    dir,
    from: placement.from,
    source: placement.source,
    replaced,
    overridesBundled,
    disabled,
    can: [
      ...describeUses(manifest.uses as Uses),
      ...describeElements(manifest.elements, name, config.layout),
    ],
    manifest,
  };
}

function stamp(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
}

export interface SwitchOptions {
  readonly name: string;
  readonly configPath: string;
  /** Every discovery root, so a name nothing has heard of is a typo rather than a silent no-op. */
  readonly roots: readonly string[];
}

export interface SwitchResult {
  readonly name: string;
  /** False when the name was already in the state asked for, which is worth saying rather than lying. */
  readonly changed: boolean;
  readonly configPath: string;
}

/**
 * Switches one plugin off in `config.yaml`, or back on.
 *
 * The only way to decline a bundled plugin (D71, D72). It is not deletable — it lives inside the
 * engine, and an engine update would put it back — so `disabled` is what says no, and `doctor` says
 * so rather than leaving a missing badge to be interpreted.
 *
 * It refuses a name no root has, because the alternative is a command that silently does nothing
 * useful: `config.yaml` would grow an entry for a typo, `enabledPlugins` would report it as
 * disabling something it cannot find, and the plugin the person meant would still be loading.
 */
export function setPluginEnabled(options: SwitchOptions, enabled: boolean): SwitchResult {
  const { name, configPath } = options;
  const known = options.roots.some((root) => existsSync(join(resolve(root), name, "rigline.json")));
  if (!known) {
    throw new UserError(
      `no plugin called "${name}" was found in any discovery root; \`rigline list\` names every one`,
    );
  }

  const changed = editConfig(configPath, (doc) =>
    enabled ? removeFromList(doc, ["disabled"], name) : addToList(doc, ["disabled"], name),
  );
  return { name, changed, configPath };
}

export interface RemoveOptions {
  readonly name: string;
  readonly pluginsDir: string;
  readonly configPath: string;
  readonly sourcesPath: string;
  /** The other roots this install discovers from, so a refusal can say where the plugin actually is. */
  readonly otherRoots?: readonly string[];
  /** Which of `otherRoots` is the bundled set, so its refusal can say what refreshes it (D71). */
  readonly bundledRoot?: string;
}

/**
 * Deletes one plugin from `~/.rigline/plugins`, however it got there, and forgets it.
 *
 * It refuses a link there, and anything outside that directory, and says where the plugin really is rather than just
 * that it is not here: a first-party plugin in a checkout is switched off in `config.yaml`, not
 * deleted, and deleting somebody's working tree because they typed its name is not a thing a
 * package manager gets to do.
 */
export function removePlugin(options: RemoveOptions): RemoveResult {
  const { name } = options;
  const dir = join(options.pluginsDir, name);
  if (!existsSync(dir)) {
    const bundledRoot =
      options.bundledRoot === undefined ? undefined : resolve(options.bundledRoot);
    for (const root of options.otherRoots ?? []) {
      const resolved = resolve(root);
      const elsewhere = join(resolved, name);
      if (!existsSync(join(elsewhere, "rigline.json"))) continue;
      throw new UserError(
        resolved === bundledRoot
          ? // A bundled plugin has no directory of its own to delete, and deleting one out of the
            // engine would be undone by the next engine update anyway. Both ways out are named.
            `"${name}" is bundled inside the engine, so there is nothing here to delete. ` +
              `Run \`rigline disable ${name}\` to switch it off, or \`rigline add\` your own of ` +
              "that name over it."
          : `"${name}" is at ${elsewhere}, which rigline did not install and will not delete. ` +
              `Run \`rigline disable ${name}\` to switch it off.`,
      );
    }
    throw new UserError(`no plugin called "${name}" is installed in ${options.pluginsDir}`);
  }
  const link = linkTarget(dir);
  if (link !== null) {
    throw new UserError(
      `${dir} is a link to ${link}, which rigline did not make and will not remove. Delete the ` +
        `link itself to take the plugin out, or run \`rigline disable ${name}\`.`,
    );
  }

  rmSync(dir, { recursive: true, force: true });

  let hadSource = false;
  updateSources(options.sourcesPath, (sources) => {
    hadSource = name in sources;
    delete sources[name];
  });
  // Dropped, unlike in `add`: a rule about a plugin that is gone is a line the install would go on
  // reporting as disabling something it cannot find.
  const wasDisabled = editConfig(options.configPath, (doc) =>
    removeFromList(doc, ["disabled"], name),
  );

  return { name, dir, hadSource, wasDisabled };
}

/** Where `dir` points when it is a symlink or a junction, which `lstat` reports alike, or null. */
function linkTarget(dir: string): string | null {
  try {
    return lstatSync(dir).isSymbolicLink() ? readlinkSync(dir) : null;
  } catch {
    return null;
  }
}

/**
 * The name the source manifest gives itself, or the directory's own when there is nothing readable
 * to take it from — in which case `readManifest` is about to produce the real complaint, and this
 * one staying quiet is what keeps a malformed manifest to one error message.
 */
function declaredName(dir: string): string {
  try {
    return nameInJson(readFileSync(join(dir, "rigline.json"), "utf8")) ?? basename(dir);
  } catch {
    return basename(dir);
  }
}

/** The `name` a manifest text gives itself, or null when there is nothing readable to take. */
function nameInJson(json: string): string | null {
  try {
    const value: unknown = parseJson(json);
    const name = (value as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}
