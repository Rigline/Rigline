import { CONTRACTS } from "@prototype/plugin-api";
import type { CapabilityModule } from "../kernel/types.ts";

/** `ctx.cls(module, local)`: a raw module-scoped class, for UI the anchor table does not curate. */
export const classesModule: CapabilityModule<"classes"> = {
  contract: CONTRACTS.find((c) => c.key === "classes") as CapabilityModule<"classes">["contract"],
  grant({ plugin, kernel }) {
    const declared = new Set(
      Object.entries(plugin.uses.classes).flatMap(([m, locals]) => locals.map((l) => `${m}:${l}`)),
    );
    return {
      cls(module, local) {
        if (!declared.has(`${module}:${local}`)) {
          throw new Error(
            `cls("${module}", "${local}") was never declared under uses.classes in this plugin's prototype.json`,
          );
        }
        const resolved = kernel.tables.moduleClasses[module]?.[local];
        if (!resolved) throw new Error(`class ${module}.${local} is not in this extension`);
        return resolved;
      },
    };
  },
};
