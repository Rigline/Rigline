import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { bundledDir } from "../assets.ts";
import { harvestPanelSession } from "./session.ts";

/** Just enough of a bundle: the footer's props and the session's members, as 2.1.310 spells them. */
const SESSION_BODY = [
  "function dC0({session:$,mode:J,availablePermissionModes:Z,currentSelection:X}){}",
  "class vX{modelSelection=y1(void 0);effortLevel=y1(void 0);claudeConfig=u5(()=>{})",
  "selection=y1(void 0);dismissedSelection;lastSentSelection",
  "applySelectionUpdate($){this.dismissedSelection=void 0,this.selection.value=$}",
  "dismissSelection(){this.dismissedSelection=this.selection.value,this.selection.value=void 0}",
  "send(){this.lastSentSelection=q}",
  "async setModel($){}async setEffortLevel($){}async setThinkingLevel($){}}",
  "VJ.prototype.subscribe=function($){}",
].join(";");

/** The first version whose panel has the dismissal behind its chip. */
const FIRST_DISMISSAL = "2.1.269";

describe("the host's own spelling", () => {
  it("names every member this layer asserts, in the post.js a user's install carries", () => {
    const post = readFileSync(join(bundledDir(), "post.js"), "utf8");
    for (const name of [
      "session",
      "setModel",
      "setEffortLevel",
      "setThinkingLevel",
      "modelSelection",
      "effortLevel",
      "claudeConfig",
      "subscribe",
      "selection",
      "dismissSelection",
      "dismissedSelection",
      "applySelectionUpdate",
      "lastSentSelection",
    ]) {
      expect(post.includes(name), name).toBe(true);
    }
  });
});

describe("harvestPanelSession", () => {
  for (const version of CORPUS_VERSIONS) {
    it.skipIf(missing(version))(`finds the panel's session surface on ${version}`, () => {
      const gaps = harvestPanelSession(corpusBundles(version).webview).missing;
      expect(gaps.filter((gap) => gap.refuses.includes("models"))).toEqual([]);
      const editor = gaps.filter((gap) => gap.refuses.includes("editorContext"));
      if (version.localeCompare(FIRST_DISMISSAL, "en", { numeric: true }) >= 0) {
        expect(editor).toEqual([]);
      } else {
        expect(editor.map((gap) => gap.needs)).toEqual([
          '"dismissSelection(){"',
          '"this.dismissedSelection=this.selection.value"',
        ]);
      }
    });
  }

  it("finds nothing missing in a complete fixture", () => {
    expect(harvestPanelSession(SESSION_BODY)).toEqual({ missing: [] });
  });

  it("names a setter that has gone, refusing the model capabilities alone", () => {
    expect(harvestPanelSession(SESSION_BODY.replace("setEffortLevel", "pickEffort"))).toEqual({
      missing: [
        {
          needs: '"async setEffortLevel("',
          breaks: "no effort could be applied",
          refuses: ["models"],
        },
      ],
    });
  });

  it("names a selection member that has gone, refusing the editor context alone", () => {
    expect(
      harvestPanelSession(SESSION_BODY.replace("send(){this.lastSentSelection", "send(){q")),
    ).toEqual({
      missing: [
        {
          needs: '"this.lastSentSelection="',
          breaks: "a ticked editor context could not be told apart from one already sent",
          refuses: ["editorContext"],
        },
      ],
    });
  });

  it("refuses both features where the footer hands over no session", () => {
    const elsewhere = SESSION_BODY.replace("availablePermissionModes", "permissionModes");
    expect(harvestPanelSession(elsewhere).missing.map((gap) => gap.refuses)).toEqual([
      ["models", "editorContext"],
    ]);
  });

  it("does not take another component's session prop for the footer's", () => {
    const elsewhere = SESSION_BODY.replace("availablePermissionModes", "permissionModes");
    expect(harvestPanelSession(elsewhere).missing.map((gap) => gap.needs)).toEqual([
      'footer prop "session"',
    ]);
  });
});
