/**
 * model-favourites against the real bundle: its built output and manifest, the chips and the status
 * pill over the model state the extension pushes, a click reaching the fake host as the panel's own
 * requests, and its tab in the settings screen editing the list through the one Save.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelSettings, SaveRecord, SettingsPayload } from "@rigline/plugin-api/internal";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const PLUGIN_DIR = new URL("../../../plugins/model-favourites/", import.meta.url);
const NAME = "model-favourites";

const COMPANION: SaveRecord = { token: "c".repeat(32), companion: true, scheme: "vscode" };
const SCREEN = '[role="dialog"].rigline-settings-frame';
const SAVE = `${SCREEN} a[href^="vscode://rigline.rigline/settings?p="]`;
const USUAL: ModelSettings = { requireChoice: "off", default: { model: "opus", effort: "high" } };

const pills = (element: string) => `[data-rigline-element="${NAME}/${element}"] .rigline-ui-pill`;

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

interface HarnessWindow {
  readonly __harness?: {
    readonly push: (message: unknown) => void;
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

/** The model list and what is live, on `update_state` as the extension host pushes them. */
async function live(page: Page, setting: string, effort: string | null): Promise<void> {
  await page.evaluate(
    (m) => {
      const harness = (window as unknown as HarnessWindow).__harness;
      if (!harness) throw new Error("harness missing");
      harness.push(m);
    },
    {
      type: "request",
      channelId: "",
      requestId: "favourites-state",
      request: {
        type: "update_state",
        config: { models: MODELS },
        state: {
          authStatus: {},
          experimentGates: {},
          openNewInTab: true,
          modelSetting: setting,
          settings: effort === null ? {} : { effortLevel: effort },
        },
      },
    },
  );
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

    it("draws the chips and the live model, and a click applies through the panel's own requests", async () => {
      const booted = await boot({
        plugins: [plugin as FixturePlugin],
        model: USUAL,
        settings: {
          [NAME]: { favourites: [{ model: "opus", effort: "high" }, { model: "haiku" }] },
        },
      });
      const { page } = booted;
      try {
        await live(page, "opus", "high");
        await expect
          .poll(() => texts(page, "chips"))
          .toEqual(["Opus 5.5 · high (default)", "Haiku 5.5"]);
        const chips = page.locator(pills("chips"));
        expect(await chips.nth(0).getAttribute("aria-current")).toBe("true");
        expect(await chips.nth(1).getAttribute("aria-current")).toBeNull();
        expect(await texts(page, "status")).toEqual(["Opus 5.5 · high"]);
        // The chips in the row, the pill in the footer beside the spacer.
        const zones = await page.evaluate(
          (selectors) =>
            selectors.map(
              (s) =>
                document
                  .querySelector(s)
                  ?.closest("[data-rigline-zone]")
                  ?.getAttribute("data-rigline-zone") ?? null,
            ),
          [pills("chips"), pills("status")],
        );
        expect(zones).toEqual(["rigRow", null]);

        // A real click on a chip is a choice: the model the panel's picker would send, and no
        // effort for a model that takes none.
        await chips.nth(1).click();
        await expect
          .poll(() => asked(page, "set_model"))
          .toEqual([{ type: "set_model", model: { value: "haiku" } }]);
        expect(await asked(page, "apply_settings")).toEqual([]);
        await live(page, "haiku", null);
        await expect.poll(() => chips.nth(1).getAttribute("aria-current")).toBe("true");

        // Off the list: what is live leads the row in the warning colour, and so does the pill.
        await live(page, "opus", "medium");
        await expect
          .poll(() => texts(page, "chips"))
          .toEqual(["Opus 5.5 · medium", "Opus 5.5 · high (default)", "Haiku 5.5"]);
        expect(await page.locator(`${pills("chips")}.rigline-ui-pill-warning`).count()).toBe(1);
        expect(await page.locator(`${pills("status")}.rigline-ui-pill-warning`).count()).toBe(1);

        // The pill's click is the default, model and effort both.
        await page.locator(pills("status")).click();
        await expect.poll(async () => (await asked(page, "set_model")).length).toBe(2);
        expect((await asked(page, "set_model"))[1]).toEqual({
          type: "set_model",
          model: { value: "opus" },
        });
        await expect
          .poll(() => asked(page, "apply_settings"))
          .toEqual([{ type: "apply_settings", settings: { effortLevel: "high" } }]);

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: NAME, status: "loaded" });
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("edits the list in its tab, through the one Save, and the chips follow once it lands", async () => {
      const section = {
        favourites: [{ model: "opus", effort: "high" }, { model: "haiku" }, "sonnet"],
        kept: "by hand",
      };
      const booted = await boot({
        plugins: [plugin as FixturePlugin],
        save: COMPANION,
        model: USUAL,
        settings: { [NAME]: section },
      });
      const { page } = booted;
      try {
        await live(page, "opus", "high");
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
          expect.stringMatching(/^Opus 5\.5 · high \(default\)/),
          expect.stringMatching(/^Haiku 5\.5/),
          expect.stringMatching(/^Not a favourite Rigline can read: "sonnet"/),
        ]);
        const current = screen.getByRole("button", { name: "Add current model (Opus 5.5 · high)" });
        expect(await current.isDisabled()).toBe(true);
        expect(await current.getAttribute("title")).toBe("Already a favourite");

        await rows.nth(2).getByRole("button", { name: "Remove favourite" }).click();
        await screen.getByRole("combobox", { name: "Add a favourite" }).selectOption("opus");
        const add = screen.getByRole("button", { name: "Add", exact: true });
        expect(await add.getAttribute("title")).toBe(
          "Choose an effort too, so the favourite sets both",
        );
        await screen.getByRole("radiogroup", { name: "Effort" }).getByText("medium").click();
        await add.click();
        await rows.nth(2).getByRole("button", { name: "Move favourite up" }).click();

        const to = {
          favourites: [
            { model: "opus", effort: "high" },
            { model: "opus", effort: "medium" },
            { model: "haiku" },
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
          .poll(() => texts(page, "chips"), { timeout: 5000 })
          .toEqual(["Opus 5.5 · high (default)", "Opus 5.5 · medium", "Haiku 5.5"]);

        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("sends a person with nothing set up to where it is set", async () => {
      const booted = await boot({ plugins: [plugin as FixturePlugin], save: COMPANION });
      const { page } = booted;
      try {
        await live(page, "opus", "high");
        await expect.poll(() => texts(page, "chips")).toEqual(["No favourites"]);
        // Nothing set up is nothing to be off.
        expect(await page.locator(".rigline-ui-pill-warning").count()).toBe(0);

        await page.locator(pills("status")).click();
        await page.locator(SCREEN).waitFor();
        expect(await page.getByRole("tab", { name: "Rigline" }).getAttribute("aria-selected")).toBe(
          "true",
        );
        await page.keyboard.press("Escape");
        await page.locator(SCREEN).waitFor({ state: "detached" });

        await page.locator(pills("chips")).click();
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
