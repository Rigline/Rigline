import { ANCHORS } from "../anchors.ts";
import { type CapabilityContract, isStringArray } from "./types.ts";

/** Curated anchors: names the table promises, resolved per extension version by the installer. */
export const anchorsContract: CapabilityContract<"anchors"> = {
  key: "anchors",
  grants: ["anchor"],
  shape(value) {
    if (!isStringArray(value)) return "must be an array of anchor names";
    const unknown = value.filter((name) => !(name in ANCHORS));
    return unknown.length === 0 ? null : `names anchors that do not exist: ${unknown.join(", ")}`;
  },
  violation(declared, tables) {
    for (const name of declared) {
      if ((tables.anchors[name] ?? null) === null) {
        const spec = ANCHORS[name as keyof typeof ANCHORS];
        const pair = spec ? ` (${spec.module}.${spec.local})` : "";
        return `anchor "${name}"${pair} is not in this extension`;
      }
    }
    return null;
  },
  summary(declared) {
    return declared.map((name) => {
      const spec = ANCHORS[name as keyof typeof ANCHORS];
      const what = spec?.kind === "style" ? "borrows the style of" : "attaches to";
      return `${what} ${name}${spec ? `: ${spec.description.split(". ")[0]}` : ""}`;
    });
  },
};
