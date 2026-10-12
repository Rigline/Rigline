/**
 * usage-meter against the real bundle: its built output and manifest, a `result` record down the
 * app's channel, and the usage windows the extension pushes to every panel (D129).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const PLUGIN_DIR = new URL("../../../plugins/usage-meter/", import.meta.url);

const pill = (element: string) =>
  `[data-rigline-element="usage-meter/${element}"] .rigline-ui-pill`;

function loadPlugin(): { plugin: FixturePlugin | null; reason: string | null } {
  try {
    const manifest = JSON.parse(readFileSync(new URL("rigline.json", PLUGIN_DIR), "utf8"));
    return {
      plugin: {
        name: "usage-meter",
        manifest: { surfaces: manifest.surfaces, uses: manifest.uses, elements: manifest.elements },
        source: readFileSync(fileURLToPath(new URL("dist/index.js", PLUGIN_DIR)), "utf8"),
      },
      reason: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      plugin: null,
      reason: `plugins/usage-meter/dist/index.js is missing - run "pnpm build" first (${message})`,
    };
  }
}

/** One CLI record down the app's channel, or any message as the extension would send it. */
function send(page: Page, how: "pushRecord" | "push", message: unknown): Promise<void> {
  return page.evaluate(
    ({ how, message }) => {
      const harness = (window as unknown as { __harness?: Record<string, (m: unknown) => void> })
        .__harness;
      if (!harness) throw new Error("harness missing");
      harness[how]?.(message);
    },
    { how, message },
  );
}

function waitForText(page: Page, element: string, text: string): Promise<unknown> {
  return page.waitForFunction(
    ({ selector, text }) => document.querySelector(selector)?.textContent === text,
    { selector: pill(element), text },
  );
}

const skipReason = await harnessSkipReason(VERSION);
const { plugin, reason: buildReason } = skipReason ? { plugin: null, reason: null } : loadPlugin();
const skip = skipReason ?? buildReason;

describe.skipIf(skip !== null)(
  `usage-meter against the real bundle${skip ? ` (${skip})` : ""}`,
  () => {
    const boot = register(VERSION);

    it("places all three pills, then reads the session's cost and the plan's windows", async () => {
      const booted = await boot({ plugins: [plugin as FixturePlugin] });
      try {
        await waitForText(booted.page, "cost", "$–");
        await waitForText(booted.page, "five-hour", "5h –%");
        await waitForText(booted.page, "seven-day", "7d –%");
        const inRow = await booted.page.evaluate(
          (selectors) =>
            selectors.every(
              (s) => document.querySelector(s)?.closest('[data-rigline-zone="rigRow"]') !== null,
            ),
          ["cost", "five-hour", "seven-day"].map(pill),
        );
        expect(inRow).toBe(true);

        await send(booted.page, "pushRecord", {
          type: "result",
          subtype: "success",
          total_cost_usd: 0.4213,
          modelUsage: { "claude-opus-5-5": { costUSD: 0.4213, inputTokens: 12 } },
        });
        await waitForText(booted.page, "cost", "$0.42");

        const resetsAt = Math.floor(Date.now() / 1000) + 3600;
        await send(booted.page, "push", {
          type: "request",
          channelId: "",
          requestId: "usage-1",
          request: {
            type: "panel_usage_update",
            unifiedWindows: {
              five_hour: { utilization: 0.42, resetsAt },
              seven_day: { utilization: 0.18, resetsAt: resetsAt + 86_400 },
            },
          },
        });
        await waitForText(booted.page, "five-hour", "5h 42%");
        await waitForText(booted.page, "seven-day", "7d 18%");
        const title = await booted.page.evaluate(
          (selector) => (document.querySelector(selector) as HTMLElement | null)?.title ?? "",
          pill("five-hour"),
        );
        expect(title).toMatch(/^Five-hour limit: 42% used, resets /);

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: "usage-meter", status: "loaded" });
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
