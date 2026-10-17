import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { bundledDir } from "../assets.ts";
import { harvestPanelSession } from "./session.ts";

/** Just enough of a bundle: the footer's props and the session's members, as 2.1.301 spells them. */
const SESSION_BODY = [
  "function dC0({session:$,mode:J,availablePermissionModes:Z,currentSelection:X}){}",
  "class vX{modelSelection=y1(void 0);effortLevel=y1(void 0);claudeConfig=u5(()=>{})",
  "async setModel($){}async setEffortLevel($){}async setThinkingLevel($){}}",
  "VJ.prototype.subscribe=function($){}",
].join(";");

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
    ]) {
      expect(post.includes(name), name).toBe(true);
    }
  });
});

describe("harvestPanelSession", () => {
  for (const version of CORPUS_VERSIONS) {
    it.skipIf(missing(version))(`finds the panel's session surface on ${version}`, () => {
      expect(harvestPanelSession(corpusBundles(version).webview).missing).toEqual([]);
    });
  }

  it("finds nothing missing in a complete fixture", () => {
    expect(harvestPanelSession(SESSION_BODY)).toEqual({ missing: [] });
  });

  it("names a setter that has gone", () => {
    expect(harvestPanelSession(SESSION_BODY.replace("setEffortLevel", "pickEffort"))).toEqual({
      missing: [{ needs: '"async setEffortLevel("', breaks: "no effort could be applied" }],
    });
  });

  it("does not take another component's session prop for the footer's", () => {
    const elsewhere = SESSION_BODY.replace("availablePermissionModes", "permissionModes");
    expect(harvestPanelSession(elsewhere).missing.map((gap) => gap.needs)).toEqual([
      'footer prop "session"',
    ]);
  });
});
