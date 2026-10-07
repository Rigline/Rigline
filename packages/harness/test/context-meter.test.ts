/**
 * context-meter against the real bundle: its built output and manifest, the host asking the fake
 * extension for the context's usage (D121), and records pushed down the app's channel.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const PLUGIN_DIR = new URL("../../../plugins/context-meter/", import.meta.url);

const PERCENT = '[data-rigline-element="context-meter/percent"] .rigline-ui-pill';
const BAR = '[data-rigline-element="context-meter/bar"] [role="meter"]';

function loadPlugin(): { plugin: FixturePlugin | null; reason: string | null } {
  try {
    const manifest = JSON.parse(readFileSync(new URL("rigline.json", PLUGIN_DIR), "utf8"));
    return {
      plugin: {
        name: "context-meter",
        manifest: { surfaces: manifest.surfaces, uses: manifest.uses, elements: manifest.elements },
        source: readFileSync(fileURLToPath(new URL("dist/index.js", PLUGIN_DIR)), "utf8"),
      },
      reason: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      plugin: null,
      reason: `plugins/context-meter/dist/index.js is missing - run "pnpm build" first (${message})`,
    };
  }
}

/** One CLI record down the app's channel. */
function pushRecord(page: Page, message: unknown): Promise<void> {
  return page.evaluate((m) => {
    const harness = (window as unknown as { __harness?: { pushRecord: (m: unknown) => void } })
      .__harness;
    if (!harness) throw new Error("harness missing");
    harness.pushRecord(m);
  }, message);
}

function waitForPercent(page: Page, text: string): Promise<unknown> {
  return page.waitForFunction(
    ({ selector, text }) => document.querySelector(selector)?.textContent === text,
    { selector: PERCENT, text },
  );
}

function asks(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __harness: { sent: { request?: { type?: string } }[] } }
      ).__harness.sent.filter((m) => m.request?.type === "get_context_usage").length,
  );
}

const skipReason = await harnessSkipReason(VERSION);
const { plugin, reason: buildReason } = skipReason ? { plugin: null, reason: null } : loadPlugin();
const skip = skipReason ?? buildReason;

describe.skipIf(skip !== null)(
  `context-meter against the real bundle${skip ? ` (${skip})` : ""}`,
  () => {
    const boot = register(VERSION);

    it("asks at launch, places both elements, follows the stream, and asks again after a compaction", async () => {
      const booted = await boot({ plugins: [plugin as FixturePlugin] });
      try {
        // This first reading has missed under load with no cause found, so a miss says what the
        // host sent and what the page shows.
        await waitForPercent(booted.page, "15%").catch(async (e) => {
          const d = await booted.diagnostics();
          const sent = (await booted.sent()).map((m) => m.request?.type ?? m.type);
          const shown = await booted.page.evaluate(
            (selector) => document.querySelector(selector)?.outerHTML ?? "nothing",
            PERCENT,
          );
          throw new Error(
            `${e instanceof Error ? e.message : e}\nasked ${d.asked}; errors ${JSON.stringify(d.errors)}; ` +
              `sent ${sent.join(", ")}; the percentage is ${shown}`,
          );
        });

        const placed = await booted.page.evaluate(
          ({ percent, bar }) => ({
            percentInFooter:
              document.querySelector(percent)?.closest(".inputFooter_gGYT1w") !== null,
            barInRow: document.querySelector(bar)?.closest('[data-rigline-zone="rigRow"]') !== null,
            barValue: document.querySelector(bar)?.getAttribute("aria-valuenow") ?? null,
          }),
          { percent: PERCENT, bar: BAR },
        );
        expect(placed).toEqual({ percentInFooter: true, barInRow: true, barValue: "15" });
        expect(await asks(booted.page)).toBe(1);

        await pushRecord(booted.page, {
          type: "stream_event",
          event: {
            type: "message_start",
            message: {
              id: "msg_meter",
              model: "claude-opus-5-5",
              usage: { input_tokens: 120_000, output_tokens: 1 },
            },
          },
        });
        await waitForPercent(booted.page, "75%");
        const title = await booted.page.evaluate(
          (selector) => (document.querySelector(selector) as HTMLElement | null)?.title ?? "",
          PERCENT,
        );
        expect(title).toContain("75% of the way to auto-compact");

        await pushRecord(booted.page, {
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: { trigger: "manual" },
        });
        await waitForPercent(booted.page, "15%");
        expect(await asks(booted.page)).toBe(2);

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: "context-meter", status: "loaded" });
        expect(d.asked).toBe(2);
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
