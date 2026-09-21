/**
 * The bridge the pre hook publishes on `globalThis.__rigline`, as the post hook reads it.
 *
 * Restated here rather than imported: pre.ts is a side-effecting module with no exports, built to
 * its own file, and the two files share nothing at build time by design (a shared chunk would be a
 * file the injector never copies). The pre hook's Node test holds the runtime shape to this one.
 * Host-internal: no plugin sees any of it.
 */
import type { CheckService } from "./checks.ts";

export type Handler = (payload: unknown) => void;
export type Rewriter = (
  payload: Readonly<Record<string, unknown>>,
) => Record<string, unknown> | null;

export interface PluginStatus {
  readonly name: string;
  status: "loaded" | "refused" | "error" | "inactive";
  reason?: string;
  /**
   * Optional declarations this extension cannot honour: what the plugin is loading without (D41).
   * Never a reason it is refused, and present on a loaded plugin, which is the whole point — the
   * plugin works and one of its decorations will not appear, and nothing else would say so.
   */
  missingOptional?: readonly string[];
}

export interface RewriteRecord {
  readonly plugin: string;
  readonly type: string;
  readonly fields: readonly string[];
  /** Times the plugin's transform returned a patch that was applied. */
  applied: number;
  /** Times the transform ran, whether or not it patched: the denominator `applied` needs. */
  ran: number;
  /** The app's sends of this type before this rewriter registered: the boot race, measured. */
  missed: number;
}

export interface HostPatchOutcome {
  readonly plugin: string;
  readonly why: string;
  readonly required: boolean;
  readonly applied: boolean;
  readonly reason?: string;
}

export interface Diagnostics {
  readonly version: string;
  readonly preAt: number;
  postAt: number | null;
  readonly rootChildrenAtPre: number;
  rootChildrenAtPost: number | null;
  readonly acquireWrapped: boolean;
  readonly acquireCalled: boolean;
  readonly outboundCount: number;
  readonly inboundCount: number;
  readonly buffered: number;
  readonly bufferSealed: boolean;
  readonly tapClones: number;
  readonly tapCloneMs: number;
  readonly tapCloneMaxMs: number;
  readonly tapCloneMaxType: string | null;
  readonly resent: number;
  readonly plugins: PluginStatus[];
  rewrites: RewriteRecord[];
  hostPatches: HostPatchOutcome[];
  identifiersFor: string | null;
  engine: string | null;
  readonly react: {
    hook: "installed" | "chained";
    version: string | null;
    commits: number;
    notified: number;
  };
  readonly transcript: { entries: number; timed: number; sweeps: number; rebuilds: number };
  readonly mounts: {
    driver: "commit" | "observer";
    active: number;
    replaced: number;
    moved: number;
    lost: number;
    /** Anchors naming one element whose selector matched more than one, and the most that ever did. */
    multiple: Record<string, number>;
    /**
     * Mounts and watches the host gave up on, `"<plugin>: <what>"` each, because the same
     * correction kept being undone (D54). Never empty in the ordinary case, so a name here is the
     * whole finding: the host and the app were fighting over a position and the host conceded.
     */
    abandoned: string[];
  };
  readonly meters: Record<
    string,
    { peak: number; peakAt: number | null; recent: number; recentAt: number | null }
  >;
  readonly storage: {
    available: boolean;
    writes: number;
    failures: number;
    bytes: number;
    lastError: string | null;
  };
  previous: { from: number; to: number; entries: readonly Record<string, unknown>[] } | null;
  readonly errors: string[];
}

export interface Bus {
  on(type: string, handler: Handler): () => void;
  sealBuffer(): void;
  readonly rewriters: {
    add(type: string, apply: Rewriter): () => void;
    resend(type: string): boolean;
    outboundSeen(type: string): number;
  };
}

export interface ReactBridge {
  onCommit(handler: () => void): () => void;
  fiberFor(element: Element): unknown;
  rendererVersion(): string | null;
}

export interface Bridge {
  readonly diagnostics: Diagnostics;
  /**
   * The check registry, once the kernel has built it. Null until then, and null forever if the
   * kernel never ran — which is itself the thing a reader would want to know.
   *
   * Beside `diagnostics` rather than inside it because `diagnostics` is data: the recorder snapshots
   * it into the storage ring, and a function in there would be one more thing that walk has to know
   * to skip.
   */
  checks: CheckService | null;
  readonly bus: Bus;
  readonly react: ReactBridge;
  /** Count one event against a named hot path's current second. See the pre hook's own `meter`. */
  meter(name: string): void;
}

/** The bridge, or null when the pre hook did not run, in which case nothing can be loaded. */
export function bridge(): Bridge | null {
  const found = (globalThis as { __rigline?: Bridge }).__rigline;
  return found ?? null;
}
