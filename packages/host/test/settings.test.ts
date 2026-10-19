/**
 * The settings screen's editor: drafts per tab against what is saved, the one merged Save, the
 * confirmation it shares with the layout editor, and what a plugin's `onSettings` hears. The re-read
 * and the wait are injected, so a confirmation costs nothing here.
 */
import {
  decodeSettingsPayload,
  MAX_SETTINGS_PAYLOAD,
  NO_MODEL_SETTINGS,
  type RiglineSettings,
  type SaveRecord,
} from "@rigline/plugin-api/internal";
import { describe, expect, it } from "vitest";
import type { Changed, SavedState } from "../src/kernel/saving.ts";
import { createSettingsEditor } from "../src/kernel/settings.ts";

type Sections = Record<string, Record<string, unknown>>;

const save: SaveRecord = { token: "a".repeat(32), scheme: "vscode" };
const OFF: RiglineSettings = { model: NO_MODEL_SETTINGS };
const ALWAYS: RiglineSettings = { model: { requireChoice: "always", default: null } };

/** An editor over `sections` and `rigline`, whose re-read finds whatever `file` holds then. */
function editor(sections: Sections = {}, rigline: RiglineSettings = OFF, record = save) {
  const file: { sections: Sections; rigline: RiglineSettings } = { sections, rigline };
  let reads = 0;
  const read = (): SavedState => ({
    layout: {},
    presets: [],
    omitted: 0,
    settings: file.sections,
    rigline: file.rigline,
  });
  const made = createSettingsEditor({
    save: record,
    sections,
    rigline,
    readSaved: async () => {
      reads++;
      return read();
    },
    wait: async () => {},
  });
  return { e: made, file, read, reads: () => reads };
}

function payloadOf(link: ReturnType<ReturnType<typeof createSettingsEditor>["link"]>) {
  if ("refused" in link) throw new Error(`refused: ${link.refused}`);
  const decoded = decodeSettingsPayload(new URL(link.href).searchParams.get("p") ?? "");
  if ("problem" in decoded) throw new Error(decoded.problem);
  return decoded.payload;
}

describe("a draft", () => {
  it("shows what is saved until a tab changes it, and goes once it matches again", () => {
    const { e } = editor({ clock: { tick: 1 } });
    expect(e.value("clock")).toEqual({ tick: 1 });
    expect(e.value("fresh")).toEqual({});

    e.set("clock", { tick: 2 });
    expect(e.value("clock")).toEqual({ tick: 2 });
    expect(e.drafts.get().get("clock")).toEqual({ from: { tick: 1 }, to: { tick: 2 } });

    e.set("clock", { tick: 1 });
    expect(e.drafts.get().size).toBe(0);
  });

  it("is frozen and holds no reference into what the tab passed", () => {
    const { e } = editor();
    const passed = { list: ["a"] };
    e.set("clock", passed);
    passed.list.push("b");
    expect(e.value("clock")).toEqual({ list: ["a"] });
    expect(Object.isFrozen(e.value("clock").list)).toBe(true);
  });

  it("keeps what it started from when the file moves under it, and a clean tab follows the file", () => {
    const { e, file, read } = editor({ clock: { tick: 1 }, other: { x: 1 } });
    e.set("clock", { tick: 2 });
    file.sections = { clock: { tick: 5 }, other: { x: 9 } };
    e.observe(read());

    expect(e.value("other")).toEqual({ x: 9 });
    expect(e.value("clock")).toEqual({ tick: 2 });
    expect(e.drafts.get().get("clock")?.from).toEqual({ tick: 1 });
  });

  it("is dropped by Revert, which reads the file afresh", async () => {
    const { e, file, reads } = editor({ clock: { tick: 1 } });
    e.set("clock", { tick: 2 });
    e.set("rigline", { ...ALWAYS });
    file.sections = { clock: { tick: 3 } };
    await e.revert();
    expect(reads()).toBe(1);
    expect(e.drafts.get().size).toBe(0);
  });

  it("goes with its tab", () => {
    const { e } = editor();
    e.set("clock", { tick: 2 });
    e.forget("clock");
    expect(e.drafts.get().size).toBe(0);
  });
});

