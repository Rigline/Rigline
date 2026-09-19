/**
 * The installer: injects the loader into one extension directory's webview bundle, keeps its
 * identifier tables and plugin registry current, applies declared host patches, and restores an
 * extension to the bytes it shipped with.
 *
 * Every read and write of a bundle here is over Buffers, never through a string encoding: this
 * repo's fixtures deliberately carry CRLF line endings and non-ASCII bytes to keep that honest,
 * because a round trip through `"utf8"` or `"latin1"` text would rewrite line endings on Windows
 * and turn a two-line patch into a diff nobody could audit (D37).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  capabilityViolation,
  type IdentifierTables,
  optionalGaps,
  sharedFields,
} from "@rigline/plugin-api";
import {
  type AnchorOverrideOutcome,
  type AnchorOverrides,
  anchorOverrideOutcomes,
  NO_ANCHOR_OVERRIDES,
} from "../anchors/overrides.ts";
import { generate } from "../codegen/generate.ts";
import { UserError } from "../errors.ts";
import {
  HOST_BACKUP,
  HOST_BUNDLE,
  hostBackupIsCurrent,
  isExtensionDir,
  readBundles,
  WEBVIEW_BACKUP,
  WEBVIEW_BUNDLE,
} from "../extension/bundles.ts";
import { harvestAll } from "../layers/index.ts";
import {
  bakeRegistry,
  capabilityUseNotes,
  type DiscoveredPlugin,
  declaredPatches,
  discoverPlugins,
  enabledPlugins,
  isPluginOutput,
  readConfig,
} from "../plugins/discover.ts";
import { applyPatches, type PatchOutcome } from "./hostpatch.ts";

/**
 * The payload directory, under the extension's `webview/`.
 *
 * **Changing this needs more than changing this.** A directory left by an earlier name is not
 * inert: rolling the old two-line patch back leaves the live bundle with no reference to it, but a
 * webview opened before that rollback still holds the old `pre.js`/`post.js` resolved in its module
 * graph, and they are still on disk — so it goes on running an entire second loader generation, its
 * own observer, devtools hook, bus taps and sweeps, until the window reloads. A rename therefore
 * has to delete the old directory wherever the payload is written or torn down, which is a
 * deliberate deletion by name rather than the cautious refusal `settleWebviewBackup` makes about a
 * directory it cannot attribute.
 */
const DIRNAME = "rigline";

/** The comment that marks the static import. Never trusted on its own (D38) — see `verdict`. */
const MARKER = "/*RIGLINE-PRE*/";

/** Evaluates before the bundle body, so it can wrap `acquireVsCodeApi` before the app's one call to it. */
const PRE_LINE = `import"./${DIRNAME}/pre.js";${MARKER}\n`;
/** Runs after `createRoot().render()`; its own `catch` is what stops a post-hook failure reaching the app. */
const POST_LINE = `\n/*RIGLINE-POST*/import("./${DIRNAME}/post.js").catch((e)=>console.error("[rigline] post-hook",e));\n`;

const PRE_BYTES = Buffer.from(PRE_LINE, "utf8");
const POST_BYTES = Buffer.from(POST_LINE, "utf8");

/** The exact number of bytes one injection adds. Quoted in docs; changing either line changes it. */
export const PATCH_BYTES = PRE_BYTES.byteLength + POST_BYTES.byteLength;

const PAYLOAD_FILES = ["pre.js", "post.js"];

/** Everything on disk for one installed extension directory, read once and reused. */
export interface Injection {
  readonly ext: string;
  readonly bundle: string;
  readonly backup: string;
  readonly host: string;
  readonly hostBackup: string;
  readonly payloadDir: string;
  readonly markerPresent: boolean;
  readonly backupExists: boolean;
  readonly hostBackupExists: boolean;
}

/** Reads current on-disk state without changing anything. Throws `UserError` outside an extension. */
export function inspect(ext: string): Injection {
  if (!isExtensionDir(ext)) {
    throw new UserError(`${ext} is not a Claude Code extension directory`);
  }
  const bundle = join(ext, WEBVIEW_BUNDLE);
  const backup = join(ext, WEBVIEW_BACKUP);
  const host = join(ext, HOST_BUNDLE);
  const hostBackup = join(ext, HOST_BACKUP);
  const payloadDir = join(ext, "webview", DIRNAME);
  return {
    ext,
    bundle,
    backup,
    host,
    hostBackup,
    payloadDir,
    markerPresent: readFileSync(bundle).includes(MARKER),
    backupExists: existsSync(backup),
    hostBackupExists: existsSync(hostBackup),
  };
}

export type Verdict = "vanilla" | "patched" | "unknown";

/**
 * The live webview bundle against its backup — never the marker, which is a comment inside bytes
 * a plugin's own host patch or a foreign tool could equally well have left alone or disturbed.
 * `"unknown"` only when there is no backup to compare against at all.
 */
