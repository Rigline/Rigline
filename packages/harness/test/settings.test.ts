/**
 * The settings screen against the real bundle: Rigline's tab and a plugin's, drawn from the kit over
 * drafts the host holds, one Save carrying both, and what a confirmed save changes — the gate goes
 * live, and a plugin's `onSettings` hears its section. `registry.js` is rewritten mid-run where a
 * test stands in for the engine, since the panel learns what the file holds only by reading it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelSettings, SaveRecord, SettingsPayload } from "@rigline/plugin-api/internal";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const COMPANION: SaveRecord = { token: "c".repeat(32), companion: true, scheme: "vscode" };
const OFF: ModelSettings = { requireChoice: "off", default: null };
const SCREEN = '[role="dialog"].rigline-settings';
const SAVE = `${SCREEN} a[href^="vscode://rigline.rigline/settings?p="]`;

const MODELS = [
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    supportsEffort: true,
    supportedEffortLevels: ["medium", "high"],
  },
  { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku" },
];

/** A plugin with a tab of its own, that reports what `onSettings` hands it. */
const clock: FixturePlugin = {
  name: "clock",
  manifest: {
    uses: { settingsTab: true },
    elements: { open: { title: "Open", placements: ["rigRow"], default: "rigRow" } },
  },
  source: `import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { SettingRow, Toggle, useSettingsDraft } from "@rigline/plugin-api/ui";
export default { setup(ctx) {
  window.__heard = [];
  ctx.onSettings((s) => window.__heard.push(s));
  ctx.settingsTab("Clock", () => {
    const [draft, setDraft] = useSettingsDraft();
    return jsx(SettingRow, { label: "Show seconds", hint: "On the pill", children:
      jsx(Toggle, { checked: draft.seconds === true, onChange: (on) => setDraft({ ...draft, seconds: on }) }) });
  });
  ctx.element("open", () => jsx("button", { type: "button", className: "clock-open",
    onClick: () => ctx.openSettings(), children: "C" }));
} };`,
};

/** A plugin whose tab throws as it draws, which costs it and nothing else. */
const broken: FixturePlugin = {
  name: "broken",
  manifest: { uses: { settingsTab: true } },
  source: `export default { setup(ctx) {
  ctx.settingsTab("Broken", () => { throw new Error("no"); });
} };`,
};

/** Stands in for the engine: what a re-inject would leave in `registry.js`. */
function saveToRegistry(
  payloadDir: string,
  settings: Readonly<Record<string, unknown>>,
  model: ModelSettings | null,
): void {
  const path = join(payloadDir, "registry.js");
  const source = readFileSync(path, "utf8")
    .replace(
      /^export const settings = .*;$/m,
      `export const settings = ${JSON.stringify(settings)};`,
    )
    .replace(/^export const model = .*;$/m, `export const model = ${JSON.stringify(model)};`);
  writeFileSync(path, source);
}

async function payloadOf(page: Page): Promise<SettingsPayload> {
  const href = (await page.locator(SAVE).getAttribute("href")) ?? "";
  const p = new URL(href).searchParams.get("p") ?? "";
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as SettingsPayload;
}

/** A click VS Code would never see, which the guard cancels and the confirmation still follows. */
async function clickSave(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    (document.querySelector(selector) as HTMLAnchorElement).click();
  }, SAVE);
}

async function openFromMenu(page: Page): Promise<void> {
  await page.waitForSelector(".rigline-pill");
  await page.click(".rigline-pill");
  await page.getByRole("menuitem", { name: /^Settings…/ }).click();
  await page.locator(SCREEN).waitFor();
}

const skip = await harnessSkipReason(VERSION);

