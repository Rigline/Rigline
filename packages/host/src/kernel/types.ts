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
  IdentifierTables,
  OptionalContext,
  PluginContext,
  Surface,
  Teardown,
  Uses,
  UsesKey,
} from "@rigline/plugin-api";
import type { Bus, Diagnostics, ReactBridge } from "./bridge.ts";
import type { MountService } from "./mounts.ts";
import type { SessionService } from "./session.ts";
import type { TranscriptService } from "./transcript.ts";

/** One registry entry, as the injector baked it, plus its position in the registry. */
export interface PluginRecord {
  readonly name: string;
  readonly entry: string;
  readonly surfaces: readonly Surface[];
  readonly uses: Uses;
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
  readonly transcript: TranscriptService;
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
}

/** A method the plugin did not declare for: it throws, and the kernel's guard turns that into a disable. */
export function undeclared(method: string, key: UsesKey, detail = ""): () => never {
  return () => {
    throw new Error(`${method}() needs "${key}" in this plugin's rigline.json${detail}`);
  };
}
