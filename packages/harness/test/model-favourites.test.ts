/**
 * model-favourites against the real bundle: its built output and manifest, the segmented pill and
 * the default over the panel's own session, a click moving Claude Code's own picker with it, and
 * its tab in the settings screen editing the list through the one Save.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelSettings, SaveRecord, SettingsPayload } from "@rigline/plugin-api/internal";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { AppModels } from "../src/page.ts";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const PLUGIN_DIR = new URL("../../../plugins/model-favourites/", import.meta.url);
const NAME = "model-favourites";

const COMPANION: SaveRecord = { token: "c".repeat(32), companion: true, scheme: "vscode" };
const SCREEN = '[role="dialog"].rigline-settings-frame';
const SAVE = `${SCREEN} a[href^="vscode://rigline.rigline/settings?p="]`;
const USUAL: ModelSettings = { requireChoice: "off", default: { model: "opus", effort: "xhigh" } };
const PICKER = '.modelPill_gGYT1w[role="combobox"]';

const pills = (element: string) => `[data-rigline-element="${NAME}/${element}"] .rigline-ui-pill`;

const EFFORTS = ["low", "medium", "high", "xhigh"];
const MODELS = [
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    supportsEffort: true,
    supportedEffortLevels: EFFORTS,
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5-5",
    displayName: "Sonnet",
    supportsEffort: true,
    supportedEffortLevels: EFFORTS,
  },
];

/** Leo's session on 2026-10-17, on which the first build went wrong. */
const ON_OPUS: AppModels = { list: MODELS, setting: "opus", effort: "xhigh" };
const FAVOURITES = [
  { model: "opus", effort: "xhigh" },
  { model: "opus", effort: "low" },
  { model: "sonnet", effort: "medium" },
];

interface HarnessWindow {
  readonly __harness?: {
    readonly sent: readonly { readonly type?: string; readonly request?: unknown }[];
  };
}

function loadPlugin(): { plugin: FixturePlugin | null; reason: string | null } {
  try {
    const manifest = JSON.parse(readFileSync(new URL("rigline.json", PLUGIN_DIR), "utf8"));
    return {
      plugin: {
        name: NAME,
        manifest: { surfaces: manifest.surfaces, uses: manifest.uses, elements: manifest.elements },
        source: readFileSync(fileURLToPath(new URL("dist/index.js", PLUGIN_DIR)), "utf8"),
      },
      reason: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      plugin: null,
      reason: `plugins/${NAME}/dist/index.js is missing - run "pnpm build" first (${message})`,
    };
  }
}

/** Every request of `type` the panel has sent the fake host, as the request it carried. */
function asked(page: Page, type: string): Promise<unknown[]> {
  return page.evaluate(
    (type) =>
      ((window as unknown as HarnessWindow).__harness?.sent ?? [])
        .filter(
          (m) => m.type === "request" && (m.request as { type?: unknown } | null)?.type === type,
        )
        .map((m) => m.request),
    type,
  );
}

/** As rendered, in order: `innerText` keeps the spaces the pill's flex layout would drop. */
function texts(page: Page, element: string): Promise<string[]> {
  return page.evaluate(
    (selector) => [...document.querySelectorAll<HTMLElement>(selector)].map((p) => p.innerText),
    pills(element),
  );
}

/** Which of an element's pills is drawn as the one live. */
function current(page: Page, element: string): Promise<boolean[]> {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)].map(
        (p) => p.getAttribute("aria-current") === "true",
      ),
    pills(element),
  );
}

/** What Claude Code's own model pill says. */
function picker(page: Page): Promise<string> {
  return page.evaluate((selector) => document.querySelector(selector)?.textContent ?? "", PICKER);
}

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

const skipReason = await harnessSkipReason(VERSION);
const { plugin, reason: buildReason } = skipReason ? { plugin: null, reason: null } : loadPlugin();
const skip = skipReason ?? buildReason;

