import { ANCHOR_NAMES, ANCHORS } from "../anchors.ts";
import { type CapabilityContract, isStringArray } from "./types.ts";

/** Curated anchors: names the table promises, resolved per extension version by the installer. */
export const anchorsContract: CapabilityContract<"anchors"> = {
  key: "anchors",
  grants: ["anchor"],
  /**
   * The enum is the curated vocabulary, and it is deliberately the stricter of the two statements
   * of this rule: an install can also honour a name `~/.rigline/anchors.json` adds, which the
   * schema cannot know about. It is read while authoring, where the curated set is the right
   * answer and a misspelling is the likely mistake; an install never refuses on the schema.
   */
  schema: {
    type: "array",
    description: "Curated anchor names, resolved through ctx.anchor().",
    items: { enum: [...ANCHOR_NAMES] },
  },
  /**
   * Shape only, and deliberately not the names.
   *
   * This used to refuse any name outside `ANCHORS`, which stopped being true the moment the table
   * became locally extensible: `~/.rigline/anchors.json` may add one, so the table compiled into
   * this package is no longer the set of names an install can honour (D44). A check that asks the
   * wrong authority gets the wrong answer, and gets it at the loudest severity there is, because a
   * shape problem fails the whole install rather than refusing one plugin. `gaps` asks the
   * installed tables instead, and the JSON schema keeps its enum of curated names for the editor,
   * which is where a typo is made.
   */
  shape(value) {
    return isStringArray(value) ? null : "must be an array of anchor names";
  },
  gaps(declared, tables) {
    const gaps: string[] = [];
    for (const name of declared) {
      if (name in tables.anchors && tables.anchors[name] !== null) continue;
      if (!(name in tables.anchors)) {
        // Not in the table at all, as against in it and unresolved: a misspelling, or a name from
        // an anchors.json this machine has not got. Saying "is not in this extension" would send
        // an author looking at the extension for a mistake that is in their manifest.
        gaps.push(`anchor "${name}" is not a name the anchor table has`);
        continue;
      }
      const spec = ANCHORS[name as keyof typeof ANCHORS];
      const pair = spec ? ` (${spec.module}.${spec.local})` : "";
      // Resolution already wrote down why, and it is not always absence: an anchor naming one
      // element whose class this version applies to several is refused too, and telling an
      // author it "is not in this extension" would send them looking for the wrong thing.
      gaps.push(
        tables.unresolvedAnchors?.[name] ?? `anchor "${name}"${pair} is not in this extension`,
      );
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
