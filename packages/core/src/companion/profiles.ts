/**
 * VS Code's profiles, read from its own files, and the CLI arguments that change them (D100).
 *
 * Nothing lists profiles, so the names come from `storage.json` and each profile's extensions from
 * its `extensions.json`. Every write goes through the editor's CLI, which refuses a profile name it
 * does not know rather than creating one.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const COMPANION_ID = "rigline.rigline";
const CLAUDE_CODE_ID = "anthropic.claude-code";

/** What VS Code calls the one profile `storage.json` does not list, and so what skips it. */
export const DEFAULT_PROFILE = "Default";

/** A profile's companion, as its `extensions.json` entry names it. */
export interface InstalledCompanion {
  readonly version: string | null;
  /** The directory the entry names, or null where it names none this can read. */
  readonly dir: string | null;
}

export interface Profile {
  /** As VS Code's profile switcher shows it. */
  readonly name: string;
  /** Its directory under `User/profiles`, or null for the default profile. */
  readonly location: string | null;
  /** Uses the default profile's extensions, so installing into the default covers it. */
  readonly sharesDefault: boolean;
  readonly claudeCode: boolean;
  readonly companion: InstalledCompanion | null;
}

export type ProfilesRead =
  | { readonly kind: "read"; readonly profiles: readonly Profile[] }
  /** No `storage.json`: an editor never started, or directories somewhere the table does not know. */
  | { readonly kind: "none"; readonly why: string }
  | { readonly kind: "unreadable"; readonly why: string };

/** The default profile first, then the others in `storage.json`'s order. */
export function readProfiles(userData: string, extensionsDir: string): ProfilesRead {
  const storage = join(userData, "User", "globalStorage", "storage.json");
  if (!existsSync(storage)) return { kind: "none", why: `there is no ${storage}` };
  try {
    const defaults = extensionEntries(join(extensionsDir, "extensions.json"));
    const profile = (
      name: string,
      location: string | null,
      sharesDefault: boolean,
      entries: Entries,
    ): Profile => profileOf(name, location, sharesDefault, entries, extensionsDir);
    return {
      kind: "read",
      profiles: [
        profile(DEFAULT_PROFILE, null, false, defaults),
        ...namedProfiles(storage).map(({ name, location, sharesDefault }) =>
          profile(
            name,
            location,
            sharesDefault,
            sharesDefault
              ? defaults
              : extensionEntries(join(userData, "User", "profiles", location, "extensions.json")),
          ),
        ),
      ],
    };
  } catch (error) {
    return { kind: "unreadable", why: error instanceof Error ? error.message : String(error) };
  }
}

/** The default profile alone, from the extensions directory, for where `storage.json` failed. */
export function readDefaultProfile(extensionsDir: string): Profile | { readonly why: string } {
  try {
    const entries = extensionEntries(join(extensionsDir, "extensions.json"));
    return profileOf(DEFAULT_PROFILE, null, false, entries, extensionsDir);
  } catch (error) {
    return { why: error instanceof Error ? error.message : String(error) };
  }
}

/** A profile's `extensions.json` entries by id, lowercased. */
type Entries = ReadonlyMap<string, Record<string, unknown>>;

function profileOf(
  name: string,
  location: string | null,
  sharesDefault: boolean,
  entries: Entries,
  extensionsDir: string,
): Profile {
  const companion = entries.get(COMPANION_ID);
  return {
    name,
    location,
    sharesDefault,
    claudeCode: entries.has(CLAUDE_CODE_ID),
    companion: companion === undefined ? null : installedCompanion(companion, extensionsDir),
  };
}

/**
 * The directory an entry names, as VS Code resolves it: `relativeLocation` under the extensions
 * directory where there is one, else `location`'s file path.
 */