describe.skipIf(skip !== null)(`the settings screen${skip ? ` (${skip})` : ""}`, () => {
  const boot = register(VERSION);
  type Booted = Awaited<ReturnType<typeof boot>>;

  /** The model list and what is live, as the extension host pushes them. */
  async function live(booted: Booted, setting: string, effort: string): Promise<void> {
    await booted.page.evaluate(
      (m) => {
        const harness = (window as unknown as { __harness?: { push(m: unknown): void } }).__harness;
        if (!harness) throw new Error("harness missing");
        harness.push(m);
      },
      {
        type: "request",
        channelId: "",
        requestId: "settings-state",
        request: {
          type: "update_state",
          config: { models: MODELS },
          state: {
            authStatus: {},
            experimentGates: {},
            openNewInTab: true,
            modelSetting: setting,
            settings: { effortLevel: effort },
          },
        },
      },
    );
  }

  it("saves the gate's mode and a default from Rigline's tab, and the gate is live once it lands", async () => {
    const booted = await boot({ save: COMPANION, model: OFF });
    const { page } = booted;
    try {
      await live(booted, "haiku", "medium");
      await openFromMenu(page);
      expect(await page.getByRole("tab", { name: "Rigline" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(await page.locator(SAVE).count()).toBe(0);

      await page.getByRole("radio", { name: "Every session" }).check();
      const chooser = page.getByRole("combobox", { name: "Default model" });
      expect(
        await chooser.locator("option").evaluateAll((all) => all.map((o) => o.textContent)),
      ).toEqual(["No default", "Opus 5.5", "Haiku 5.5"]);
      await chooser.selectOption("opus");
      // Only the efforts this model takes, and none chosen for it yet.
      const effort = page.getByRole("radiogroup", { name: "Effort" });
      expect(await effort.getByRole("radio").count()).toBe(2);
      await effort.getByText("high").click();
      await page.getByRole("img", { name: "unsaved changes" }).waitFor();

      expect(await payloadOf(page)).toEqual({
        v: 2,
        token: COMPANION.token,
        sections: {},
        rigline: {
          from: { model: OFF },
          to: {
            model: { requireChoice: "always", default: { model: "opus", effort: "high" } },
          },
        },
      });

      await clickSave(page);
      await page.getByText("Saving through the Rigline companion").waitFor();
      const always: ModelSettings = {
        requireChoice: "always",
        default: { model: "opus", effort: "high" },
      };
      saveToRegistry(booted.payloadDir, {}, always);
      await page.locator(SCREEN).getByText("Saved.").waitFor({ timeout: 5000 });
      expect(await page.locator(SAVE).count()).toBe(0);

      // Off at boot, so nothing was installed; the confirmed save put the gate in.
      await page.keyboard.press("Escape");
      await page.locator(SCREEN).waitFor({ state: "detached" });
      await page.click('div[contenteditable][role="textbox"]');
      await page.keyboard.type("held");
      await page.keyboard.press("Enter");
      await page.locator("[data-rigline-gate]:not([hidden])").waitFor();
      expect(await page.locator("[data-rigline-gate]").textContent()).toContain(
        "No model chosen for this session.",
      );
      expect((await booted.diagnostics()).errors).toEqual([]);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("merges a plugin's tab into the one Save, keeps drafts across tabs and closing, and tells the plugin once it lands", async () => {
    const booted = await boot({
      plugins: [clock],
      save: COMPANION,
      settings: { clock: { seconds: false, kept: "by hand" } },
    });
    const { page } = booted;
    try {
      await page.click(".clock-open");
      await page.locator(SCREEN).waitFor();
      expect(await page.getByRole("tab", { name: "Clock" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      await page.getByRole("switch", { name: "Show seconds" }).click();

      await page.getByRole("tab", { name: "Rigline" }).click();
      await page.getByRole("radio", { name: "Every session" }).check();
      await page.getByRole("tab", { name: "Clock" }).click();
      expect(
        await page.getByRole("switch", { name: "Show seconds" }).getAttribute("aria-checked"),
      ).toBe("true");

      const payload = await payloadOf(page);
      expect(payload.sections).toEqual({
        clock: {
          from: { seconds: false, kept: "by hand" },
          to: { seconds: true, kept: "by hand" },
        },
      });
      expect(payload.rigline?.to).toEqual({ model: { requireChoice: "always", default: null } });

      // Closing keeps the drafts, and the menu says so.
      await page.keyboard.press("Escape");
      await page.locator(SCREEN).waitFor({ state: "detached" });
      await page.click(".rigline-pill");
      await page.getByRole("menuitem", { name: /^Settings….*unsaved changes/ }).click();
      await page.locator(SAVE).waitFor();

      expect(
        await page.evaluate(() => (window as unknown as { __heard: unknown[] }).__heard),
      ).toEqual([{ seconds: false, kept: "by hand" }]);
      await clickSave(page);
      saveToRegistry(
        booted.payloadDir,
        { clock: { seconds: true, kept: "by hand" } },
        { requireChoice: "always", default: null },
      );
      await page.locator(SCREEN).getByText("Saved.").waitFor({ timeout: 5000 });
      expect(
        await page.evaluate(() => (window as unknown as { __heard: unknown[] }).__heard),
      ).toEqual([
        { seconds: false, kept: "by hand" },
        { seconds: true, kept: "by hand" },
      ]);
      expect(await page.getByRole("img", { name: "unsaved changes" }).count()).toBe(0);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("hears a save made elsewhere when the person comes back to the panel", async () => {
    const booted = await boot({ plugins: [clock], settings: { clock: { seconds: false } } });
    const { page } = booted;
    try {
      await page.waitForSelector(".clock-open");
      saveToRegistry(booted.payloadDir, { clock: { seconds: true } }, null);
      await page.evaluate(() => dispatchEvent(new Event("focus")));
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __heard: unknown[] }).__heard))
        .toEqual([{ seconds: false }, { seconds: true }]);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("leads a narrow panel through a list into the tab and back", async () => {
    const booted = await boot({ plugins: [clock], save: COMPANION });
    const { page } = booted;
    try {
      await page.setViewportSize({ width: 360, height: 700 });
      await openFromMenu(page);
      const rail = page.getByRole("tablist");
      const panel = page.getByRole("tabpanel");
      expect(await rail.isVisible()).toBe(true);
      expect(await panel.isVisible()).toBe(false);

      await page.getByRole("tab", { name: "Clock" }).click();
      await page.getByRole("switch", { name: "Show seconds" }).waitFor();
      expect(await rail.isVisible()).toBe(false);
      await page.getByRole("button", { name: "‹ All settings" }).click();
      expect(await rail.isVisible()).toBe(true);
    } finally {
      await booted.close();
    }
  }, 30000);

  it("costs a tab that throws its own plugin and nothing else", async () => {
    const booted = await boot({ plugins: [broken, clock], save: COMPANION });
    const { page } = booted;
    try {
      await openFromMenu(page);
      await page.getByRole("tab", { name: "Broken" }).click();
      await page.getByRole("tab", { name: "Broken" }).waitFor({ state: "detached" });
      const d = await booted.diagnostics();
      expect(d.plugins).toContainEqual(
        expect.objectContaining({ name: "broken", status: "error" }),
      );
      expect(d.plugins).toContainEqual({ name: "clock", status: "loaded" });
      await page.getByRole("tab", { name: "Clock" }).click();
      await page.getByRole("switch", { name: "Show seconds" }).waitFor();
    } finally {
      await booted.close();
    }
  }, 30000);
});
