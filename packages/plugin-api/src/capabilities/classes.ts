import { type CapabilityContract, isRecordOfStringArrays } from "./types.ts";

/** Raw module-scoped classes: the escape hatch for UI the anchor table does not curate. */
export const classesContract: CapabilityContract<"classes"> = {
  key: "classes",
  grants: ["cls"],
  shape(value) {
    return isRecordOfStringArrays(value)
      ? null
      : "must map a six-character module hash to an array of local class names";
  },
  violation(declared, tables) {
    for (const [moduleId, locals] of Object.entries(declared)) {
      const known = tables.moduleClasses[moduleId];
      if (!known) return `unknown module "${moduleId}"`;
      for (const local of locals) {
        if (!(local in known)) return `unknown class ${moduleId}.${local}`;
      }
    }
    return null;
  },
  summary(declared) {
    return Object.entries(declared).map(
      ([moduleId, locals]) =>
        `uses raw classes ${locals.map((l) => `${moduleId}.${l}`).join(", ")}`,
    );
  },
};
