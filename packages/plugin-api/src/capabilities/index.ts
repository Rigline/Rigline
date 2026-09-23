/**
 * The capability registry's contract half. The kernel and the installer walk `CONTRACTS`; neither
 * names a capability itself (decisions.md, D18).
 */
import type { IdentifierTables } from "../tables.ts";
import { anchorsContract } from "./anchors.ts";
import { classesContract } from "./classes.ts";
import { messagesContract } from "./messages.ts";
import { rewritesContract } from "./rewrites.ts";
import {
  menuContract,
  mountContract,
  sessionContract,
  styleContract,
  toolsContract,
  transcriptContract,
} from "./switches.ts";
import type { CapabilityContract, Declarations, Uses, UsesKey } from "./types.ts";

export const CONTRACTS: readonly CapabilityContract[] = [
  anchorsContract,
  classesContract,
  messagesContract,
  rewritesContract,
  mountContract,
  styleContract,
  toolsContract,
  sessionContract,
  transcriptContract,
  menuContract,
  // Each contract is typed to its own key; the registry erases that once, here, and every walk
  // over it re-narrows by `contract.key`.
] as unknown as readonly CapabilityContract[];

/** Every gap in one half of a manifest's declarations, in registry order. */
function gapsOf(declared: Declarations, tables: IdentifierTables): string[] {
  return CONTRACTS.flatMap((contract) => contract.gaps(declared[contract.key] as never, tables));
}

/**
 * The first reason `uses` does not hold against `tables`, or null. Asked in Node before injecting
 * (D43) and in the webview before importing a plugin, through this one function, so the two cannot
 * give different answers.
 *
 * The first gap rather than all of them: a refusal needs one name a person can search for, and the
 * rest of the list is usually the same module or the same message going twice.
 */
export function capabilityViolation(uses: Uses, tables: IdentifierTables): string | null {
  return gapsOf(uses, tables)[0] ?? null;
}

/**
 * Every optional declaration `tables` cannot honour: what this plugin will do without (D41). All of
 * them rather than the first, because each is a decoration that will silently not appear and the
 * author is owed the whole list. Never a refusal, at install or at load.
 *
 * `mount` and `style` can never appear here — they depend on nothing harvested — so declaring
 * either optional is a harmless no-op rather than an error. Mirroring `uses` key for key is what
 * keeps this one walk over one registry; carving out the two keys that cannot be missing would buy
 * a validation message and cost the property that makes a new capability optional-capable for free.
 */
export function optionalGaps(uses: Uses, tables: IdentifierTables): string[] {
  return gapsOf(uses.optional, tables);
}

/**
 * What a plugin does, one sentence per thing its manifest declares. `rigline list` prints these, and
 * `add` will, so a person can read what they installed. A declaration is a dependency, so a line
 * here says what the plugin reaches for and nothing turns on whether anybody reads it.
 */
export function describeUses(uses: Uses): string[] {
  return [
    ...CONTRACTS.flatMap((contract) => contract.summary(uses[contract.key] as never)),
    ...CONTRACTS.flatMap((contract) =>
      contract
        .summary(uses.optional[contract.key] as never)
        .map((line) => `where present, ${line}`),
    ),
  ];
}

/**
 * The capabilities a plugin's built source appears to use, by the grant names in call position or
 * handed over as an argument, as `storeFrom(ctx.onSessionId, null)` does.
 *
 * A textual scan, and deliberately advisory (decisions.md, D16's detection note): a mention in
 * prose that looks like a call counts, and a call through a computed property does not. It exists
 * for the one cost of requiring declarations, which is forgetting one: used but undeclared is a
 * throw that disables the plugin, declared but unused is a stale dependency nobody notices. Both
 * become a line at install. It must never decide whether a plugin loads.
 */
export function capabilityUse(source: string): UsesKey[] {
  return CONTRACTS.filter((contract) =>
    contract.grants.some((grant) => new RegExp(String.raw`\.${grant}\s*[(,)]`).test(source)),
  ).map((contract) => contract.key);
}

/**
 * Where declared switches and the source disagree, in both directions. Boolean keys only, and the
 * required and optional halves are read together: a switch declared on either side is declared, and
 * the scan cannot tell which call site meant which.
 */
export function capabilityDrift(uses: Uses, used: readonly UsesKey[]): string[] {
  return CONTRACTS.flatMap((contract) => {
    const declared = uses[contract.key];
    if (typeof declared !== "boolean") return [];
    const optional = uses.optional[contract.key];
    const isDeclared = declared || optional === true;
    const isUsed = used.includes(contract.key);
    if (isDeclared === isUsed) return [];
    const grant = contract.grants.join("/");
    return isUsed
      ? [
          `calls ${grant}() without declaring "${contract.key}": it will throw and disable the plugin`,
        ]
      : [`declares "${contract.key}" but never calls ${grant}()`];
  });
}

export { patchViolation, sharedFields } from "./rewrites.ts";
export type { CapabilityContract, Declarations, Uses, UsesKey } from "./types.ts";
