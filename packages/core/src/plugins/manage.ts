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
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { describeUses, type Uses, type ValidManifest } from "@rigline/plugin-api";
import { UserError } from "../errors.ts";
import {
  checkManifest,
  isPluginOutput,
  type NpmSource,
  type PluginSource,
  readConfig,
  readManifest,
  updateConfig,
} from "./discover.ts";
import {
  fetchTarball,
  parsePluginSpec,
  type RegistryOptions,
  releaseAgeProblem,
  resolveVersion,
} from "./registry.ts";
import { readPackageTarball, type TarFile } from "./tarball.ts";

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

  // The source directory has not been renamed to match the plugin, and a tarball's never is, so the
  // name to check the manifest against is the manifest's own. Read here rather than inferred,
  // because it is also the destination.
  const manifest = readManifest(from, declaredName(from));

  return place({
    manifest,
    from,
    pluginsDir: options.pluginsDir,
    configPath: options.configPath,
    otherRoots: options.otherRoots,
    source: { kind: "path", from, addedAt: stamp(options.now) },
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
  readonly otherRoots?: readonly string[];
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

  for (const root of placement.otherRoots ?? []) {
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
  placement.write(dir);

  let disabled = false;
  updateConfig(placement.configPath, (config) => {
    // `disabled` is left exactly as it is, and reported instead. It is the one thing in this file a
    // person chose rather than a command wrote, and `add` over a plugin already here is also how
    // you update one — quietly switching it back on would overrule a decision nobody revisited.
    disabled = Array.isArray(config.disabled) && config.disabled.includes(name);
    const sources = asObject(config.sources);
    sources[name] = placement.source as unknown as Record<string, unknown>;
    config.sources = sources;
  });

  return {
    name,
    dir,
    from: placement.from,
    replaced,
    disabled,
    can: describeUses(manifest.uses as Uses),
    manifest,
  };
}

function stamp(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
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
    return nameInJson(readFileSync(join(dir, "rigline.json"), "utf8")) ?? basename(dir);
  } catch {
    return basename(dir);
  }
}

/** The `name` a manifest text gives itself, or null when there is nothing readable to take. */
function nameInJson(json: string): string | null {
  try {
    const value: unknown = JSON.parse(json);
    const name = (value as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/**
 * A manifest's `entry` as a tarball spells its own paths.
 *
 * A manifest written on Windows may name its entry `dist\\index.js`, and the archive it ships in
 * will not: tar separates with a forward slash wherever it was made.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface AddFromNpmOptions {
  /** `clock`, `clock@1.2.0`, `clock@next`, `@scope/clock` (D58). */
  readonly spec: string;
  readonly pluginsDir: string;
  readonly configPath: string;
  readonly otherRoots?: readonly string[];
  readonly registry?: RegistryOptions;
  readonly now?: () => Date;
}

/**
 * Installs a plugin from a registry: resolve, fetch, check the bytes, read the tarball in memory,
 * validate the manifest, and only then write (D47, D48, D49).
 *
 * The order is the point. Nothing is written until the version has cleared the release-age gate,
 * the bytes have matched their integrity hash, the archive has been read by a reader that refuses
 * everything but plain files under `package/` (D57), and the manifest inside it has been held to
 * exactly the rules a plugin discovered on disk is held to. A tarball that fails any of those
 * leaves the plugins directory as it found it.
 */
export async function addFromNpm(options: AddFromNpmOptions): Promise<AddResult> {
  const spec = parsePluginSpec(options.spec);
  const resolved = await resolveVersion(spec, options.registry);
  const label = `${resolved.name}@${resolved.version}`;

  const withheld = releaseAgeProblem(resolved, options.registry);
  if (withheld !== null) throw new UserError(withheld);

  const files = readPackageTarball(await fetchTarball(resolved, options.registry), label).filter(
    (file) => isPluginOutput(file.path),
  );

  const manifest = manifestIn(files, label);
  const source: NpmSource = {
    kind: "npm",
    name: resolved.name,
    version: resolved.version,
    tag: resolved.tag,
    integrity: resolved.integrity,
    addedAt: stamp(options.now),
  };

  return place({
    manifest,
    from: label,
    pluginsDir: options.pluginsDir,
    configPath: options.configPath,
    otherRoots: options.otherRoots,
    source,
    write: (dir) => {
      for (const file of files) {
        const target = join(dir, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.bytes);
      }
    },
  });
}

/** The manifest carried by an unpacked tarball, held to the same rules as one read off disk. */
function manifestIn(files: readonly TarFile[], label: string): ValidManifest {
  const found = files.find((file) => file.path === "rigline.json");
  if (found === undefined) {
    throw new UserError(
      `${label} has no rigline.json, so it is not a Rigline plugin. Check the package name.`,
    );
  }
  const present = new Set(files.map((file) => file.path));
  const json = found.bytes.toString("utf8");
  // The name to check against is the one the manifest gives itself: an npm package is named for a
  // registry and a plugin is named for itself, and the two need not agree (D58).
  return checkManifest({
    json,
    expectedName: nameInJson(json) ?? label,
    label: `${label}: rigline.json`,
    hasFile: (path) => present.has(normalizePath(path)),
  });
}

/** What `update` did about one plugin. */
export interface PluginUpdate {
  readonly name: string;
  readonly outcome:
    | "updated"
    | "current"
    | "pinned"
    | "local"
    | "unmanaged"
    | "withheld"
    | "failed";
  /** The version it was on, for an npm source. */
  readonly from?: string;
  /** The version it is on now, or the one that was withheld. */
  readonly to?: string;
  /** Why, where the outcome is not self-explanatory. */
  readonly reason?: string;
}

export interface UpdatePluginsOptions {
  readonly pluginsDir: string;
  readonly configPath: string;
  readonly otherRoots?: readonly string[];
  readonly registry?: RegistryOptions;
  /** Only these plugins. Absent means every one in the plugins directory. */
  readonly names?: readonly string[];
  readonly now?: () => Date;
}

/**
 * Moves every plugin with an npm source to whatever its tag resolves to now (D49, D58).
 *
 * It never stops at the first failure, for the same reason the install flow does not: a registry
 * that is down, or one plugin whose package has been unpublished, must not cost every other plugin
 * its update. Each becomes a line with a reason, and the caller decides what that is worth.
 *
 * It never asks about what the new version declares, either. A user who installed a plugin should
 * not be re-asked because its author shipped a feature, and a fetch that halts on a widened
 * declaration is the failure that makes people stop fetching (D49). The install-time declaration
 * check still runs afterwards and still refuses a plugin the extension cannot honour (D43).
 */
export async function updatePlugins(options: UpdatePluginsOptions): Promise<PluginUpdate[]> {
  const sources = readConfig(options.configPath).sources;
  const installed = existsSync(options.pluginsDir)
    ? readdirSync(options.pluginsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const names = options.names ?? installed;
  const updates: PluginUpdate[] = [];

  for (const name of names) {
    if (!installed.includes(name)) {
      updates.push({ name, outcome: "failed", reason: `not installed in ${options.pluginsDir}` });
      continue;
    }
    const source = sources[name];
    if (source === undefined) {
      updates.push({ name, outcome: "unmanaged" });
      continue;
    }
    if (source.kind === "path") {
      updates.push({ name, outcome: "local", reason: source.from });
      continue;
    }
    if (source.tag === null) {
      updates.push({ name, outcome: "pinned", from: source.version });
      continue;
    }
    updates.push(await updateOne(name, source, options));
  }
  return updates;
}

async function updateOne(
  name: string,
  source: NpmSource,
  options: UpdatePluginsOptions,
): Promise<PluginUpdate> {
  try {
    const resolved = await resolveVersion(
      { name: source.name, version: null, tag: source.tag },
      options.registry,
    );
    if (resolved.version === source.version) {
      return { name, outcome: "current", from: source.version };
    }
    const withheld = releaseAgeProblem(resolved, options.registry);
    if (withheld !== null) {
      return {
        name,
        outcome: "withheld",
        from: source.version,
        to: resolved.version,
        reason: withheld,
      };
    }
    const added = await addFromNpm({
      spec: `${source.name}@${resolved.version}`,
      pluginsDir: options.pluginsDir,
      configPath: options.configPath,
      otherRoots: options.otherRoots,
      registry: options.registry,
      now: options.now,
    });
    // Naming a version is how a person pins one, so `add <name>@<version>` records no tag (D58).
    // This is the tag being followed rather than a pin, so the record keeps it.
    updateConfig(options.configPath, (config) => {
      const recorded = asObject(config.sources);
      const current = asObject(recorded[added.name]);
      current.tag = source.tag;
      recorded[added.name] = current;
      config.sources = recorded;
    });
    return { name, outcome: "updated", from: source.version, to: resolved.version };
  } catch (error) {
    return {
      name,
      outcome: "failed",
      from: source.version,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** A plain-text report of one `update` run, for the CLI. */
export function formatUpdates(updates: readonly PluginUpdate[]): string {
  if (updates.length === 0) return "no plugins are installed";
  return updates.map(updateLine).join("\n");
}

function updateLine(update: PluginUpdate): string {
  switch (update.outcome) {
    case "updated":
      return `${update.name}: ${update.from} -> ${update.to}`;
    case "current":
      return `${update.name}: ${update.from}, which is what its tag resolves to`;
    case "pinned":
      return `${update.name}: pinned to ${update.from}; add it again to move it`;
    case "local":
      return `${update.name}: added from ${update.reason}; run rigline add again to refresh it`;
    case "unmanaged":
      return `${update.name}: placed by hand, so there is nowhere to fetch a newer one from`;
    case "withheld":
      return `${update.name}: staying on ${update.from} — ${update.reason}`;
    default:
      return `${update.name}: FAILED — ${update.reason}`;
  }
}
