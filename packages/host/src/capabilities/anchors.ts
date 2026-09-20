import { CONTRACTS } from "@rigline/plugin-api";
import type { CapabilityModule } from "../kernel/types.ts";
import { anchorsResolveVerdict } from "../kernel/verdicts.ts";

/** `ctx.anchor(name)` and `ctx.optional.anchor(name)`: the class a curated anchor resolves to. */
export const anchorsModule: CapabilityModule<"anchors"> = {
  contract: CONTRACTS.find((c) => c.key === "anchors") as CapabilityModule<"anchors">["contract"],
  grant({ plugin, kernel }) {
    const declared = new Set(plugin.uses.anchors);
    return {
      anchor(name) {
        if (!declared.has(name)) {
          throw new Error(
            `anchor("${name}") was never declared under uses.anchors in this plugin's rigline.json`,
          );
        }
        const resolved = kernel.tables.anchors[name];
        // The declaration check already refused a plugin whose anchor is missing; this is the
        // version-skew alarm for a registry that outlived its tables.
        if (!resolved) throw new Error(`anchor "${name}" is not in this extension`);
        return resolved;
      },
    };
  },
  grantOptional({ plugin, kernel }) {
    // Either half counts as a declaration. A required anchor read through here simply never
    // returns null, and refusing the call would be a rule with no failure behind it.
    const declared = new Set([...plugin.uses.anchors, ...plugin.uses.optional.anchors]);
    return {
      anchor(name) {
        if (!declared.has(name)) {
          throw new Error(
            `optional.anchor("${name}") was never declared under uses.optional.anchors in this plugin's rigline.json`,
          );
        }
        return kernel.tables.anchors[name] ?? null;
      },
    };
  },
  checks(kernel) {
    return [
      {
        name: "anchors: table resolves against this extension",
        run: () =>
          anchorsResolveVerdict(kernel.tables.anchors, kernel.tables.unresolvedAnchors ?? {}),
      },
    ];
  },
};
