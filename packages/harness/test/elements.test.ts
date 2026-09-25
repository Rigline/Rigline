/**
 * Elements against the real bundle (D90): an anchor slot in the composer footer, the rigRow zone at
 * the foot of the composer box, the submit guard, and what happens to an element with nowhere to go.
 */
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import {
  harnessSkipReason,
  RIGLINE_OFF,
  register,
  HARNESS_VERSION as VERSION,
} from "../src/suite.ts";

const SPACER = { anchor: "footerSpacer", at: "before" } as const;

interface CheckLine {
  readonly name: string;
  readonly verdict: string;
  readonly detail: string;
}

/** One of core's check lines, run now. */
function coreCheck(page: Page, name: string): Promise<CheckLine | null> {
  return page.evaluate((wanted) => {
    const bridge = (
      globalThis as {
        __rigline?: {
          checks: {
            run(): readonly { contributor: string; results: readonly CheckLine[] }[];
          } | null;
        };
      }
    ).__rigline;
    const core = bridge?.checks?.run().find((g) => g.contributor === "core");
    return core?.results.find((r) => r.name === wanted) ?? null;
  }, name);
}

const skip = await harnessSkipReason(VERSION);

describe.skipIf(skip !== null)(
  `elements against the real bundle${skip ? ` (${skip})` : ""}`,
  () => {
    const boot = register(VERSION);

    it("places an element before the footer spacer, ahead of the RIG pill, in a stamped slot", async () => {
      const slotted: FixturePlugin = {
        name: "slotted",
        manifest: {
          elements: { badge: { title: "Badge", placements: [SPACER], default: SPACER } },
        },
        source: `import { jsx } from "react/jsx-runtime";
import { Pill } from "@rigline/plugin-api/ui";
export default { setup(ctx) { ctx.element("badge", () => jsx(Pill, { children: "badge" })); } };`,
      };
      const booted = await boot({ plugins: [slotted] });
      const { page } = booted;
      try {
        await page.waitForSelector('[data-rigline-slot="slotted/badge"] .rigline-ui-pill');
        const order = await page.evaluate(() => {
          const slot = document.querySelector('[data-rigline-slot="slotted/badge"]');
          return {
            owner: slot?.getAttribute("data-rigline-mount") ?? null,
            text: slot?.textContent ?? null,
            next: slot?.nextElementSibling?.getAttribute("data-rigline-mount") ?? null,
            thenSpacer:
              slot?.nextElementSibling?.nextElementSibling?.classList.contains("spacer_gGYT1w") ??
              false,
          };
        });
        expect(order).toEqual({
          owner: "slotted",
          text: "badge",
          next: "rigline",
          thenSpacer: true,
        });
        expect(await coreCheck(page, "elements are placed")).toMatchObject({
          verdict: "pass",
          detail: "1 placed, 0 off",
        });
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("draws the RIG pill as the footer's other pills are, in its own colour", async () => {
      const slotted: FixturePlugin = {
        name: "slotted",
        manifest: {
          elements: { badge: { title: "Badge", placements: [SPACER], default: SPACER } },
        },
        source: `import { jsx } from "react/jsx-runtime";
import { Pill } from "@rigline/plugin-api/ui";
export default { setup(ctx) { ctx.element("badge", () => jsx(Pill, { children: "badge" })); } };`,
      };
      const booted = await boot({ plugins: [slotted] });
      const { page } = booted;
      try {
        await page.waitForSelector('[data-rigline-slot="slotted/badge"] .rigline-ui-pill');
        await page.waitForSelector(".rigline-pill");
        const read = await page.evaluate(() => {
          const box = (selector: string) => {
            const e = document.querySelector(selector);
            const r = e?.getBoundingClientRect();
            return r ? { height: r.height, mid: r.top + r.height / 2 } : null;
          };
          const rig = document.querySelector(".rigline-pill button");
          return {
            element: box('[data-rigline-slot="slotted/badge"] .rigline-ui-pill'),
            rig: box(".rigline-pill button"),
            background: rig ? getComputedStyle(rig).backgroundColor : null,
          };
        });
        expect(read.element).not.toBeNull();
        expect(read.rig?.height).toBe(read.element?.height);
        expect(read.rig?.mid).toBeCloseTo(read.element?.mid ?? Number.NaN, 0);
        expect(read.background).toBe("rgb(45, 125, 70)");
      } finally {
        await booted.close();
      }
    }, 20000);

    it("keeps rigRow last in the composer box, after the model pill's row, and gone with its last element", async () => {
      const rowed: FixturePlugin = {
        name: "rowed",
        manifest: {
          elements: { note: { title: "Note", placements: ["rigRow"], default: "rigRow" } },
        },
        source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) {
  window.__unbind = ctx.element("note", () => jsx("span", { className: "harness-row-item", children: "in the row" }));
} };`,
      };
      const booted = await boot({ plugins: [rowed], layout: RIGLINE_OFF });
      const { page } = booted;
      try {
        await page.setViewportSize({ width: 720, height: 800 });
        await page.waitForSelector('[data-rigline-zone="rigRow"] .harness-row-item');
        const box = () =>
          page.evaluate(() => {
            const box = document.querySelector(".inputContainer_cKsPxg");
            const zone = document.querySelector('[data-rigline-zone="rigRow"]');
            const item = document.querySelector(".harness-row-item");
            const rect = item?.getBoundingClientRect();
            const hit = rect
              ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
              : null;
            return {
              last: box?.lastElementChild === zone,
              afterModelRow:
                zone?.previousElementSibling?.classList.contains("modelPillRow_gGYT1w") ?? false,
              hit: hit !== null && item !== null && (hit === item || item.contains(hit)),
              stage: document.querySelector(".inputFooter_gGYT1w")?.getAttribute("data-fit-stage"),
            };
          });
        expect(await box()).toMatchObject({ last: true, afterModelRow: false, hit: true });

        // A long model name, as far as the fit ladder can tell, pushes the footer into stage 2, where
        // React appends the model pill's own row after whatever is last in the box.
        await page.addStyleTag({
          content: ".inputFooter_gGYT1w .modelPill_gGYT1w{min-width:240px}",
        });
        await page.setViewportSize({ width: 400, height: 800 });
        await page.waitForSelector(".modelPillRow_gGYT1w");
        await page.waitForFunction(() => {
          const zone = document.querySelector('[data-rigline-zone="rigRow"]');
          return zone?.parentElement?.lastElementChild === zone;
        });
        expect(await box()).toEqual({ last: true, afterModelRow: true, hit: true, stage: "2" });

        // Settled, not merely passing through: the stage holds while nothing changes.
        const changes = await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              let count = 0;
              const footer = document.querySelector(".inputFooter_gGYT1w") as Element;
              const observer = new MutationObserver((records) => {
                count += records.length;
              });
              observer.observe(footer, { attributes: true, attributeFilter: ["data-fit-stage"] });
              setTimeout(() => {
                observer.disconnect();
                resolve(count);
              }, 500);
            }),
        );
        expect(changes).toBe(0);

        await page.evaluate(() => (window as unknown as { __unbind: () => void }).__unbind());
        await page.waitForSelector('[data-rigline-zone="rigRow"]', { state: "detached" });
        const d = await booted.diagnostics();
        expect(d.mounts.abandoned).toEqual([]);
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("keeps the placement check quiet while the host puts nodes back across fit stages", async () => {
      const rowed: FixturePlugin = {
        name: "rowed",
        manifest: {
          elements: {
            badge: { title: "Badge", placements: [SPACER], default: SPACER },
            note: { title: "Note", placements: ["rigRow"], default: "rigRow" },
          },
        },
        source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) {
  ctx.element("badge", () => jsx("span", { children: "badge" }));
  ctx.element("note", () => jsx("span", { children: "note" }));
} };`,
      };
      const booted = await boot({ plugins: [rowed] });
      const { page } = booted;
      try {
        await page.setViewportSize({ width: 720, height: 800 });
        await page.waitForSelector('[data-rigline-zone="rigRow"]');
        await page.addStyleTag({
          content: ".inputFooter_gGYT1w .modelPill_gGYT1w{min-width:240px}",
        });
        // Every frame, because a once-a-second poll lands between a move and its correction only
        // sometimes, and the property is that it never reports one as a failure.
        await page.evaluate(() => {
          const w = window as unknown as {
            __lines: string[];
            __rigline: { checks: { run(): { results: CheckLine[] }[] } };
          };
          w.__lines = [];
          const poll = (): void => {
            for (const group of w.__rigline.checks.run()) {
              for (const r of group.results) {
                if (r.name === "mount: nodes are where the host put them") {
                  w.__lines.push(`${r.verdict}: ${r.detail}`);
                }
              }
            }
            requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        });
        for (let i = 0; i < 5; i++) {
          for (const width of [520, 460, 440, 520, 560]) {
            await page.setViewportSize({ width, height: 800 });
            await page.waitForTimeout(30);
          }
        }
        const lines = await page.evaluate(
          () => (window as unknown as { __lines: string[] }).__lines,
        );
        expect(lines.some((l) => l.includes("being put back"))).toBe(true);
        expect(lines.filter((l) => l.startsWith("fail"))).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    /**
     * An element's button with no type in the footer would otherwise be the composer's default button,
     * which Enter in any field of the form clicks, so each element renders in a form of its own.
     */
    it("keeps a button with no type, and Enter in a field, from sending the prompt or clicking another element", async () => {
      const formy: FixturePlugin = {
        name: "formy",
        manifest: {
          elements: {
            "footer-button": { title: "Footer button", placements: [SPACER], default: SPACER },
            "row-button": { title: "Row button", placements: ["rigRow"], default: "rigRow" },
            field: { title: "Field", placements: ["rigRow"], default: "rigRow" },
          },
        },
        source: `import { jsx } from "react/jsx-runtime";
window.__clicks = {};
const button = (id) => () => jsx("button", {
  id, children: id, onClick: () => { window.__clicks[id] = (window.__clicks[id] ?? 0) + 1; },
});
export default { setup(ctx) {
  ctx.element("footer-button", button("harness-footer-button"));
  ctx.element("row-button", button("harness-row-button"));
  ctx.element("field", () => jsx("input", { id: "harness-row-input" }));
} };`,
      };
      const booted = await boot({ plugins: [formy] });
      const { page } = booted;
      const prompts = async (): Promise<number> =>
        (await booted.sent()).filter((m) => m.type === "io_message").length;
      try {
        await page.waitForSelector("#harness-row-input");
        await page.click('[aria-label="Message input"]');
        await page.keyboard.type("typed prompt");
        const before = await prompts();

        await page.click("#harness-footer-button");
        await page.click("#harness-row-button");
        await page.click("#harness-row-input");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
        expect(
          await page.evaluate(() => (window as unknown as { __clicks: unknown }).__clicks),
        ).toEqual({ "harness-footer-button": 1, "harness-row-button": 1 });
        expect(await prompts()).toBe(before);

        // The guard is about what Rigline placed: the composer's own Enter still sends.
        await page.click('[aria-label="Message input"]');
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          (n) =>
            (
              (window as unknown as { __harness: { sent: { type: string }[] } }).__harness.sent ??
              []
            ).filter((m) => m.type === "io_message").length > n,
          before,
        );
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("places nothing with nowhere to go, says why, and leaves the rest of the plugin working", async () => {
      const partial: FixturePlugin = {
        name: "partial",
        manifest: {
          uses: { menu: true },
          elements: {
            off: { title: "Off", placements: ["rigRow"], default: null },
            gone: { title: "Gone", placements: [SPACER], default: SPACER },
            lonely: { title: "Lonely", placements: ["rigRow"], default: "rigRow" },
          },
        },
        source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) {
  ctx.element("off", () => jsx("span", { className: "harness-off", children: "off" }));
  ctx.element("gone", () => jsx("span", { className: "harness-gone", children: "gone" }));
  ctx.menu(() => jsx("span", { className: "harness-partial-entry", children: "still here" }));
} };`,
      };
      const booted = await boot({
        plugins: [partial],
        remove: { anchors: ["footerSpacer"] },
        layout: RIGLINE_OFF,
      });
      const { page } = booted;
      try {
        await page.waitForSelector(".rigline-pill");
        await page.click(".rigline-pill");
        await page.waitForSelector(".harness-partial-entry");
        expect(
          await page.$$("[data-rigline-slot], [data-rigline-element], [data-rigline-zone]"),
        ).toHaveLength(0);
        expect(await page.$$(".harness-off, .harness-gone")).toHaveLength(0);

        const line = await coreCheck(page, "elements are placed");
        expect(line?.verdict).toBe("fail");
        expect(line?.detail).toContain("partial/gone");
        expect(line?.detail).toContain("partial/lonely: declared, and setup never bound it");
        expect(line?.detail).not.toContain("partial/off");

        const d = await booted.diagnostics();
        const status = d.plugins.find((p) => p.name === "partial");
        expect(status?.status).toBe("loaded");
        expect(status?.missingOptional).toContainEqual(
          expect.stringContaining('element "gone" cannot go before footerSpacer'),
        );
      } finally {
        await booted.close();
      }
    }, 20000);

    it("disables only the plugin whose element throws, binds an undeclared id, or throws on click", async () => {
      const element = (name: string, setup: string): FixturePlugin => ({
        name,
        manifest: {
          elements: { item: { title: "Item", placements: ["rigRow"], default: "rigRow" } },
        },
        source: `import { jsx } from "react/jsx-runtime";
import { Pill } from "@rigline/plugin-api/ui";
export default { setup(ctx) { ${setup} } };`,
      });
      const booted = await boot({
        plugins: [
          element(
            "thrower",
            'ctx.element("item", () => { throw new Error("no element for you"); });',
          ),
          element("stranger", 'ctx.element("nope", () => null);'),
          element(
            "clicky",
            'ctx.element("item", () => jsx(Pill, { onClick: () => { throw new Error("click boom"); }, children: "click me" }));',
          ),
          element(
            "steady",
            'ctx.element("item", () => jsx("span", { className: "harness-steady", children: "ok" }));',
          ),
        ],
      });
      const { page } = booted;
      try {
        await page.waitForSelector('[data-rigline-zone="rigRow"] .harness-steady');
        await page.click("text=click me");
        await page.waitForSelector("text=click me", { state: "detached" });

        const d = await booted.diagnostics();
        const reason = (name: string) => d.plugins.find((p) => p.name === name)?.reason ?? "";
        expect(reason("thrower")).toContain('its element "item" threw: no element for you');
        expect(reason("stranger")).toContain(
          `element("nope") needs "nope" under elements in this plugin's rigline.json`,
        );
        expect(reason("clicky")).toContain("its pill's click handler threw: click boom");
        expect(d.plugins.find((p) => p.name === "steady")?.status).toBe("loaded");
        expect(await page.isVisible(".harness-steady")).toBe(true);
        expect(d.errors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("puts elements where the layout says, listed ones first in its order, the rest after", async () => {
      // Two plugins, so "listed first" is shown to beat registry order and not merely follow it.
      const item = (name: string) =>
        `ctx.element("${name}", () => jsx("span", { className: "harness-item", children: "${name}" }));`;
      const early: FixturePlugin = {
        name: "early",
        manifest: {
          elements: {
            e: { title: "E", placements: ["rigRow"], default: "rigRow" },
            f: { title: "F", placements: [SPACER], default: SPACER },
          },
        },
        source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) { ${item("e")} ${item("f")} } };`,
      };
      const laid: FixturePlugin = {
        name: "laid",
        manifest: {
          elements: {
            a: { title: "A", placements: [SPACER, "rigRow"], default: SPACER },
            b: { title: "B", placements: ["rigRow"], default: "rigRow" },
            c: { title: "C", placements: ["rigRow"], default: null },
            d: { title: "D", placements: [SPACER], default: SPACER },
            g: { title: "G", placements: [SPACER], default: SPACER },
          },
        },
        source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) { ${["a", "b", "c", "d", "g"].map(item).join(" ")} } };`,
      };
      const booted = await boot({
        plugins: [early, laid],
        layout: {
          rigRow: ["laid/c", "laid/a"],
          "before footerSpacer": ["laid/g"],
          off: ["laid/d"],
        },
      });
      const { page } = booted;
      try {
        await page.waitForSelector('[data-rigline-zone="rigRow"] .harness-item');
        await page.waitForSelector('[data-rigline-slot="laid/g"] .harness-item');
        const seen = await page.evaluate(() => {
          const zone = document.querySelector('[data-rigline-zone="rigRow"]');
          const slot = document.querySelector('[data-rigline-slot="laid/g"]');
          return {
            row: [...(zone?.querySelectorAll(".harness-item") ?? [])].map((e) => e.textContent),
            footer: [slot, slot?.nextElementSibling, slot?.nextElementSibling?.nextElementSibling]
              .map(
                (e) =>
                  e?.getAttribute("data-rigline-slot") ?? e?.getAttribute("data-rigline-mount"),
              )
              .join(" "),
            d: document.querySelector('[data-rigline-slot="laid/d"]') !== null,
          };
        });
        expect(seen).toEqual({
          row: ["c", "a", "e", "b"],
          footer: "laid/g early/f rigline",
          d: false,
        });
        expect(await coreCheck(page, "elements are placed")).toMatchObject({
          verdict: "pass",
          detail: "6 placed, 1 off",
        });
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
