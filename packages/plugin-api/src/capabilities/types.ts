/**
 * The contract half of a capability: data and pure functions shared by the installer (Node) and
 * the loader (webview), so that the gate asked before injecting and the check asked before
 * importing cannot give different answers (decisions.md, D16, D18).
 *
 * The runtime half, which builds a plugin's slice of `ctx`, lives in the host package and is
 * joined to this by `key`.
 */
import type { IdentifierTables } from "../tables.ts";

/**
 * Everything a plugin may declare about one capability, with every key present. Declared twice per
 * manifest: once under `uses` and once under `uses.optional`, which is the same shape read for a
 * different verdict (D41).
 */
export interface Declarations {
  /** Curated anchor names the plugin resolves through `ctx.anchor()`. */
  readonly anchors: readonly string[];
  /** Module hash -> local class names the plugin resolves through `ctx.cls()`. The escape hatch. */
  readonly classes: Readonly<Record<string, readonly string[]>>;
  /** Message types the plugin taps through `ctx.onMessage()`. */
  readonly messages: readonly string[];
  /** Outbound message type -> the payload fields the plugin may replace through `ctx.rewrite()`. */
  readonly rewrites: Readonly<Record<string, readonly string[]>>;
  /** Whether the plugin places DOM through `ctx.mount()`, `ctx.mountAfter()`, `ctx.mountBefore()`
   * or `ctx.watch()`. */
  readonly mount: boolean;
  /** Whether the plugin injects a stylesheet through `ctx.style()`. */
  readonly style: boolean;
  /** Whether the plugin watches tool calls through `ctx.onToolUse()`. */
  readonly tools: boolean;
  /** Whether the plugin follows the panel's session through `ctx.onSessionId()`. */
  readonly session: boolean;
  /** Whether the plugin decorates transcript rows through `ctx.decorateTranscript()`. */
  readonly transcript: boolean;
}

/** Everything a plugin declared under `uses`: the required half, plus the optional half nested. */
export interface Uses extends Declarations {
  /**
   * The same keys again, checked the same way, refusing nothing (D41). Nested under `uses` rather
   * than beside it so that both verdicts are one walk over one registry, and a capability added
   * later is optional-capable without anything being taught about it.
   */
  readonly optional: Declarations;
}

export type UsesKey = keyof Declarations;

export interface CapabilityContract<K extends UsesKey = UsesKey> {
  readonly key: K;
  /** The `ctx` members this capability grants. Used by the advisory source scan and by docs. */
  readonly grants: readonly string[];
  /**
   * This key's fragment of the manifest's JSON schema, so an author's editor completes and
   * validates a declaration before anything is run (D18). It is a second statement of the same
   * rule `shape` enforces, in the one language editors read; the two are held together by a test
   * rather than by anybody remembering, because they cannot be derived from one another.
   */
  readonly schema: Readonly<Record<string, unknown>>;
  /** Why `value` is not a well-formed declaration for this key, or null. Shape only. */
  shape(value: unknown): string | null;
  /**
   * Every identifier this declaration depends on that `tables` lacks, one reason each, in
   * declaration order. Both verdicts read this: a required declaration is refused on the first gap,
   * because the name is what makes a refusal attributable and a module that has gone loses every
   * class in it at once; an optional declaration is reported on all of them, because each is a
   * decoration the plugin will go without and the author is owed the whole list.
   */
  gaps(declared: Declarations[K], tables: IdentifierTables): readonly string[];
  /** One line per thing the plugin will be able to do with this declaration, for the install summary. */
  summary(declared: Declarations[K]): readonly string[];
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isRecordOfStringArrays(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isStringArray)
  );
}

/** The shape check every boolean switch shares. */
export function booleanShape(value: unknown): string | null {
  return typeof value === "boolean" ? null : `must be true or false, got ${JSON.stringify(value)}`;
}

/** A contract for a switch that expands to fixed message types and anchors the host taps for it. */
export function switchContract<K extends "tools" | "session" | "transcript">(spec: {
  readonly key: K;
  readonly grants: readonly string[];
  readonly messages: readonly string[];
  readonly anchors: readonly string[];
  readonly summary: string;
}): CapabilityContract<K> {
  const grant = spec.grants[0] ?? spec.key;
  return {
    key: spec.key,
    grants: spec.grants,
    schema: { type: "boolean", description: spec.summary },
    shape: booleanShape,
    gaps(declared, tables) {
      if (!declared) return [];
      const gaps: string[] = [];
      for (const type of spec.messages) {
        if (!tables.messageTypes.includes(type)) {
          gaps.push(
            `"${spec.key}" needs message type "${type}", which is gone: ${grant}() would never fire`,
          );
        }
      }
      for (const anchor of spec.anchors) {
        if ((tables.anchors[anchor] ?? null) === null) {
          gaps.push(
            `"${spec.key}" needs anchor "${anchor}", which is gone: ${grant}() would find nothing`,
          );
        }
      }
      return gaps;
    },
    summary: (declared) => (declared ? [spec.summary] : []),
  };
}
