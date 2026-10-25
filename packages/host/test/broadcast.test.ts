/**
 * The panels telling each other about a save (D141), between two of them in one process, and the
 * envelope every kind of message shares: Node's own `BroadcastChannel` is the browser's, so what one
 * posts and what the other does with it is the real protocol. Whether a message crosses webviews is
 * the live panel's question, not this file's.
 */
import { type Layout, NO_MODEL_SETTINGS } from "@rigline/plugin-api/internal";
import { afterEach, describe, expect, it } from "vitest";
import type { Diagnostics } from "../src/kernel/bridge.ts";
import { createBroadcast, type Held } from "../src/kernel/broadcast.ts";
import { createPeers, type Peers } from "../src/kernel/peers.ts";
import type { Changed } from "../src/kernel/saving.ts";

const NAME = "rigline-test";
const open: Peers[] = [];
const channels: BroadcastChannel[] = [];

afterEach(() => {
  for (const p of open.splice(0)) p.close();
  for (const c of channels.splice(0)) c.close();
});

function counts(): Diagnostics["broadcast"] {
  return { open: false, posted: 0, heard: 0, types: {}, dropped: 0, lastDrop: null };
}

/** One panel: what it holds, what it was handed, and a clock a test moves. */
function panel(held: Held = { layout: {}, settings: {}, rigline: { model: NO_MODEL_SETTINGS } }) {
  const c = counts();
  const applied: Changed[] = [];
  const failed: string[] = [];
  const clock = { t: 0 };
  const peers = createPeers({ name: NAME, counts: c, fail: (r) => failed.push(r) });
  const b = createBroadcast({ peers, now: () => clock.t });
  b.listen(
    () => held,
    (changed) => applied.push(changed),
  );
  open.push(peers);
  return { b, counts: c, applied, failed, clock, held };
}

/** A raw channel, standing in for something that is not a panel of this version. */
function raw(): BroadcastChannel {
  const c = new BroadcastChannel(NAME);
  channels.push(c);
  return c;
}

const delivered = () => new Promise((r) => setTimeout(r, 20));

describe("a save", () => {
  it("reaches the other panels as it starts and as it settles, and not its own", async () => {
    const a = panel();
    const b = panel();
    a.b.saving({ settings: { clock: { seconds: true } } });
    a.b.saved({ settings: { clock: { seconds: true } } });
    await delivered();
    expect(b.applied).toEqual([
      { settings: { clock: { seconds: true } } },
      { settings: { clock: { seconds: true } } },
    ]);
    expect(a.applied).toEqual([]);
    expect(a.counts).toMatchObject({ open: true, posted: 2, heard: 0 });
    expect(b.counts).toMatchObject({ heard: 2, dropped: 0 });
    expect(b.counts.types).toEqual({
      saving: { posted: 0, heard: 1 },
      saved: { posted: 0, heard: 1 },
    });
  });

  it("posts nothing, and opens nothing, with no name", () => {
    const c = counts();
    const peers = createPeers({ name: null, counts: c, fail: () => {} });
    createBroadcast({ peers }).saving({ layout: {} });
    expect(c).toEqual(counts());
  });

  it("posts nothing that names nothing", async () => {
    const a = panel();
    const b = panel();
    a.b.saved({});
    await delivered();
    expect(a.counts.posted).toBe(0);
    expect(b.applied).toEqual([]);
  });
});

