/**
 * The bridge the pre hook publishes on `globalThis.__prototype`, as the post hook reads it.
 *
 * Restated here rather than imported: pre.ts is a side-effecting module with no exports, built to
 * its own file, and the two files share nothing at build time by design (a shared chunk would be a
 * file the injector never copies). The pre hook's Node test holds the runtime shape to this one.
 * Host-internal: no plugin sees any of it.
 */

export type Handler = (payload: unknown) => void;
export type Rewriter = (
  payload: Readonly<Record<string, unknown>>,
) => Record<string, unknown> | null;

export interface PluginStatus {
  readonly name: string;
  status: "loaded" | "refused" | "error" | "inactive";
  reason?: string;
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
  readonly react: {
    hook: "installed" | "chained";
    version: string | null;
    commits: number;
    notified: number;
  };
  readonly transcript: { entries: number; timed: number; sweeps: number; rebuilds: number };
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
  readonly bus: Bus;
  readonly react: ReactBridge;
}

/** The bridge, or null when the pre hook did not run, in which case nothing can be loaded. */
export function bridge(): Bridge | null {
  const found = (globalThis as { __prototype?: Bridge }).__prototype;
  return found ?? null;
}
