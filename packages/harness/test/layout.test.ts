/**
 * The Layout submenu against the real bundle (D93): moves re-place live, Save is a link carrying the
 * copy, the guard cancels a click VS Code would never see, no companion means Copy commands, and
 * Reload picks up a layout saved elsewhere. `registry.js` is rewritten mid-run where a test stands
 * in for the engine, since the panel learns what the file holds only by reading it again. Then
 * editing in place over the same copy (D95).
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

async function enterEditing(page: Page): Promise<void> {
  await openLayout(page);
  await page.getByRole("menuitemcheckbox", { name: /^Edit in place/ }).click();
  await page.waitForSelector(".rigline-edit-handle");
}

/** The `data-rigline-item` of what has focus: a handle or a chip names its element. */
function focusedItem(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-rigline-item"));
}

/** The middle of what `selector` finds. */
async function middle(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`nothing is at ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses on what `selector` finds and moves to `to`, still holding the button. */
async function pickUp(page: Page, selector: string, to: { x: number; y: number }): Promise<void> {
  const from = await middle(page, selector);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
}

function targets(page: Page): Promise<(string | null)[]> {
  return page
    .locator(".rigline-edit-target")
    .evaluateAll((all) => all.map((t) => t.getAttribute("data-rigline-place")).sort());
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
      await choose(page, "Three", "Move to Rigline row");
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
      await choose(page, "One", "Move after Two");
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
      await choose(page, "Three", "Move to Rigline row");
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

describe.skipIf(skip !== null)(`editing in place${skip ? ` (${skip})` : ""}`, () => {
  const boot = register(VERSION);

  it("covers each element with a handle, holds rigRow open, and trays the rest", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await enterEditing(page);
      await page.locator(".rigline-edit-handle").nth(1).waitFor();
      const covered = await page.evaluate(() =>
        ["one", "two"].map((id) => {
          const element = document.querySelector(`.deck-${id}`)?.getBoundingClientRect();
          const handle = document
            .querySelector(`[data-rigline-item="deck/${id}"]`)
            ?.getBoundingClientRect();
          if (!element || !handle) return false;
          return (
            handle.left <= element.left &&
            handle.right >= element.right &&
            handle.top <= element.top &&
            handle.bottom >= element.bottom
          );
        }),
      );
      expect(covered).toEqual([true, true]);
      const zone = await page.locator('[data-rigline-zone="rigRow"]').boundingBox();
      expect(zone?.height ?? 0).toBeGreaterThan(0);
      const three = page.locator('.rigline-edit-chip[data-rigline-item="deck/three"]');
      await expect(three.locator(".rigline-edit-why").textContent()).resolves.toBe("off");
      // Entered with the pointer, focus still lands on the first handle for the keyboard to take up.
      expect(await focusedItem(page)).toBe("deck/one");

      await page.locator(".rigline-edit-bar").getByRole("button", { name: "Done" }).click();
      await page.waitForSelector(".rigline-edit-handle", { state: "detached" });
      await page.waitForSelector('[data-rigline-zone="rigRow"]', { state: "detached" });
      expect(
        await page.evaluate(() => document.activeElement?.classList.contains("rigline-pill")),
      ).toBe(true);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("opens an element's moves from its handle, and never reaches the element", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await enterEditing(page);
      await page.evaluate(() => {
        const w = window as unknown as { __clicks: number };
        w.__clicks = 0;
        document.querySelector(".deck-one")?.addEventListener("click", () => w.__clicks++);
      });
      await page.locator('[data-rigline-item="deck/one"]').click();
      expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(
        0,
      );
      await page.getByText("One — Footer").waitFor();
      await page.getByRole("menuitem", { name: "Move to Rigline row" }).click();
      await page.waitForSelector('[data-rigline-zone="rigRow"] .deck-one');
      await page.getByText("One — Rigline row").waitFor();
      // Off takes the handle away, so the pop-over closes onto the element's chip.
      await page.getByRole("menuitem", { name: "Switch off" }).click();
      await page.waitForSelector(".rigline-menu", { state: "detached" });
      expect(await focusedItem(page)).toBe("deck/one");
      expect(await page.evaluate(() => document.activeElement?.className)).toBe(
        "rigline-edit-chip",
      );

      const href =
        (await page
          .locator('.rigline-edit-bar a[href^="vscode://rigline.rigline/layout?p="]')
          .getAttribute("href")) ?? "";
      const payload = JSON.parse(
        Buffer.from(new URL(href).searchParams.get("p") ?? "", "base64url").toString("utf8"),
      );
      expect(payload.to).toEqual({ off: ["deck/one"] });

      await page.locator(".rigline-edit-bar").getByRole("button", { name: "Done" }).click();
      await page.click(".rigline-pill");
      await page.getByRole("menuitem", { name: /^Layout.*unsaved changes/ }).waitFor();
    } finally {
      await booted.close();
    }
  }, 30000);

  it("edits from the keyboard through the same moves", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await enterEditing(page);
      const activeText = () => page.evaluate(() => document.activeElement?.textContent ?? "");
      const order = () =>
        page.evaluate(() => {
          const one = document.querySelector('[data-rigline-slot="deck/one"]');
          const two = document.querySelector('[data-rigline-slot="deck/two"]');
          if (!one || !two) return null;
          return one.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING ? "12" : "21";
        });
      await expect.poll(() => focusedItem(page)).toBe("deck/one");
      await page.keyboard.press("ArrowRight");
      expect(await focusedItem(page)).toBe("deck/two");
      await page.keyboard.press("Enter");
      await expect.poll(activeText).toBe("Move before One");
      await page.keyboard.press("Enter");
      await expect.poll(order).toBe("21");
      // The move took its own item away; the arrows still find the moves that are left.
      await page.keyboard.press("ArrowDown");
      expect(await activeText()).toBe("Move after One");
      await page.keyboard.press("Escape");
      expect(await focusedItem(page)).toBe("deck/two");
      await page.keyboard.press("Escape");
      await page.waitForSelector(".rigline-edit-handle", { state: "detached" });
      expect(
        await page.evaluate(() => document.activeElement?.classList.contains("rigline-pill")),
      ).toBe(true);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("drags an element into rigRow, re-placing it on the drop and not before", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await enterEditing(page);
      const zone = await middle(page, '[data-rigline-zone="rigRow"]');
      await pickUp(page, '[data-rigline-item="deck/one"]', zone);
      await page.locator(".rigline-edit-marker").waitFor();
      expect(await targets(page)).toEqual(["before footerSpacer", "rigRow"]);
      expect(await page.locator('[data-rigline-slot="deck/one"] .deck-one').count()).toBe(1);
      await page.mouse.up();
      await page.waitForSelector('[data-rigline-zone="rigRow"] .deck-one');
      await page.waitForSelector(".rigline-edit-target", { state: "detached" });
      // The click that ends a drag opens nothing.
      expect(await page.locator(".rigline-menu").count()).toBe(0);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("reorders the footer by drag without moving its fit stage", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await enterEditing(page);
      const order = () =>
        page.evaluate(() => {
          const one = document.querySelector('[data-rigline-slot="deck/one"]');
          const two = document.querySelector('[data-rigline-slot="deck/two"]');
          if (!one || !two) return null;
          return one.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING ? "12" : "21";
        });
      await page.evaluate(() => {
        const footer = document.querySelector(".inputFooter_gGYT1w") as Element;
        const w = window as unknown as { __stages: number };
        w.__stages = 0;
        new MutationObserver((records) => {
          w.__stages += records.length;
        }).observe(footer, { attributes: true, attributeFilter: ["data-fit-stage"] });
      });
      const two = await page.locator('[data-rigline-item="deck/two"]').boundingBox();
      if (!two) throw new Error("no handle on two");
      await pickUp(page, '[data-rigline-item="deck/one"]', {
        x: two.x + two.width - 2,
        y: two.y + two.height / 2,
      });
      await page.mouse.up();
      await expect.poll(order).toBe("21");
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as unknown as { __stages: number }).__stages)).toBe(
        0,
      );
    } finally {
      await booted.close();
    }
  }, 30000);

  it("switches off by a drop on the bar, and on again from the tray", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await enterEditing(page);
      const bar = await page.locator(".rigline-edit-bar").boundingBox();
      if (!bar) throw new Error("no bar");
      await pickUp(page, '[data-rigline-item="deck/two"]', { x: bar.x + 8, y: bar.y + 8 });
      await page.locator(".rigline-edit-bar-over").waitFor();
      await page.mouse.up();
      await page.waitForSelector(".deck-two", { state: "detached" });
      await page.locator('.rigline-edit-chip[data-rigline-item="deck/two"]').waitFor();

      // Three offers rigRow alone, and is off already, so rigRow is its only target.
      const zone = await middle(page, '[data-rigline-zone="rigRow"]');
      await pickUp(page, '.rigline-edit-chip[data-rigline-item="deck/three"]', zone);
      await page.locator(".rigline-edit-marker").waitFor();
      expect(await targets(page)).toEqual(["rigRow"]);
      expect(await page.locator(".rigline-edit-bar-target").count()).toBe(0);
      await page.mouse.up();
      await page.waitForSelector('[data-rigline-zone="rigRow"] .deck-three');
    } finally {
      await booted.close();
    }
  }, 30000);

  it("changes nothing when Escape ends a drag", async () => {
    const booted = await boot({ plugins: [deck], save: COMPANION });
    const { page } = booted;
    try {
      await enterEditing(page);
      await pickUp(
        page,
        '[data-rigline-item="deck/one"]',
        await middle(page, '[data-rigline-zone="rigRow"]'),
      );
      await page.locator(".rigline-edit-marker").waitFor();
      await page.keyboard.press("Escape");
      await page.waitForSelector(".rigline-edit-target", { state: "detached" });
      await page.mouse.up();
      await page.waitForTimeout(100);
      expect(await page.locator('[data-rigline-slot="deck/one"] .deck-one').count()).toBe(1);
      expect(await page.locator(".rigline-edit-handle").count()).toBe(2);
      expect(await page.locator(".rigline-menu").count()).toBe(0);
    } finally {
      await booted.close();
    }
  }, 30000);
});
