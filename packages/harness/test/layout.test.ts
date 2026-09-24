/**
 * The Layout submenu against the real bundle (D93): moves re-place live, Save is a link carrying the
 * copy, the guard cancels a click VS Code would never see, no companion means Copy commands, and
 * Reload picks up a layout saved elsewhere. `registry.js` is rewritten mid-run where a test stands
 * in for the engine, since the panel learns what the file holds only by reading it again.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Layout, SaveRecord } from "@rigline/plugin-api";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const SPACER = { anchor: "footerSpacer", at: "before" } as const;
const TOKEN = "ABCDEFGHIJKLMNOPQRSTUV";
const COMPANION: SaveRecord = { token: TOKEN, companion: true, scheme: "vscode" };

const deck: FixturePlugin = {
  name: "deck",
  manifest: {
    elements: {
      one: { title: "One", placements: [SPACER, "rigRow"], default: SPACER },
      two: { title: "Two", placements: [SPACER, "rigRow"], default: SPACER },
      three: { title: "Three", placements: ["rigRow"], default: null },
    },
  },
  source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) {
  ctx.element("one", () => jsx("span", { className: "deck-one", children: "1" }));
  ctx.element("two", () => jsx("span", { className: "deck-two", children: "2" }));
  ctx.element("three", () => jsx("span", { className: "deck-three", children: "3" }));
} };`,
};

/** Stands in for the engine: what a re-inject would leave in `registry.js`. */
function saveToRegistry(payloadDir: string, layout: Layout): void {
  const path = join(payloadDir, "registry.js");
  const source = readFileSync(path, "utf8").replace(
    /^export const layout = .*;$/m,
    `export const layout = ${JSON.stringify(layout)};`,
  );
  writeFileSync(path, source);
}

async function openLayout(page: Page): Promise<void> {
  await page.waitForSelector(".rigline-pill");
  await page.click(".rigline-pill");
  await page.getByRole("menuitem", { name: /^Layout/ }).click();
}

async function choose(page: Page, element: string, move: string): Promise<void> {
  await page.getByRole("menuitem", { name: new RegExp(`^${element}`) }).click();
  await page.getByRole("menuitem", { name: move }).click();
}

const skip = await harnessSkipReason(VERSION);

describe.skipIf(skip !== null)(`the Layout submenu${skip ? ` (${skip})` : ""}`, () => {
  const boot = register(VERSION);

  it("moves an element live, and saves through a link that carries the copy", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await openLayout(page);
      const pillTop = () =>
        page.evaluate(() => document.querySelector(".rigline-pill")?.getBoundingClientRect().top);
      const opened = await pillTop();
      await choose(page, "Three", "Move to rigRow");
      await page.waitForSelector('[data-rigline-zone="rigRow"] .deck-three');
      // The new row grows the composer and lifts the pill; the open menu follows it off the pill.
      expect(await pillTop()).toBeLessThan(opened ?? 0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const pill = document.querySelector(".rigline-pill")?.getBoundingClientRect();
            const menu = document.querySelector(".rigline-menu")?.getBoundingClientRect();
            return !!pill && !!menu && menu.bottom <= pill.top;
          }),
        )
        .toBe(true);

      const link = page.locator('a.rigline-menu-item[href^="vscode://rigline.rigline/layout?p="]');
      const href = (await link.getAttribute("href")) ?? "";
      const payload = JSON.parse(
        Buffer.from(new URL(href).searchParams.get("p") ?? "", "base64url").toString("utf8"),
      );
      expect(payload).toEqual({ v: 1, token: TOKEN, from: {}, to: { rigRow: ["deck/three"] } });

      // A scripted click is one VS Code never routes: without the guard it would navigate the
      // panel away. It still starts the confirmation, which the rewritten registry then settles.
      const outcome = await page.evaluate(() => {
        let prevented: boolean | null = null;
        addEventListener("click", (e) => (prevented = e.defaultPrevented), { once: true });
        (document.querySelector('a[href^="vscode:"]') as HTMLAnchorElement).click();
        return { prevented, href: location.href };
      });
      expect(outcome.prevented).toBe(true);
      expect(outcome.href).toBe(page.url());
      await page.getByText("Saving through the Rigline companion").waitFor();
      saveToRegistry(booted.payloadDir, { rigRow: ["deck/three"] });
      await page.getByText("Saved.").waitFor({ timeout: 5000 });
      await expect(link.count()).resolves.toBe(0);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("reorders the footer live without moving its fit stage", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await openLayout(page);
      const order = () =>
        page.evaluate(() => {
          const one = document.querySelector('[data-rigline-slot="deck/one"]');
          const two = document.querySelector('[data-rigline-slot="deck/two"]');
          if (!one || !two) return null;
          return one.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING ? "12" : "21";
        });
      expect(await order()).toBe("12");
      await page.evaluate(() => {
        const footer = document.querySelector(".inputFooter_gGYT1w") as Element;
        const w = window as unknown as { __stages: number };
        w.__stages = 0;
        new MutationObserver((records) => {
          w.__stages += records.length;
        }).observe(footer, { attributes: true, attributeFilter: ["data-fit-stage"] });
      });
      await choose(page, "One", "Move down");
      await expect.poll(order).toBe("21");
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as unknown as { __stages: number }).__stages)).toBe(
        0,
      );
    } finally {
      await booted.close();
    }
  }, 30000);

  it("offers the commands instead where no companion answers", async () => {
    const booted = await boot({ plugins: [deck], save: { ...COMPANION, companion: false } });
    const { page } = booted;
    try {
      await openLayout(page);
      await choose(page, "Three", "Move to rigRow");
      await page.waitForSelector('[data-rigline-zone="rigRow"] .deck-three');
      expect(await page.locator('a[href^="vscode:"]').count()).toBe(0);
      await page.evaluate(() => {
        document.execCommand = () => {
          (window as unknown as { __copied: string }).__copied = (
            document.activeElement as HTMLTextAreaElement
          ).value;
          return true;
        };
      });
      await page.getByRole("menuitem", { name: /^Copy commands/ }).click();
      expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(
        "rigline layout order rigRow deck/three",
      );
    } finally {
      await booted.close();
    }
  }, 30000);

  it("says a newer layout is saved, and reloads it without a webview reload", async () => {
    const booted = await boot({ plugins: [deck] });
    const { page } = booted;
    try {
      await page.waitForSelector(".deck-one");
      saveToRegistry(booted.payloadDir, { off: ["deck/one"] });
      await page.waitForSelector(".rigline-pill");
      await page.click(".rigline-pill");
      await page.getByRole("menuitem", { name: /a newer layout is saved/ }).waitFor();
      await page.getByRole("menuitem", { name: /^Layout/ }).click();
      await page.getByRole("menuitem", { name: /^Reload saved layout/ }).click();
      await page.waitForSelector(".deck-one", { state: "detached" });
    } finally {
      await booted.close();
    }
  }, 30000);
});
