/**
 * Panels telling each other about a save (D141), as pages on one origin in one browser: what one
 * posts, and what another does with it before the file holds it and after. `registry.js` is rewritten
 * where a test stands in for the engine. Whether a message crosses VS Code's webviews is the live
 * panel's question, and nothing here answers it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Layout, SaveRecord } from "@rigline/plugin-api/internal";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import {
  harnessSkipReason,
  RIGLINE_OFF,
  register,
  HARNESS_VERSION as VERSION,
} from "../src/suite.ts";

const CHANNEL = "rigline-harness";
const COMPANION: SaveRecord = { token: "c".repeat(22), companion: true, scheme: "vscode" };
const SCREEN = '[role="dialog"].rigline-settings-frame';

/** A plugin with a tab of its own, that reports what `onSettings` hands it. */
const clock: FixturePlugin = {
  name: "clock",
  manifest: {
    uses: { settingsTab: true },
    elements: { open: { title: "Open", placements: ["rigRow"], default: "rigRow" } },
  },
  source: `import { jsx } from "react/jsx-runtime";
import { SettingRow, Toggle, useSettingsDraft } from "@rigline/plugin-api/ui";
export default { setup(ctx) {
  window.__heard = [];
  ctx.onSettings((s) => window.__heard.push(s));
  ctx.settingsTab("Clock", () => {
    const [draft, setDraft] = useSettingsDraft();
    return jsx(SettingRow, { label: "Show seconds", children:
      jsx(Toggle, { checked: draft.seconds === true, onChange: (on) => setDraft({ ...draft, seconds: on }) }) });
  });
  ctx.element("open", () => jsx("button", { type: "button", className: "clock-open",
    onClick: () => ctx.openSettings(), children: "C" }));
} };`,
};

const deck: FixturePlugin = {
  name: "deck",
  manifest: {
    elements: {
      one: { title: "One", placements: ["rigRow"], default: "rigRow" },
      two: { title: "Two", placements: ["rigRow"], default: "rigRow" },
    },
  },
  source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) {
  ctx.element("one", () => jsx("span", { className: "deck-one", children: "1" }));
  ctx.element("two", () => jsx("span", { className: "deck-two", children: "2" }));
} };`,
};

/** Stands in for the engine: what a re-inject would leave in `registry.js`. */
function rewrite(payloadDir: string, name: string, value: unknown): void {
  const path = join(payloadDir, "registry.js");
  const source = readFileSync(path, "utf8").replace(
    new RegExp(`^export const ${name} = .*;$`, "m"),
    `export const ${name} = ${JSON.stringify(value)};`,
  );
  writeFileSync(path, source);
}

function heard(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { __heard: unknown[] }).__heard);
}

/** A click VS Code would never see, which the guard cancels and the confirmation still follows. */
async function follow(page: Page, link: string): Promise<void> {
  await page.evaluate((selector) => {
    (document.querySelector(selector) as HTMLAnchorElement).click();
  }, link);
}

/** The person comes back to `page`, and its read of `registry.js` has been taken in. */
async function lookAgain(page: Page): Promise<void> {
  const read = page.waitForResponse((r) => r.url().includes("registry.js?read="));
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await read;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
}

async function openLayout(page: Page): Promise<void> {
  await page.waitForSelector(".rigline-pill");
  await page.click(".rigline-pill");
  await page.getByRole("menuitem", { name: /^Layout/ }).click();
}

async function switchOff(page: Page, element: string): Promise<void> {
  await page.getByRole("menuitem", { name: new RegExp(`^${element}`) }).click();
  await page.getByRole("menuitem", { name: "Switch off" }).click();
}

const skip = await harnessSkipReason(VERSION);

describe.skipIf(skip !== null)(`telling the other panels${skip ? ` (${skip})` : ""}`, () => {
  const boot = register(VERSION);

  it("hands another panel a settings save at once, and a read the file has not caught up with does not undo it", async () => {
    const booted = await boot({
      plugins: [clock],
      save: COMPANION,
      broadcast: CHANNEL,
      settings: { clock: { seconds: false } },
    });
    const { page } = booted;
    try {
      const other = await booted.another();
      await page.click(".clock-open");
      await page.locator(SCREEN).waitFor();
      await page.getByRole("switch", { name: "Show seconds" }).click();
      await follow(page, `${SCREEN} a[href^="vscode://rigline.rigline/settings?p="]`);

      await expect.poll(() => heard(other.page)).toEqual([{ seconds: false }, { seconds: true }]);
      // The file does not hold it yet, which is the write not having landed.
      await lookAgain(other.page);
      expect(await heard(other.page)).toEqual([{ seconds: false }, { seconds: true }]);

      rewrite(booted.payloadDir, "settings", { clock: { seconds: true } });
      await expect
        .poll(() => heard(page), { timeout: 5000 })
        .toEqual([{ seconds: false }, { seconds: true }]);
      await expect.poll(async () => (await booted.diagnostics()).broadcast.posted).toBe(2);
      await expect.poll(async () => (await other.diagnostics()).broadcast.heard).toBe(2);
      expect(await heard(other.page)).toEqual([{ seconds: false }, { seconds: true }]);
      expect((await booted.diagnostics()).broadcast).toMatchObject({ heard: 0, dropped: 0 });
      expect((await other.diagnostics()).broadcast).toMatchObject({ posted: 0, dropped: 0 });
    } finally {
      await booted.close();
    }
  }, 30000);

  it("moves another panel's elements at once, and tells one with unsaved moves instead", async () => {
    const booted = await boot({
      plugins: [deck],
      save: COMPANION,
      broadcast: CHANNEL,
      layout: RIGLINE_OFF,
    });
    const { page } = booted;
    try {
      const clean = await booted.another();
      const busy = await booted.another();
      await openLayout(busy.page);
      await switchOff(busy.page, "Two");
      await busy.page.waitForSelector(".deck-two", { state: "detached" });
      await busy.page.keyboard.press("Escape");
      await busy.page.keyboard.press("Escape");

      await openLayout(page);
      await switchOff(page, "One");
      const saved: Layout = { off: [...(RIGLINE_OFF.off ?? []), "deck/one"] };
      await follow(page, 'a.rigline-menu-item[href^="vscode://rigline.rigline/layout?p="]');

      await clean.page.waitForSelector(".deck-one", { state: "detached" });
      // A read the file has not caught up with takes none of it back.
      await lookAgain(clean.page);
      expect(await clean.page.locator(".deck-one").count()).toBe(0);

      // Its own move stands, and the menu says what is behind it, after the read opening it makes.
      expect(await busy.page.locator(".deck-one").count()).toBe(1);
      const read = busy.page.waitForResponse((r) => r.url().includes("registry.js?read="));
      await busy.page.click(".rigline-pill");
      await read;
      await busy.page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      const behind = /^Layout.*unsaved changes, and a newer layout is saved/;
      expect(await busy.page.getByRole("menuitem", { name: behind }).count()).toBe(1);

      rewrite(booted.payloadDir, "layout", saved);
      await page.getByText("Saved.").waitFor({ timeout: 5000 });
      await expect.poll(async () => (await clean.diagnostics()).broadcast.heard).toBe(2);
      expect(await clean.page.locator(".deck-one").count()).toBe(0);
      expect(await clean.page.locator(".deck-two").count()).toBe(1);
    } finally {
      await booted.close();
    }
  }, 30000);
});