function installedCompanion(
  entry: Record<string, unknown>,
  extensionsDir: string,
): InstalledCompanion {
  const version = typeof entry.version === "string" ? entry.version : null;
  if (typeof entry.relativeLocation === "string" && entry.relativeLocation !== "") {
    return { version, dir: join(extensionsDir, entry.relativeLocation) };
  }
  const location = (entry.location ?? {}) as Record<string, unknown>;
  if (typeof location.fsPath === "string") return { version, dir: location.fsPath };
  if (typeof location.path === "string" && location.scheme === "file") {
    const url = new URL("file:///");
    url.pathname = location.path;
    return { version, dir: fileURLToPath(url) };
  }
  return { version, dir: null };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} could not be read: ${(error as Error).message}`, { cause: error });
  }
}

/** `userDataProfiles`, which is absent until somebody makes a profile. */
function namedProfiles(
  storage: string,
): { name: string; location: string; sharesDefault: boolean }[] {
  const value = readJson(storage);
  const list =
    value !== null && typeof value === "object"
      ? ((value as Record<string, unknown>).userDataProfiles ?? [])
      : [];
  if (!Array.isArray(list)) throw new Error(`${storage}: userDataProfiles is not a list`);
  return list.map((entry) => {
    const { name, location, useDefaultFlags } = (entry ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof location !== "string") {
      throw new Error(`${storage}: a profile has no name or location`);
    }
    const flags = (useDefaultFlags ?? {}) as Record<string, unknown>;
    return { name, location, sharesDefault: flags.extensions === true };
  });
}

/** The entries a profile's `extensions.json` lists; none when it has never had one. */
function extensionEntries(path: string): Entries {
  if (!existsSync(path)) return new Map();
  const list = readJson(path);
  if (!Array.isArray(list)) throw new Error(`${path} is not a list of extensions`);
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of list) {
    const id = (entry as { identifier?: { id?: unknown } } | null)?.identifier?.id;
    if (typeof id === "string") entries.set(id.toLowerCase(), entry as Record<string, unknown>);
  }
  return entries;
}

export interface EditorDirs {
  readonly userData: string;
  readonly extensionsDir: string;
}

/** The names an editor's directories are derived from: `nameShort` and `dataFolderName`. */
export interface ProductDirs {
  readonly product: string;
  readonly dataFolder: string;
}

export interface DirsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
}

/**
 * Where an editor keeps its user data and extensions when nothing on its command line moved them,
 * in the order VS Code itself resolves them. A custom `--user-data-dir` is out of reach from here.
 */
export function editorDirs(product: ProductDirs, options: DirsOptions = {}): EditorDirs {
  const { env = process.env, platform = process.platform, home = homedir() } = options;
  const portable = env.VSCODE_PORTABLE;
  if (portable) {
    return { userData: join(portable, "user-data"), extensionsDir: join(portable, "extensions") };
  }
  const appData =
    env.VSCODE_APPDATA ||
    (platform === "win32"
      ? env.APPDATA || join(home, "AppData", "Roaming")
      : platform === "darwin"
        ? join(home, "Library", "Application Support")
        : env.XDG_CONFIG_HOME || join(home, ".config"));
  return {
    userData: join(appData, product.product),
    extensionsDir: env.VSCODE_EXTENSIONS || join(home, product.dataFolder, "extensions"),
  };
}

/** `profile "A"`, `profiles "A" and "B"`, for a line about them. */
export function profilesNamed(profiles: readonly Profile[]): string {
  const names = profiles.map((p) => `"${p.name}"`);
  if (names.length === 1) return `profile ${names[0]}`;
  return `profiles ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The CLI's name for a profile: none for the default one, which the CLI uses when told nothing. */
export function cliProfile(profile: Profile): string | null {
  return profile.location === null ? null : profile.name;
}

/**
 * The argv for an install, kept out of Settings Sync (D93). `--force` only where it replaces a
 * companion, since it permits a downgrade after an engine rollback: a VSIX install re-extracts the
 * directory with or without it.
 */
export function installArgv(vsix: string, profile: string | null, force: boolean): string[] {
  return [
    "--install-extension",
    vsix,
    ...(force ? ["--force"] : []),
    "--do-not-sync",
    ...(profile === null ? [] : ["--profile", profile]),
  ];
}

export function uninstallArgv(profile: string | null): string[] {
  return [
    "--uninstall-extension",
    COMPANION_ID,
    ...(profile === null ? [] : ["--profile", profile]),
  ];
}

/** How to run one editor's CLI: a command, the arguments ahead of the CLI's own, and any env. */
export interface EditorCli {
  readonly command: string;
  readonly prefix: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export type RunCli = (
  cli: EditorCli,
  argv: readonly string[],
) => Promise<{ readonly code: number; readonly output: string }>;
