/**
 * The reload offer: when it fires, and that it never fires by itself.
 *
 * The property worth holding above all the others is the negative one. A reload ends the in-flight
 * turn of every Claude session in the window, so an offer that fires on the ordinary weekly update
 * — or on a dismissal, or on a second update after a dismissal — is worse than no offer at all.
 * `reloads` staying empty is the assertion most of these are really making.
 */
import { describe, expect, it } from "vitest";
import { stubEditor } from "../test/editor.ts";
import { reloadOffer, reloadWanted } from "./reload.ts";
import type { Stamps } from "./watch.ts";

const QUIET: Stamps = { bundle: "100:1", host: "200:1", manifest: "10:1" };
const BUNDLE_MOVED: Stamps = { ...QUIET, bundle: "140:2" };
const HOST_MOVED: Stamps = { ...QUIET, host: "200:2" };

describe("reloadWanted", () => {
  it("offers a webview reload when this host started over an unpatched bundle", () => {
    const wanted = reloadWanted({
      reason: "start",
      before: QUIET,
      after: BUNDLE_MOVED,
      active: true,
    });
    expect(wanted).toBe("webviews");
  });

  it("offers a window reload when extension.js moved, which no webview reload can pick up", () => {
    const wanted = reloadWanted({
      reason: "start",
      before: QUIET,
      after: HOST_MOVED,
      active: true,
    });
    expect(wanted).toBe("window");
  });

  it("prefers the window reload when both moved, rather than asking twice", () => {
    const both: Stamps = { ...QUIET, bundle: "140:2", host: "200:2" };
    expect(reloadWanted({ reason: "start", before: QUIET, after: both, active: true })).toBe(
      "window",
    );
  });

  // The whole point of the discriminator (D82): the ordinary weekly update patches a directory
  // this window never loaded, so offering here would be a weekly prompt to end your own turn.
  it("says nothing after a move, however much changed", () => {
    for (const after of [BUNDLE_MOVED, HOST_MOVED]) {
      expect(reloadWanted({ reason: "moved", before: QUIET, after, active: true })).toBeNull();
    }
  });

  it("says nothing when the bytes did not move, which is a healthy install", () => {
    expect(reloadWanted({ reason: "start", before: QUIET, after: QUIET, active: true })).toBeNull();
  });

  // Not a panel-closed test: Claude Code activates at startup regardless, so this is the
  // extension being absent or switched off (D82).
  it("says nothing when the extension is not running", () => {
    const wanted = reloadWanted({
      reason: "start",
      before: QUIET,
      after: BUNDLE_MOVED,
      active: false,
    });
    expect(wanted).toBeNull();
  });
});

describe("reloadOffer", () => {
  it("asks before reloading, as information rather than as a warning", async () => {
    const stub = stubEditor({ answers: [undefined] });
    await reloadOffer(stub.editor).settle("webviews", "1.0.0");

    expect(stub.asked).toHaveLength(1);
    expect(stub.asked[0]?.level).toBe("info");
    expect(stub.asked[0]?.actions).toEqual(["Reload webviews", "Not now"]);
    // The cost is in the message, not only in the tooltip somebody would have to hover for.
    expect(stub.asked[0]?.message).toContain("ends any turn running in this window");
  });

  it("reloads webviews, once, when that is the button pressed", async () => {
    const stub = stubEditor({ answers: ["Reload webviews"] });
    await reloadOffer(stub.editor).settle("webviews", "1.0.0");

    expect(stub.reloads).toEqual(["webviews"]);
    expect(stub.statuses.at(-1)?.health).toBe("ok");
  });

  it("reloads the window, and only the window, for a host patch", async () => {
    const stub = stubEditor({ answers: ["Reload window"] });
    await reloadOffer(stub.editor).settle("window", "1.0.0");

    expect(stub.reloads).toEqual(["window"]);
    expect(stub.asked[0]?.message).toContain("ends every session in this window");
  });

  it("takes no reload when dismissed, and leaves the offer in the status bar", async () => {
    const stub = stubEditor({ answers: [undefined] });
    await reloadOffer(stub.editor).settle("webviews", "1.0.0");

    expect(stub.reloads).toEqual([]);
    expect(stub.statuses.at(-1)?.health).toBe("stale");
    expect(stub.statuses.at(-1)?.text).toBe("Rigline: reload to apply");
  });

  it("re-asks rather than reloading when the status item is clicked", async () => {
    const stub = stubEditor({ answers: [undefined, "Reload webviews"] });
    const offer = reloadOffer(stub.editor);
    await offer.settle("webviews", "1.0.0");
    await offer.again();

    expect(stub.asked).toHaveLength(2);
    expect(stub.reloads).toEqual(["webviews"]);
  });

  it("does nothing when clicked with nothing outstanding", async () => {
    const stub = stubEditor({ answers: ["Reload webviews"] });
    await reloadOffer(stub.editor).again();

    expect(stub.asked).toEqual([]);
    expect(stub.reloads).toEqual([]);
  });

  // A second update does not make the first window any less stale, and `acquireAndInject` paints
  // the status green on its way out. Without this the offer would still stand and nothing would
  // say so.
  it("keeps saying stale when a later run wants no reload of its own", async () => {
    const stub = stubEditor({ answers: [undefined] });
    const offer = reloadOffer(stub.editor);
    await offer.settle("webviews", "1.0.0");
    await offer.settle(null, "1.0.0");

    expect(stub.asked).toHaveLength(1);
    expect(stub.statuses.at(-1)?.health).toBe("stale");
  });

  it("stops saying stale once the reload has been taken", async () => {
    const stub = stubEditor({ answers: ["Reload webviews"] });
    const offer = reloadOffer(stub.editor);
    await offer.settle("webviews", "1.0.0");
    await offer.settle(null, "1.0.0");

    expect(stub.statuses.at(-1)?.health).toBe("ok");
  });
});
