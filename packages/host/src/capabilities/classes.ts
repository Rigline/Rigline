import { CONTRACTS } from "@rigline/plugin-api";
import type { CapabilityModule } from "../kernel/types.ts";

/** `ctx.cls(module, local)`: a raw module-scoped class, for UI the anchor table does not curate. */
export const classesModule: CapabilityModule<"classes"> = {
  contract: CONTRACTS.find((c) => c.key === "classes") as CapabilityModule<"classes">["contract"],
  grant({ plugin, kernel }) {
    const declared = pairsOf(plugin.uses.classes);
    return {
      cls(module, local) {
        if (!declared.has(`${module}:${local}`)) {
          throw new Error(
            `cls("${module}", "${local}") was never declared under uses.classes in this plugin's rigline.json`,
          );
        }
        const resolved = kernel.tables.moduleClasses[module]?.[local];
        if (!resolved) throw new Error(`class ${module}.${local} is not in this extension`);
        return resolved;
      },
    };
  },
  grantOptional({ plugin, kernel }) {
    const declared = new Set([
      ...pairsOf(plugin.uses.classes),
      ...pairsOf(plugin.uses.optional.classes),
    ]);
    return {
      cls(module, local) {
        if (!declared.has(`${module}:${local}`)) {
          throw new Error(
            `optional.cls("${module}", "${local}") was never declared under uses.optional.classes in this plugin's rigline.json`,
          );
        }
        return kernel.tables.moduleClasses[module]?.[local] ?? null;
      },
    };
  },
};

/** A declaration's module/local pairs as lookup keys. Pairs, never bare locals: a local name is reused across modules. */
function pairsOf(classes: Readonly<Record<string, readonly string[]>>): Set<string> {
  return new Set(Object.entries(classes).flatMap(([m, locals]) => locals.map((l) => `${m}:${l}`)));
}