export function verdict(state: Injection): Verdict {
  if (!state.backupExists) return "unknown";
  const live = readFileSync(state.bundle);
  const backup = readFileSync(state.backup);
  return live.equals(backup) ? "vanilla" : "patched";
}

/**
 * The live host bundle against its backup. No backup here means `"vanilla"`, a stronger answer
 * than webview's `"unknown"`: a host backup is written only the moment a patch first applies, so
 * its absence already says nothing has touched `extension.js`.
 */
export function hostVerdict(state: Injection): Verdict {
  if (!state.hostBackupExists) return "vanilla";
  const live = readFileSync(state.host);
  const backup = readFileSync(state.hostBackup);
  return live.equals(backup) ? "vanilla" : "patched";
}

/**
 * Settles the webview backup before anything else reads it, because `generated.js` is harvested
 * from the pristine bundle. In order: no backup yet, so the live bytes become one; backup and live
 * already agree, so there is nothing to do; the live bytes are already this exact loader's patch
 * over the backup, so again nothing to do (the shape a repeated install finds every time); the
 * backup appears inside the live bytes with some other head or tail around it — an older marker
 * text, or a patch this installer did not write — so it is rolled back, leaving whatever used that
 * payload directory unreferenced rather than deleted on the strength of bytes nobody here wrote;
 * otherwise the two share no relation at all, meaning the extension was replaced in place, and the
 * live bytes become the new pristine baseline.
 */
function settleWebviewBackup(state: Injection, log: (line: string) => void): void {
  const live = readFileSync(state.bundle);
  if (!state.backupExists) {
    writeFileSync(state.backup, live);
    return;
  }
  const backup = readFileSync(state.backup);
  if (live.equals(backup)) {
    return;
  }
  if (live.equals(Buffer.concat([PRE_BYTES, backup, POST_BYTES]))) {
    return;
  }
  if (live.includes(backup)) {
    writeFileSync(state.bundle, backup);
    log(
      `${state.bundle} carried an unrecognised patch; rolled it back from ${state.backup} ` +
        "(any payload directory it used is left in webview/, unreferenced)",
    );
    return;
  }
  writeFileSync(state.backup, live);
}

function copyPluginDir(src: string, dest: string): void {
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => isPluginOutput(relative(src, source)),
  });
}

export interface InstallOptions {
  readonly payloadDir: string;
  readonly plugins?: {
    readonly roots: readonly string[];
    readonly last?: readonly string[];
    readonly configPath: string;
  };
  /**
   * `~/.rigline/anchors.json`, already read (D44). Absent means the shipped table, which is what a
   * test wants and what any caller with no interest in user state gets. The flow reads the file
   * once and passes it down here, the way it owns the baseline path.
   */
  readonly anchors?: AnchorOverrides;
  readonly log?: (line: string) => void;
}

/** One enabled plugin's verdict against the tables harvested from this extension directory (D43). */
export interface PluginVerdict {
  readonly plugin: string;
  /** Why this version will refuse it at load, naming the identifier that is gone, or null. */
  readonly refusal: string | null;
  /** Optional declarations this version cannot honour: what it will load without. */
  readonly missingOptional: readonly string[];
  /** Raw `cls()` pairs declared: the dependencies no anchor-table fix can reach (D44). */
  readonly rawClasses: number;
}

export interface InstallReport {
  readonly ext: string;
  readonly version: string;
  readonly action: "injected" | "refreshed";
  readonly hostChanged: boolean;
  readonly patchOutcomes: readonly PatchOutcome[];
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  readonly notes: readonly string[];
  /** Every enabled plugin, checked against this directory's tables before anything was written. */
  readonly verdicts: readonly PluginVerdict[];
  /** Each local anchor override, and what this version's class map makes of it (D44). */
  readonly anchorOverrides: readonly AnchorOverrideOutcome[];
}

/**
 * Every enabled plugin's verdict against one version's tables (D43).
 *
 * The same `capabilityViolation` the kernel asks at load, asked here so a person learns from the
 * install rather than from a console line after a reload — and so the identifier name reaches the
 * plugin's maintainer in a bug report instead of "it stopped working".
 *
 * It changes nothing. A refused plugin is still copied and still baked into the registry, and the
 * kernel refuses it at load exactly as it would have: enforcement stays in one place, and a plugin
 * quietly missing from the panel is worse than one the probe can name and explain. Never a reason
 * to block the install (D27).
 */
export function pluginVerdicts(
  enabled: readonly DiscoveredPlugin[],
  tables: IdentifierTables,
): PluginVerdict[] {
  return enabled.map((p) => ({
    plugin: p.name,
    refusal: capabilityViolation(p.manifest.uses, tables),
    missingOptional: optionalGaps(p.manifest.uses, tables),
    rawClasses: Object.values(p.manifest.uses.classes).reduce((n, l) => n + l.length, 0),
  }));
}

