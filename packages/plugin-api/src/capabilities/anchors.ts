import { ANCHOR_NAMES, ANCHORS } from "../anchors.ts";
import { type CapabilityContract, isStringArray } from "./types.ts";

/** Curated anchors: names the table promises, resolved per extension version by the installer. */
export const anchorsContract: CapabilityContract<"anchors"> = {
  key: "anchors",
  grants: ["anchor"],
  schema: {
    type: "array",
    description: "Curated anchor names, resolved through ctx.anchor().",
    items: { enum: [...ANCHOR_NAMES] },
  },
  shape(value) {
    if (!isStringArray(value)) return "must be an array of anchor names";
    const unknown = value.filter((name) => !(name in ANCHORS));
    return unknown.length === 0 ? null : `names anchors that do not exist: ${unknown.join(", ")}`;
  },
  gaps(declared, tables) {
    const gaps: string[] = [];
    for (const name of declared) {
      if ((tables.anchors[name] ?? null) === null) {
        const spec = ANCHORS[name as keyof typeof ANCHORS];
        const pair = spec ? ` (${spec.module}.${spec.local})` : "";
        // Resolution already wrote down why, and it is not always absence: an anchor naming one
        // element whose class this version applies to several is refused too, and telling an
        // author it "is not in this extension" would send them looking for the wrong thing.
        gaps.push(
          tables.unresolvedAnchors?.[name] ?? `anchor "${name}"${pair} is not in this extension`,
        );
      }
    }
    return gaps;
  },
  /**
   * Two lines at most, grouped by what the plugin does with the anchor, and no descriptions.
   *
   * One line per anchor carrying the table's own prose reads as ten near-identical sentences for a
   * plugin borrowing a pop-up's look, and buries the one or two lines that say where it will
   * actually appear. The name is the useful half — a reader wanting to know what `footerSpacer` is
   * has the anchor table, which is where that sentence lives and stays current.
   */
  summary(declared) {
    const borrowed: string[] = [];
    const attached: string[] = [];
    for (const name of declared) {
      const spec = ANCHORS[name as keyof typeof ANCHORS];
      (spec?.kind === "style" ? borrowed : attached).push(name);
    }
    const lines: string[] = [];
    if (attached.length > 0) lines.push(`attaches to ${attached.join(", ")}`);
    if (borrowed.length > 0) lines.push(`borrows the style of ${borrowed.join(", ")}`);
    return lines;
  },
};