describe("what a panel will not take", () => {
  const envelope = { v: 1, from: "someone", ns: "rigline", type: "saving", body: {} };
  const cases: [string, unknown, string][] = [
    ["a string", "hello", "a message that is not an object"],
    ["a later version", { ...envelope, v: 2 }, "an unknown version"],
    ["no sender", { ...envelope, from: 7 }, "no sender"],
    ["a plugin's namespace", { ...envelope, ns: "clock" }, "an unknown namespace"],
    ["a type it does not handle", { ...envelope, type: "focus" }, "an unknown type"],
    ["a body that is a list", { ...envelope, body: [] }, "a body that is not an object"],
    [
      "a layout that is not one",
      { ...envelope, body: { layout: { rigRow: "clock/face" } } },
      "a layout that does not hold",
    ],
    [
      "a section that is not an object",
      { ...envelope, body: { settings: { clock: 3 } } },
      "settings that do not hold",
    ],
    [
      "a model block that is not one",
      { ...envelope, body: { rigline: { model: { default: 3 } } } },
      "Rigline's model settings that do not hold",
    ],
  ];

  for (const [what, data, reason] of cases) {
    it(`drops ${what}, counts it, and names why`, async () => {
      const b = panel();
      raw().postMessage(data);
      await delivered();
      expect(b.applied).toEqual([]);
      expect(b.counts).toMatchObject({ heard: 0, dropped: 1, lastDrop: reason });
    });
  }

  it("ignores a key it does not know, and takes the rest", async () => {
    const b = panel();
    raw().postMessage({ ...envelope, body: { layout: { off: ["clock/face"] }, later: true } });
    await delivered();
    expect(b.applied).toEqual([{ layout: { off: ["clock/face"] } }]);
  });
});

describe("a value another panel is saving", () => {
  const was: Layout = { rigRow: ["clock/face"] };
  const now: Layout = { off: ["clock/face"] };
  const before: Held = { layout: was, settings: {}, rigline: { model: NO_MODEL_SETTINGS } };

  async function told() {
    const a = panel();
    const b = panel(before);
    a.b.saving({ layout: now });
    await delivered();
    return { a, b };
  }

  it("stands over a read that finds the file not caught up yet", async () => {
    const { b } = await told();
    expect(b.b.seen(before).layout).toEqual(now);
  });

  it("gives way at once to a read that finds anything else, which is a real write", async () => {
    const { b } = await told();
    const third: Layout = { rigRow: [] };
    expect(b.b.seen({ ...before, layout: third }).layout).toEqual(third);
    // And for good: the file has moved on from what this panel was told.
    expect(b.b.seen(before).layout).toEqual(was);
  });

  it("ends once the file holds it", async () => {
    const { b } = await told();
    expect(b.b.seen({ ...before, layout: now }).layout).toEqual(now);
    expect(b.b.seen(before).layout).toEqual(was);
  });

  it("ends when the saver says what the file held, landed or not", async () => {
    const { a, b } = await told();
    a.b.saved({ layout: was });
    await delivered();
    expect(b.applied.at(-1)).toEqual({ layout: was });
    expect(b.b.seen(before).layout).toEqual(was);
  });

  it("expires for a saver that never says, and the next read is the file's", async () => {
    const { b } = await told();
    b.clock.t = 19_999;
    expect(b.b.seen(before).layout).toEqual(now);
    b.clock.t = 20_000;
    expect(b.b.seen(before).layout).toEqual(was);
  });

  it("is held per key, so a section another save did not name reads from the file", async () => {
    const a = panel();
    const held: Held = {
      layout: {},
      settings: { clock: { seconds: false }, other: { x: 1 } },
      rigline: { model: NO_MODEL_SETTINGS },
    };
    const b = panel(held);
    const always = { requireChoice: "always" as const, default: null };
    a.b.saving({ settings: { clock: { seconds: true } }, rigline: { model: always } });
    await delivered();
    const read = b.b.seen({ ...held, settings: { clock: { seconds: false }, other: { x: 2 } } });
    expect(read.settings).toEqual({ clock: { seconds: true }, other: { x: 2 } });
    expect(read.rigline.model).toEqual(always);
  });

  it("takes a section the panel had none of as starting from nothing", async () => {
    const a = panel();
    const b = panel();
    a.b.saving({ settings: { fresh: { on: true } } });
    await delivered();
    expect(b.b.seen(b.held).settings).toEqual({ fresh: { on: true } });
  });
});
