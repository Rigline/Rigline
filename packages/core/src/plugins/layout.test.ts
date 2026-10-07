import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Elements, EMPTY_USES } from "@rigline/plugin-api/internal";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";
import type { DiscoveredPlugin } from "./discover.ts";
import {
  formatLayout,
  orderInLayout,
  parseWhere,
  placeInLayout,
  resetLayout,
  viewLayout,
} from "./layout.ts";

const dirs: string[] = [];

function configFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-layout-"));
  dirs.push(dir);
  const path = join(dir, "config.yaml");
  writeFileSync(path, text);
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const spacer = { anchor: "footerSpacer", at: "before" } as const;

function plugin(name: string, elements: Elements): DiscoveredPlugin {
  return {
    name,
    dir: name,
    root: "",
    overridesBundled: false,
    manifest: {
      api: 1,
      name,
      description: null,
      entry: "index.js",
      surfaces: ["editor", "sidebar"],
      uses: EMPTY_USES,
      elements,
      patches: [],
    },
  };
}

const sessionId = plugin("session-id", {
  "short-id": { title: "Session id", placements: [spacer, "rigRow"], default: spacer },
  "full-id": { title: "Full session id", placements: ["rigRow"], default: null },
  address: { title: "Messaging address", placements: ["rigRow"], default: null },
});
const clock = plugin("clock", {
  face: { title: "Clock", placements: ["rigRow"], default: "rigRow" },
});
const plugins = [sessionId, clock];

describe("viewLayout", () => {
  it("groups every element by place, zones first and off last, each place in the panel's order", () => {
    const config = readConfig(
      configFile("layout:\n  rigRow: [session-id/address]\n  off: [session-id/short-id]\n"),
    );
    const text = formatLayout(viewLayout(plugins, config));
    expect(text.split("\n")).toEqual([
      "rigRow",
      "  session-id/address   Messaging address  yours; can also go in rigRow right or in rigRow 2",
      "  clock/face           Clock              can also go in rigRow right or in rigRow 2",
      "  rigline/edit         Edit button        can also go in rigRow right, in rigRow 2 or before footerSpacer",
      "off",
      "  session-id/short-id  Session id         yours; can also go before footerSpacer, in rigRow or in rigRow 2",
      "  session-id/full-id   Full session id    can also go in rigRow or in rigRow 2",
      "  rigline/reload       Reload button      can also go in rigRow, in rigRow 2 or before footerSpacer",
    ]);
  });

  it("shows rows in number order, each element offered the rest", () => {
    const config = readConfig(
      configFile(
        "layout:\n  rigRow 3: [session-id/address]\n  rigRow: [clock/face]\n  rigRow 2: [session-id/full-id]\n",
      ),
    );
    const view = viewLayout(plugins, config);
    expect(view.places.map((p) => p.place)).toEqual([
      "rigRow",
      "rigRow 2",
      "rigRow 3",
      "before footerSpacer",
      "off",
    ]);
    expect(view.places[2]?.elements[0]?.also).toEqual(["rigRow 3 right", "rigRow", "rigRow 2"]);
    expect(view.problems).toEqual([]);
  });

  it("puts a row's right side after its left, and names the side in what else may go there", () => {
    const config = readConfig(
      configFile("layout:\n  rigRow right: [session-id/address]\n  rigRow: [session-id/full-id]\n"),
    );
    const text = formatLayout(viewLayout(plugins, config));
    expect(text.split("\n").slice(0, 6)).toEqual([
      "rigRow",
      "  session-id/full-id   Full session id    yours; can also go in rigRow right or in rigRow 2",
      "  clock/face           Clock              can also go in rigRow right or in rigRow 2",
      "  rigline/edit         Edit button        can also go in rigRow right, in rigRow 2 or before footerSpacer",
      "rigRow right",
      "  session-id/address   Messaging address  yours; can also go in rigRow or in rigRow 2 right",
    ]);
  });

  it("names what does not resolve, as install does", () => {
    const config = readConfig(configFile("layout:\n  rigRow: [gone/away]\n"));
    expect(viewLayout(plugins, config).problems).toEqual([
      `${config.path}: gone/away: no plugin "gone" is installed`,
    ]);
  });
});

describe("parseWhere", () => {
  it("reads a place as the file spells it, over one word or two", () => {
    expect(parseWhere(["rigRow"], false)).toBe("rigRow");
    expect(parseWhere(["before", "footerSpacer"], false)).toEqual(spacer);
    expect(parseWhere(["off"], false)).toBeNull();
    expect(parseWhere(["default"], true)).toBe("default");
  });

  it("refuses what is not a place, offering default only where the command takes it", () => {
    expect(() => parseWhere(["rigrow"], true)).toThrow(
      '"rigrow" is not a place: a place is rigRow, rigRow 2 and on, rigRow right, rigRow 2 right and on, before, after or inside an anchor, off, or default',
    );
    expect(() => parseWhere(["rigrow"], false)).toThrow(
      '"rigrow" is not a place: a place is rigRow, rigRow 2 and on, rigRow right, rigRow 2 right and on, before, after or inside an anchor, or off',
    );
    expect(() => parseWhere(["rigRow", "1"], false)).toThrow(
      '"rigRow 1" is not a place: the first row is rigRow, then rigRow 2',
    );
    expect(() => parseWhere(["rigRow", "2", "left"], false)).toThrow(
      '"rigRow 2 left" is not a place: a row\'s left side is the row itself, rigRow 2, and its right side is rigRow 2 right',
    );
    expect(() => parseWhere([], true)).toThrow(/a place is needed: .*, off, or default$/);
    expect(() => parseWhere([], false)).toThrow(/a place is needed: .*, or off$/);
    expect(() => parseWhere(["default"], false)).toThrow(/default is not a place to fill/);
  });
});