describe("Save", () => {
  it("carries every dirty tab, each stamped with its owner, and Rigline's own beside them", () => {
    const { e } = editor({ clock: { tick: 1 }, quiet: { y: 1 } });
    e.set("clock", { tick: 2 });
    e.set("rigline", { ...ALWAYS });

    const payload = payloadOf(e.link());
    // Only what changed: `quiet` is this panel's copy, and might be stale.
    expect(payload.sections).toEqual({ clock: { from: { tick: 1 }, to: { tick: 2 } } });
    expect(payload.rigline).toEqual({ from: OFF, to: ALWAYS });
  });

  it("spends the link's budget across every tab, and says why when the whole will not fit", () => {
    const { e } = editor();
    const half = "x".repeat(MAX_SETTINGS_PAYLOAD / 2);
    e.set("one", { blob: half });
    expect("href" in e.link()).toBe(true);
    e.set("two", { blob: half });
    const link = e.link();
    expect("refused" in link && link.refused).toMatch(/too large to save from the panel/);
  });

  it("says when a tab's saved settings could not be written back from here", () => {
    const { e } = editor({ bulk: { blob: "x".repeat(MAX_SETTINGS_PAYLOAD) }, small: { a: 1 } });
    expect(e.unsaveable("bulk")).toMatch(/too large/);
    expect(e.unsaveable("small")).toBeNull();
    expect(e.unsaveable("rigline")).toBeNull();
  });

  // A companion is required, so nothing is baked about one and the link is offered (D143).
  it("says there is no route only where there is no token", () => {
    const { e } = editor({}, OFF, { ...save, token: null });
    e.set("clock", { tick: 2 });
    const link = e.link();
    expect("refused" in link && link.refused).toMatch(/no token for this machine/);
  });
});

describe("confirming a save", () => {
  it("drops the drafts once the file holds them, and publishes what it holds", async () => {
    const { e, file } = editor({ clock: { tick: 1 } });
    e.set("clock", { tick: 2 });
    e.set("rigline", { ...ALWAYS });
    const sent = new Map([...e.drafts.get()].map(([owner, d]) => [owner, d.to]));
    file.sections = { clock: { tick: 2 } };
    file.rigline = ALWAYS;

    await e.confirm(sent);
    expect(e.drafts.get().size).toBe(0);
    expect(e.savedOf("clock")).toEqual({ tick: 2 });
    expect(e.saved.get().rigline).toEqual(ALWAYS);
    expect(e.saving.get()).toBe("idle");
  });

  it("keeps a draft edited since the click, now over what the click saved", async () => {
    const { e, file } = editor({ clock: { tick: 1 } });
    e.set("clock", { tick: 2 });
    const sent = new Map([["clock", { tick: 2 }]]);
    e.set("clock", { tick: 3 });
    file.sections = { clock: { tick: 2 } };

    await e.confirm(sent);
    expect(e.drafts.get().get("clock")).toEqual({ from: { tick: 2 }, to: { tick: 3 } });
  });

  it("says it could not confirm when the file never holds the save", async () => {
    const { e } = editor({ clock: { tick: 1 } });
    e.set("clock", { tick: 2 });
    await e.confirm(new Map([["clock", { tick: 2 }]]));
    expect(e.saving.get()).toBe("unconfirmed");
    expect(e.drafts.get().size).toBe(1);
  });
});

describe("telling the other panels (D141)", () => {
  it("says only the sections and blocks a save wrote, and then what the file held of them", async () => {
    const said: [string, Changed][] = [];
    const file = { sections: { clock: { tick: 1 }, quiet: { y: 1 } } as Sections, rigline: OFF };
    const e = createSettingsEditor({
      save,
      sections: file.sections,
      rigline: OFF,
      readSaved: async () => ({
        layout: {},
        presets: [],
        omitted: 0,
        settings: file.sections,
        rigline: file.rigline,
      }),
      announce: {
        saving: (changed) => said.push(["saving", changed]),
        saved: (changed) => said.push(["saved", changed]),
      },
      wait: async () => {},
    });
    e.set("clock", { tick: 2 });
    e.set("rigline", { ...ALWAYS });
    const sent = new Map([...e.drafts.get()].map(([owner, d]) => [owner, d.to]));

    // Never lands: the file still holds what it did, and the other panels are told so.
    await e.confirm(sent);
    expect(said).toEqual([
      ["saving", { settings: { clock: { tick: 2 } }, rigline: ALWAYS }],
      ["saved", { settings: { clock: { tick: 1 } }, rigline: OFF }],
    ]);
  });
});

describe("what a plugin hears", () => {
  it("is its own section now, and again only when it changes", () => {
    const { e, file, read } = editor({ clock: { tick: 1 }, other: { x: 1 } });
    const heard: unknown[] = [];
    e.subscribe("clock", (section) => heard.push(section));
    expect(heard).toEqual([{ tick: 1 }]);

    file.sections = { clock: { tick: 1 }, other: { x: 2 } };
    e.observe(read());
    expect(heard).toHaveLength(1);

    file.sections = { clock: { tick: 2 }, other: { x: 2 } };
    e.observe(read());
    expect(heard).toEqual([{ tick: 1 }, { tick: 2 }]);
    expect(Object.isFrozen(heard[1])).toBe(true);
  });

  it("is never a draft", () => {
    const { e } = editor({ clock: { tick: 1 } });
    const heard: unknown[] = [];
    e.subscribe("clock", (section) => heard.push(section));
    e.set("clock", { tick: 2 });
    expect(heard).toEqual([{ tick: 1 }]);
  });

  it("does not republish a read that says what was saved already", () => {
    const { e, read } = editor({ clock: { tick: 1 } });
    const before = e.saved.get();
    e.observe(read());
    expect(e.saved.get()).toBe(before);
  });
});