/**
 * Installs or refreshes the loader in one extension directory. See the module comment and
 * docs/host.md for the full step order; in brief: settle the webview backup, copy the payload and
 * write this directory's identifier tables, apply and bake any declared host patches, and only
 * then decide whether the two-line patch itself needs writing at all.
 */
export function install(ext: string, options: InstallOptions): InstallReport {
  const log = options.log ?? (() => {});

  for (const file of PAYLOAD_FILES) {
    if (!existsSync(join(options.payloadDir, file))) {
      throw new UserError(`payload is missing ${file}: ${options.payloadDir}`);
    }
  }

  const state = inspect(ext);

  // The identifiers a plugin declares against are harvested from the pristine bundle, so the
  // backup must be trustworthy before anything reads it.
  settleWebviewBackup(state, log);

  mkdirSync(state.payloadDir, { recursive: true });
  // The payload lands before the bundle is ever patched: a static import pointing at a file that
  // is not there yet blanks the panel on the very next reload.
  for (const file of PAYLOAD_FILES) {
    cpSync(join(options.payloadDir, file), join(state.payloadDir, file));
  }
  const overrides = options.anchors ?? NO_ANCHOR_OVERRIDES;
  const harvest = harvestAll(readBundles(ext));
  // The merged table, so an override reaches the `generated.js` the loader reads rather than only
  // the report about it.
  const generated = generate(harvest, overrides.table);
  writeFileSync(join(state.payloadDir, "generated.js"), generated.runtime);
  log(`${ext}: ${generated.counts}`);

  let hostChanged = false;
  let patchOutcomes: readonly PatchOutcome[] = [];
  let enabledNames: readonly string[] = [];
  let disabledNames: readonly string[] = [];
  const notes: string[] = [];
  let verdicts: readonly PluginVerdict[] = [];

  if (options.plugins) {
    const { roots, last, configPath } = options.plugins;
    const discovered = discoverPlugins(roots, { last, log });
    const config = readConfig(configPath);
    const enabled = enabledPlugins(discovered, config, log);
    enabledNames = enabled.map((p) => p.name);
    const enabledSet = new Set(enabledNames);
    disabledNames = discovered.filter((p) => !enabledSet.has(p.name)).map((p) => p.name);

    const declared = declaredPatches(enabled);
    const hostLive = readFileSync(state.host);
    const hostBackupCurrent =
      state.hostBackupExists && hostBackupIsCurrent(state.hostBackup, state.host);
    const hostPristine = hostBackupCurrent ? readFileSync(state.hostBackup) : hostLive;

    const { bytes: hostBytes, outcomes } = applyPatches(hostPristine, declared);
    patchOutcomes = outcomes;

    if (!hostBackupCurrent && outcomes.some((o) => o.applied)) {
      // A patch is about to land and the backup does not already hold this build's pristine
      // bytes — either there was none, or it belonged to a build extension.js has since replaced.
      writeFileSync(state.hostBackup, hostPristine);
    }
    if (!hostBytes.equals(hostLive)) {
      writeFileSync(state.host, hostBytes);
      hostChanged = true;
      log(
        'extension.js changed: run "Developer: Reload Window" (this ends the window\'s sessions)',
      );
    }
    // The plugin's name, not its `why`: the rationale is a paragraph, it is the same paragraph on
    // every installed version, and `doctor` already carries it in full for the one case — a panel
    // behaving oddly — where somebody wants to read it.
    for (const outcome of outcomes) {
      log(
        outcome.applied
          ? `patched extension.js for ${outcome.plugin}`
          : `patch NOT applied for ${outcome.plugin}: ${outcome.reason}`,
      );
    }

    const pluginsOut = join(state.payloadDir, "plugins");
    rmSync(pluginsOut, { recursive: true, force: true });
    mkdirSync(pluginsOut, { recursive: true });
    for (const p of enabled) {
      copyPluginDir(p.dir, join(pluginsOut, p.name));
    }
    writeFileSync(join(state.payloadDir, "registry.js"), bakeRegistry(enabled, outcomes));

    // Before the notes, because this is the one report that says whether a plugin will work here.
    verdicts = pluginVerdicts(enabled, generated.tables);
    for (const verdict of verdicts) {
      if (verdict.refusal)
        log(`${verdict.plugin}: REFUSED on ${generated.tables.version} — ${verdict.refusal}`);
      for (const gap of verdict.missingOptional) {
        log(`${verdict.plugin}: loads without an optional dependency — ${gap}`);
      }
      if (verdict.rawClasses > 0) {
        log(
          `${verdict.plugin}: ${verdict.rawClasses} raw class pair(s), which no anchor-table fix can repair`,
        );
      }
    }

    notes.push(...capabilityUseNotes(enabled));
    for (const shared of sharedFields(
      enabled.map((p) => ({ name: p.name, rewrites: p.manifest.uses.rewrites })),
    )) {
      notes.push(
        `${shared.type}.${shared.field} is rewritten by ${shared.plugins.join(", then ")}`,
      );
    }
    for (const note of notes) log(`capability declaration: ${note}`);
  }

  // Only now decide whether the bundle itself needs the two-line patch. `settleWebviewBackup`
  // leaves the live bytes in exactly one of two shapes: equal to the backup (nothing installed
  // yet), or equal to this loader's own patch over the backup (already installed). Rebuilding the
  // payload and reloading the webview is the whole development loop, so the second case rewrites
  // nothing.
  const backup = readFileSync(state.backup);
  const live = readFileSync(state.bundle);
  const alreadyPatched = live.equals(Buffer.concat([PRE_BYTES, backup, POST_BYTES]));
  if (!alreadyPatched) {
    writeFileSync(state.bundle, Buffer.concat([PRE_BYTES, backup, POST_BYTES]));
    log(`${ext}: injected (${PATCH_BYTES} bytes added) — reload with Developer: Reload Webviews`);
  }

  return {
    ext,
    version: generated.tables.version,
    action: alreadyPatched ? "refreshed" : "injected",
    hostChanged,
    patchOutcomes,
    enabled: enabledNames,
    disabled: disabledNames,
    notes,
    verdicts,
    anchorOverrides: anchorOverrideOutcomes(harvest.classes, overrides),
  };
}

