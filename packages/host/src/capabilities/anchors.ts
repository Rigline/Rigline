import { CONTRACTS } from "@prototype/plugin-api";
import type { CapabilityModule } from "../kernel/types.ts";

/** `ctx.anchor(name)`: the class a curated anchor resolves to in this extension. */
export const anchorsModule: CapabilityModule<"anchors"> = {
  contract: CONTRACTS.find((c) => c.key === "anchors") as CapabilityModule<"anchors">["contract"],
  grant({ plugin, kernel }) {
    const declared = new Set(plugin.uses.anchors);
    return {
      anchor(name) {
        if (!declared.has(name)) {
          throw new Error(
            `anchor("${name}") was never declared under uses.anchors in this plugin's prototype.json`,
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
};
