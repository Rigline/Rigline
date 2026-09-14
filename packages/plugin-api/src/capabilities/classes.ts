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
  gaps(declared, tables) {
    const gaps: string[] = [];
    for (const [moduleId, locals] of Object.entries(declared)) {
      const known = tables.moduleClasses[moduleId];
      // A module that has gone loses every class in it, so one line for the module beats one per
      // class: the module hash is the identifier a person searches the diff for.
      if (!known) {
        gaps.push(`unknown module "${moduleId}"`);
        continue;
      }
      for (const local of locals) {
        if (!(local in known)) gaps.push(`unknown class ${moduleId}.${local}`);
      }
    }
    return gaps;
  },
  summary(declared) {
    return Object.entries(declared).map(
      ([moduleId, locals]) =>
        `uses raw classes ${locals.map((l) => `${moduleId}.${l}`).join(", ")}`,
    );
  },
};