describe.skipIf(skip !== null)(
  `model-favourites against the real bundle${skip ? ` (${skip})` : ""}`,
  () => {
    const boot = register(VERSION);

    it("moves Claude Code's own picker with each click, and draws what it shows", async () => {
      const booted = await boot({
        plugins: [plugin as FixturePlugin],
        model: USUAL,
        appModels: ON_OPUS,
        settings: { [NAME]: { favourites: FAVOURITES } },
      });
      const { page } = booted;
      try {
        // One pill: each model named once, then its favourites, the model lit with its effort.
        await expect
          .poll(() => texts(page, "favourites"))
          .toEqual(["Opus 5.5", "xhigh", "low", "Sonnet 5.5", "medium"]);
        expect(await current(page, "favourites")).toEqual([true, true, false, false, false]);
        expect(
          await page.locator(`[data-rigline-element="${NAME}/favourites"] [role="group"]`).count(),
        ).toBe(1);
        expect(await texts(page, "default")).toEqual(["Opus 5.5 · xhigh"]);
        expect(await current(page, "default")).toEqual([true]);
        expect(await picker(page)).toMatch(/^Opus 5\.5/);

        // An effort on the same model: what did nothing before. The model stays lit.
        const segment = (i: number) => page.locator(pills("favourites")).nth(i);
        await segment(2).click();
        await expect
          .poll(() => current(page, "favourites"))
          .toEqual([true, false, true, false, false]);
        expect(await picker(page)).toMatch(/^Opus 5\.5.*Low/i);
        expect(await current(page, "default")).toEqual([false]);

        // The model's own segment applies the favourite beside it.
        await segment(0).click();
        await expect
          .poll(() => current(page, "favourites"))
          .toEqual([true, true, false, false, false]);
        expect(await picker(page)).toMatch(/^Opus 5\.5.*Extra high/i);

        // Another model: Claude Code's picker follows, and so do both its segments.
        await segment(3).click();
        await expect.poll(() => picker(page)).toMatch(/^Sonnet 5\.5.*Medium/i);
        expect(await current(page, "favourites")).toEqual([false, false, false, true, true]);
        // The panel's own requests, on its own channel, as its picker would send them.
        expect((await asked(page, "set_model")).at(-1)).toMatchObject({
          model: { value: "sonnet" },
        });
        expect((await asked(page, "apply_settings")).at(-1)).toEqual({
          type: "apply_settings",
          settings: { effortLevel: "medium" },
        });

        // The default pill applies the default, and says so by being live.
        await page.locator(pills("default")).click();
        await expect.poll(() => current(page, "default")).toEqual([true]);
        expect(await picker(page)).toMatch(/^Opus 5\.5/);
        expect(await current(page, "favourites")).toEqual([true, true, false, false, false]);

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: NAME, status: "loaded" });
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("edits the list in its tab, through the one Save, and the pill follows once it lands", async () => {
      const section = {
        favourites: [
          { model: "opus", effort: "high" },
          { model: "sonnet", effort: "low" },
          "haiku",
        ],
        kept: "by hand",
      };
      const booted = await boot({
        plugins: [plugin as FixturePlugin],
        save: COMPANION,
        model: USUAL,
        appModels: { list: MODELS, setting: "opus", effort: "high" },
        settings: { [NAME]: section },
      });
      const { page } = booted;
      try {
        await page.waitForSelector(".rigline-pill");
        await page.click(".rigline-pill");
        await page.getByRole("menuitem", { name: "Model favourites…" }).click();
        await page.locator(SCREEN).waitFor();
        expect(
          await page.getByRole("tab", { name: "Model favourites" }).getAttribute("aria-selected"),
        ).toBe("true");

        const screen = page.locator(SCREEN);
        const rows = screen.getByRole("list", { name: "Favourites" }).getByRole("listitem");
        expect(await rows.allInnerTexts()).toEqual([
          expect.stringMatching(/^Opus 5\.5 · high/),
          expect.stringMatching(/^Sonnet 5\.5 · low/),
          expect.stringMatching(/^Not a favourite Rigline can read: "haiku"/),
        ]);
        const live = screen.getByRole("button", { name: "Add current model (Opus 5.5 · high)" });
        expect(await live.isDisabled()).toBe(true);
        expect(await live.getAttribute("title")).toBe("Already a favourite");

        await rows.nth(2).getByRole("button", { name: "Remove favourite" }).click();
        await screen.getByRole("combobox", { name: "Add a favourite" }).selectOption("opus");
        const add = screen.getByRole("button", { name: "Add", exact: true });
        expect(await add.getAttribute("title")).toBe(
          "Choose an effort too, so the favourite sets both",
        );
        await screen.getByRole("radiogroup", { name: "Effort" }).getByText("xhigh").click();
        await add.click();
        await rows.nth(2).getByRole("button", { name: "Move favourite up" }).click();

        const to = {
          favourites: [
            { model: "opus", effort: "high" },
            { model: "opus", effort: "xhigh" },
            { model: "sonnet", effort: "low" },
          ],
          kept: "by hand",
        };
        expect((await payloadOf(page)).sections).toEqual({ [NAME]: { from: section, to } });

        await page.evaluate((selector) => {
          (document.querySelector(selector) as HTMLAnchorElement).click();
        }, SAVE);
        await page.locator(SCREEN).waitFor({ state: "detached" });
        saveToRegistry(booted.payloadDir, { [NAME]: to }, USUAL);
        await expect
          .poll(() => texts(page, "favourites"), { timeout: 5000 })
          .toEqual(["Opus 5.5", "high", "xhigh", "Sonnet 5.5", "low"]);

        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("sends a person with nothing set up to where it is set", async () => {
      const booted = await boot({
        plugins: [plugin as FixturePlugin],
        save: COMPANION,
        appModels: ON_OPUS,
      });
      const { page } = booted;
      try {
        await expect.poll(() => texts(page, "favourites")).toEqual(["No favourites"]);
        expect(await texts(page, "default")).toEqual(["No default"]);

        await page.locator(pills("default")).click();
        await page.locator(SCREEN).waitFor();
        expect(await page.getByRole("tab", { name: "Rigline" }).getAttribute("aria-selected")).toBe(
          "true",
        );
        await page.keyboard.press("Escape");
        await page.locator(SCREEN).waitFor({ state: "detached" });

        await page.locator(pills("favourites")).click();
        await page.locator(SCREEN).waitFor();
        expect(
          await page.getByRole("tab", { name: "Model favourites" }).getAttribute("aria-selected"),
        ).toBe("true");
        // The default is Rigline's, so the tab points there rather than setting it.
        await page.getByRole("button", { name: "Change in Rigline's settings" }).click();
        await expect
          .poll(() => page.getByRole("tab", { name: "Rigline" }).getAttribute("aria-selected"))
          .toBe("true");
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);
  },
);