describe("placeInLayout", () => {
  it("puts an element in a later row, which any element offering rigRow may take", () => {
    const path = configFile("disabled: []\n");
    placeInLayout(path, plugins, "session-id/address", parseWhere(["rigRow", "2"], true));
    orderInLayout(path, plugins, parseWhere(["rigRow", "3"], false), ["clock/face"]);
    expect(readConfig(path).layout).toEqual({
      "rigRow 2": ["session-id/address"],
      "rigRow 3": ["clock/face"],
    });
  });

  it("puts an element on a row's right side, over three words", () => {
    const path = configFile("disabled: []\n");
    placeInLayout(path, plugins, "clock/face", parseWhere(["rigRow", "right"], true));
    orderInLayout(path, plugins, parseWhere(["rigRow", "2", "right"], false), [
      "session-id/address",
    ]);
    expect(readFileSync(path, "utf8")).toBe(
      "disabled: []\nlayout:\n  rigRow right:\n    - clock/face\n  rigRow 2 right:\n    - session-id/address\n",
    );
  });

  it("adds an element to the end of a place, leaving the rest of the file as it was", () => {
    const path = configFile("# mine\ndisabled: [probe] # slow\nlayout:\n  rigRow: [clock/face]\n");

    const result = placeInLayout(path, plugins, "session-id/address", "rigRow");

    expect(result).toEqual({ changed: true, placement: "rigRow", isDefault: false });
    expect(readFileSync(path, "utf8")).toBe(
      "# mine\ndisabled: [probe] # slow\nlayout:\n  rigRow: [clock/face, session-id/address]\n",
    );
  });

  it("takes it out of any other place, and drops a place and a layout it leaves empty", () => {
    const path = configFile("layout:\n  off:\n    - session-id/short-id\n");

    placeInLayout(path, plugins, "session-id/short-id", "rigRow");
    expect(readConfig(path).layout).toEqual({ rigRow: ["session-id/short-id"] });

    placeInLayout(path, plugins, "session-id/short-id", "default");
    expect(readFileSync(path, "utf8")).toBe("");
  });

  it("places Rigline's own elements, which no plugin declares", () => {
    const path = configFile("");
    placeInLayout(path, plugins, "rigline/edit", { anchor: "footerSpacer", at: "before" });
    expect(readConfig(path).layout).toEqual({ "before footerSpacer": ["rigline/edit"] });
    expect(viewLayout(plugins, readConfig(path)).problems).toEqual([]);
  });

  it("keeps a header comment when the last setting goes", () => {
    const path = configFile("# my settings\n\nlayout:\n  off: [session-id/short-id]\n");
    placeInLayout(path, plugins, "session-id/short-id", "default");
    expect(readFileSync(path, "utf8")).toBe("# my settings\n");
  });

  it("puts an element back where its plugin puts it, and says where that is", () => {
    const path = configFile("layout:\n  rigRow: [session-id/short-id, clock/face]\n");
    expect(placeInLayout(path, plugins, "session-id/short-id", "default")).toEqual({
      changed: true,
      placement: spacer,
      isDefault: true,
    });
    expect(readConfig(path).layout).toEqual({ rigRow: ["clock/face"] });
  });

  it("changes nothing when the element is already last in that place", () => {
    const path = configFile("layout:\n  rigRow: [clock/face, session-id/address]\n");
    expect(placeInLayout(path, plugins, "session-id/address", "rigRow").changed).toBe(false);
  });

  it("refuses an element nobody declares, or a place it cannot go, naming what there is", () => {
    const path = configFile("");
    expect(() => placeInLayout(path, plugins, "nobody/here", "rigRow")).toThrow(
      /no plugin called "nobody"/,
    );
    expect(() => placeInLayout(path, plugins, "session-id/nope", "rigRow")).toThrow(
      /its elements are short-id, full-id, address/,
    );
    expect(() => placeInLayout(path, plugins, "clock/face", spacer)).toThrow(
      "clock/face cannot go before footerSpacer; it can go in rigRow, or off",
    );
    expect(readFileSync(path, "utf8")).toBe("");
  });
});

describe("orderInLayout", () => {
  it("replaces a place's list, keeping the comment on a name already there", () => {
    const path = configFile(
      "layout:\n  rigRow:\n    - clock/face # the clock\n  off: [session-id/address]\n",
    );

    orderInLayout(path, plugins, "rigRow", ["session-id/address", "clock/face"]);

    expect(readFileSync(path, "utf8")).toBe(
      "layout:\n  rigRow:\n    - session-id/address\n    - clock/face # the clock\n",
    );
  });

  it("refuses nothing to order, or a name given twice", () => {
    const path = configFile("");
    expect(() => orderInLayout(path, plugins, "rigRow", [])).toThrow(/needs a place/);
    expect(() => orderInLayout(path, plugins, "rigRow", ["clock/face", "clock/face"])).toThrow(
      /named twice/,
    );
  });
});

describe("resetLayout", () => {
  it("takes the layout out, and says when there was none", () => {
    const path = configFile("disabled: []\nlayout:\n  rigRow: [clock/face]\n");
    expect(resetLayout(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("disabled: []\n");
    expect(resetLayout(path)).toBe(false);
  });
});
