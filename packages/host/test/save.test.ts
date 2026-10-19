/**
 * The settings saver the shell provides around each contribution (D138): what it stamps, what it
 * refuses, and what travels in the link. Then the layout's Save link, which refuses alike.
 */
import {
  COMPANION,
  decodeSettingsPayload,
  MAX_SAVE_PAYLOAD,
  MAX_SETTINGS_PAYLOAD,
  NO_TOKEN,
  type SaveRecord,
} from "@rigline/plugin-api/internal";
import { describe, expect, it } from "vitest";
import { maySaveSection, settingsSaver } from "../src/kernel/save.ts";
import { saveLink } from "../src/shell/layout.tsx";

const save: SaveRecord = { token: "a".repeat(32), scheme: "vscode" };
const baked: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  clock: { tick: 1 },
  other: { x: 9 },
};
const savedOf = (section: string) => baked[section] ?? {};

/** A saver for `plugin` over `record`, which hears nothing a link is followed. */
function saverFor(record: SaveRecord | null, plugin: string) {
  return settingsSaver(record, savedOf, plugin, () => {});
}

/** The payload a link carries, decoded back. */
function payloadOf(href: string) {
  const encoded = new URL(href).searchParams.get("p") ?? "";
  const decoded = decodeSettingsPayload(encoded);
  if ("problem" in decoded) throw new Error(decoded.problem);
  return decoded.payload;
}

function linkOf(saver: ReturnType<typeof saverFor>, value: Record<string, unknown>) {
  const link = saver.link(value);
  if ("refused" in link) throw new Error(`refused: ${link.refused}`);
  return link.href;
}

describe("maySaveSection", () => {
  it("allows a plugin its own section and nobody else's", () => {
    expect(maySaveSection("clock", "clock")).toBe(true);
    expect(maySaveSection("clock", "other")).toBe(false);
    expect(maySaveSection("clock", "rigline")).toBe(false);
  });
});

describe("settingsSaver", () => {
  it("names the companion and carries only the saving plugin's section", () => {
    const href = linkOf(saverFor(save, "clock"), { tick: 2 });

    expect(href.startsWith(`vscode://${COMPANION}/settings?p=`)).toBe(true);
    // Only `clock`: a payload carrying every section would push this panel's stale copy of the
    // others into the file.
    expect(payloadOf(href).sections).toEqual({ clock: { from: { tick: 1 }, to: { tick: 2 } } });
  });

  it("sends the saved section as the baseline, so the engine can see a change under it", () => {
    const href = linkOf(saverFor(save, "clock"), { tick: 2 });
    expect(payloadOf(href).sections.clock?.from).toEqual(baked.clock);
  });

  it("treats a plugin with no baked section as having started from nothing", () => {
    const href = linkOf(saverFor(save, "fresh"), { on: true });
    expect(payloadOf(href).sections).toEqual({ fresh: { from: {}, to: { on: true } } });
  });

  it("stamps the plugin's own section when none is named", () => {
    expect(saverFor(save, "clock").plugin).toBe("clock");
    const href = linkOf(saverFor(save, "clock"), { tick: 2 });
    expect(Object.keys(payloadOf(href).sections)).toEqual(["clock"]);
  });

  it("hears the link followed, with the section it stamped", () => {
    const heard: [string, unknown][] = [];
    const saver = settingsSaver(save, savedOf, "clock", (section, value) =>
      heard.push([section, value]),
    );
    saver.followed?.({ tick: 2 });
    expect(heard).toEqual([["clock", { tick: 2 }]]);
  });

  it("refuses another plugin's section, by name", () => {
    const link = saverFor(save, "clock").link({ x: 1 }, "other");
    expect(link).toEqual({ refused: "clock may not save other's settings" });
  });

  it("allows a section named explicitly when it is the plugin's own", () => {
    const href = saverFor(save, "clock").link({ tick: 3 }, "clock");
    expect("href" in href).toBe(true);
  });

  it.each([
    [{ token: null, scheme: "vscode" }, /no token for this machine/],
    [null, /no token for this machine/],
  ])("refuses and says why when there is no route: %o", (record, reason) => {
    const link = saverFor(record, "clock").link({ tick: 2 });
    expect("refused" in link && reason.test(link.refused)).toBe(true);
  });

  it("refuses a section too large for a link rather than handing over one that fails", () => {
    // The bake allows sixteen times what a link carries, so a plugin can hold more than it can save
    // back from the panel. Saying so here is the whole point: the engine's refusal arrives after
    // the person has done the work.
    const link = saverFor(save, "clock").link({
      blob: "x".repeat(MAX_SETTINGS_PAYLOAD),
    });
    expect("refused" in link).toBe(true);
    expect("refused" in link && link.refused).toMatch(/too large to save from the panel/);
  });
});

// The layout's Save refuses as the settings screen's does, and never offers a fallback (D143).
describe("saveLink", () => {
  const from = { rigRow: ["clock/face"] };

  it("links to the companion with the copy where there is a token", () => {
    const link = saveLink(save, from, { off: ["clock/face"] });
    expect("href" in link && link.href).toMatch(
      new RegExp(`^vscode://${COMPANION.replace(".", "\\.")}/layout\\?p=`),
    );
  });

  it("is refused, saying why, with no token or a copy too large for a link", () => {
    expect(saveLink(null, from, {})).toEqual({ refused: NO_TOKEN });
    expect(saveLink({ ...save, token: null }, from, {})).toEqual({ refused: NO_TOKEN });
    const many = { rigRow: Array.from({ length: 2000 }, (_, i) => `plugin/element-${i}`) };
    const link = saveLink(save, from, many);
    expect("refused" in link && link.refused).toMatch(
      new RegExp(
        `^this layout is too large to save from the panel: \\d+ characters, over the ${MAX_SAVE_PAYLOAD}`,
      ),
    );
  });
});
