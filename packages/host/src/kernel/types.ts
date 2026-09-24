/**
 * What a capability module is given, and what it is.
 *
 * The kernel owns the plugin lifecycle, the shared services (mounts, session, transcript) and the
 * diagnostics; a capability module owns one key of the manifest and builds that key's slice of a
 * plugin's `ctx`. Modules do not import each other. One that needs another's state asks the kernel
 * for the service that owns it.
 */
import type {
  CapabilityContract,
  Elements,
  IdentifierTables,
  OptionalContext,
  PluginContext,
  Surface,
  Teardown,
  Uses,
  UsesKey,
} from "@rigline/plugin-api";
import type { Bus, Diagnostics, ReactBridge } from "./bridge.ts";
import type { Check, CheckService } from "./checks.ts";
import type { MountService } from "./mounts.ts";
import type { SessionService } from "./session.ts";
import type { ShellService } from "./shell.ts";
import type { ToolService } from "./tools.ts";
import type { TranscriptService } from "./transcript.ts";

/** One registry entry, as the injector baked it, plus its position in the registry. */
export interface PluginRecord {
  readonly name: string;
  readonly entry: string;
  readonly surfaces: readonly Surface[];
  readonly uses: Uses;
  readonly elements: Elements;
  /** Why a declared host patch stops this plugin loading, or null. Settled by the injector. */
  readonly patchRefusal: string | null;
  /** Position in the registry: the order mounts sharing an anchor appear in and rewriters compose in. */
  readonly order: number;
}

export interface Kernel {
  readonly tables: IdentifierTables;
  readonly surface: Surface;
  readonly bus: Bus;
  readonly react: ReactBridge;
  readonly diagnostics: Diagnostics;
  readonly mounts: MountService;
  readonly session: SessionService;
  readonly tools: ToolService;
  readonly transcript: TranscriptService;
  readonly checks: CheckService;
  readonly shell: ShellService;
  /**
   * The registry as the injector baked it, before any of it has loaded.
   *
   * Here so that a capability's check can ask whether anything on this surface uses it at all, and
   * say `n/a` rather than nothing when the answer is no — and so that the taps a check would need
   * to answer are only installed when somebody was going to install them anyway. Read for that; the
   * per-plugin verdicts live on `diagnostics.plugins`, which is where the loop writes them.
   */
  readonly plugins: readonly PluginRecord[];
}

/** What `grant` receives for one plugin. */
export interface Grant {
  readonly plugin: PluginRecord;
  readonly kernel: Kernel;
  /** Register anything that must be undone when the plugin is disabled or torn down. */
  own(teardown: Teardown): Teardown;
  /** Disable this plugin with an attributable reason. Idempotent. */
  disable(reason: string): void;
  /** Wrap a plugin callback so a throw disables the plugin rather than escaping. */
  guard<A extends unknown[]>(what: string, fn: (...args: A) => void): (...args: A) => void;
}

export interface CapabilityModule<K extends UsesKey = UsesKey> {
  readonly contract: CapabilityContract<K>;
  /** The methods this capability adds to one plugin's ctx, scoped to what it declared. */
  grant(grant: Grant): Partial<PluginContext>;
  /**
   * The methods this capability adds to `ctx.optional`, for the lookups that may answer null (D41).
   * Only the two lookup-shaped capabilities implement it; everything else optional needs no API,
   * because a handler that never fires is already what absence does. Kept as a second method rather
   * than a nested `optional` key in `grant`'s return so the kernel's merge stays a flat
   * `Object.assign` and cannot silently clobber one capability's slice with another's.
   */
  grantOptional?(grant: Grant): Partial<OptionalContext>;
  /**
   * The lines this capability contributes to `core`, registered once at boot rather than per plugin.
   *
   * A module's check is a reading of state the module already owns, so it is handed the `Kernel` —
   * where a plugin's check is handed nothing. Called before any plugin loads, so `core` is the first
   * contributor in the panel and a capability that has already failed says so above the plugins it
   * took down with it. A module with nothing to say omits this.
   */
  checks?(kernel: Kernel): readonly Check[];
}

/**
 * Whether a plugin declared a boolean switch at all, on either side of `uses` (D41).
 *
 * Declaring one under `uses.optional` says "do not refuse me when the thing this rests on is gone",
 * never "do not grant it to me". The grant is the same grant; what optional changes is only the
 * verdict when an identifier is missing, and for a switch that verdict is a handler that never
 * fires — which is what absence already does. Reading only the required half would make a plugin
 * that declared `tools` optionally throw on its first `onToolUse` and disable itself, which is the
 * opposite of what optional is for.
 */
export function declaredSwitch(plugin: PluginRecord, key: UsesKey): boolean {
  return plugin.uses[key] === true || plugin.uses.optional[key] === true;
}

/**
 * Whether any plugin active on this surface declared `key`.
 *
 * What a capability's check asks before it says anything: a capability nothing here uses reports
 * `n/a` and why, rather than an empty pass that reads as evidence. It is also the gate on installing
 * the tap such a check would need — the tool and session services tap the bus lazily, on the first
 * subscriber, and a check must not be the thing that makes a panel pay for a capability no plugin
 * on it asked for.
 */
export function usedOnSurface(kernel: Kernel, key: UsesKey): boolean {
  return kernel.plugins.some((p) => p.surfaces.includes(kernel.surface) && declaredSwitch(p, key));
}

/** A method the plugin did not declare for: it throws, and the kernel's guard turns that into a disable. */
export function undeclared(method: string, key: UsesKey, detail = ""): () => never {
  return () => {
    throw new Error(`${method}() needs "${key}" in this plugin's rigline.json${detail}`);
  };
}
