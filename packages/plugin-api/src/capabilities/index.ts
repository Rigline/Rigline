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
  mountContract,
  sessionContract,
  styleContract,
  toolsContract,
  transcriptContract,
} from "./switches.ts";
import type { CapabilityContract, Uses, UsesKey } from "./types.ts";

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
  // Each contract is typed to its own key; the registry erases that once, here, and every walk
  // over it re-narrows by `contract.key`.
] as unknown as readonly CapabilityContract[];

/**
 * The first reason `uses` does not hold against `tables`, or null. Asked in Node before injecting
 * and in the webview before importing a plugin, through this one function.
 */
export function capabilityViolation(uses: Uses, tables: IdentifierTables): string | null {
  for (const contract of CONTRACTS) {
    const violation = contract.violation(uses[contract.key] as never, tables);
    if (violation) return violation;
  }
  return null;
}

/** What a plugin will be able to do, one line each, for the install-time summary. */
export function permissionSummary(uses: Uses): string[] {
  return CONTRACTS.flatMap((contract) => contract.summary(uses[contract.key] as never));
}

/**
 * The capabilities a plugin's built source appears to use, by the grant names in call position.
 *
 * A textual scan, and deliberately advisory (decisions.md, D16's detection note): a mention in
 * prose that looks like a call counts, and a call through a computed property does not. It exists
 * for the one cost of requiring declarations, which is forgetting one: used but undeclared is a
 * throw that disables the plugin, declared but unused is a stale dependency nobody notices. Both
 * become a line at install. It must never decide whether a plugin loads.
 */
export function capabilityUse(source: string): UsesKey[] {
  return CONTRACTS.filter((contract) =>
    contract.grants.some((grant) => new RegExp(String.raw`\.${grant}\s*\(`).test(source)),
  ).map((contract) => contract.key);
}

/** Where declared switches and the source disagree, in both directions. Boolean keys only. */
export function capabilityDrift(uses: Uses, used: readonly UsesKey[]): string[] {
  return CONTRACTS.flatMap((contract) => {
    const declared = uses[contract.key];
    if (typeof declared !== "boolean") return [];
    const isUsed = used.includes(contract.key);
    if (declared === isUsed) return [];
    const grant = contract.grants.join("/");
    return isUsed
      ? [
          `calls ${grant}() without declaring "${contract.key}": it will throw and disable the plugin`,
        ]
      : [`declares "${contract.key}" but never calls ${grant}()`];
  });
}

export { patchViolation, sharedFields } from "./rewrites.ts";
export type { CapabilityContract, Uses, UsesKey } from "./types.ts";