export interface RestoreResult {
  readonly ext: string;
  /** The webview side: whether the panel is back on the extension's own bytes. */
  readonly restored: boolean;
  readonly reason?: string;
  /**
   * Why `extension.js` could not be put back, when it had a backup and the revert failed.
   *
   * Reported apart from `reason` because the two failures cost different things and are recovered
   * differently: a webview that cannot be restored is a panel that may not render, and a host bundle
   * that cannot be restored is an extension host still running a plugin's substitution after a
   * command that said it had undone it. Absent in the ordinary case, which is that nothing ever
   * patched the host bundle, so there was no backup and nothing to put back.
   */
  readonly hostReason?: string;
}

/**
 * Copies `backupPath` over `target` and re-reads it to confirm the bytes actually match.
 *
 * An I/O failure is returned, never thrown. Restoring is the recovery path and runs against an
 * editor that may still be holding these files open, so a write refused by the platform is an
 * expected outcome rather than an exceptional one — and a throw here would abort `restoreAll` part
 * way through, stranding every directory after the one that failed, which is the opposite of what
 * that function promises.
 */
function revert(
  target: string,
  backupPath: string,
): { readonly ok: boolean; readonly reason?: string } {
  if (!existsSync(backupPath)) {
    return { ok: false, reason: `no backup at ${backupPath}` };
  }
  try {
    const backup = readFileSync(backupPath);
    writeFileSync(target, backup);
    const after = readFileSync(target);
    if (!after.equals(backup)) {
      return { ok: false, reason: `${target} did not match ${backupPath} after restoring` };
    }
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `could not write ${target} from ${backupPath}: ${detail}` };
  }
}

/**
 * Restores one extension directory to the bytes it shipped with. The webview and host bundles are
 * recovered independently — a missing webview backup must not strand a host bundle that still has
 * one, and vice versa — and `restored` reports the webview side, since that is the one whose
 * absence blanks the panel.
 *
 * The host side is attempted only when it has a backup, because no backup is the ordinary state:
 * one is written the moment a patch first lands, so its absence already says nothing patched
 * `extension.js`. Attempting it regardless and discarding the answer, which is what this did, made
 * the one case that matters unreportable — a backup that is there and could not be written back, so
 * the extension host keeps running a substitution after a command that said it had been undone.
 */
export function restore(ext: string): RestoreResult {
  const state = inspect(ext);
  const webview = revert(state.bundle, state.backup);
  const host = state.hostBackupExists
    ? revert(state.host, state.hostBackup)
    : { ok: true as const };
  rmSync(state.payloadDir, { recursive: true, force: true });
  return {
    ext,
    restored: webview.ok,
    ...(webview.ok ? {} : { reason: webview.reason }),
    ...(host.ok ? {} : { hostReason: host.reason }),
  };
}

/**
 * Restores every extension directory given, never stopping at the first failure: discovery orders
 * these oldest first, and the version most likely still open in a window is usually the one that
 * lost its backup, so aborting early would strand exactly the one most worth recovering.
 */
export function restoreAll(exts: readonly string[]): RestoreResult[] {
  return exts.map((ext) => restore(ext));
}
