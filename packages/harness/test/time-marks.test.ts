/**
 * time-marks against the real 2.1.270 bundle: the same manifest and the same built output
 * `rigline build` produces, run through the DOM tier so "the plugin loads and decorates" is proven
 * against React's real fiber tree rather than a hand-written stand-in. See test/kernel.test.ts for
 * the kernel's own behaviour and the scaffolding this reuses; this file is the plugin's own, per
 * the plan's phase 3 note that each first-party plugin gets a harness test as well as a live check.
 *
 * Reads plugins/time-marks/rigline.json and dist/index.js straight off disk rather than declaring
 * an inline fixture source, so this test exercises the actual artifact `pnpm build` produces —
 * including its real manifest declarations, gated through the same `validateManifest` the
 * installer uses — not a simplified copy that could drift from it.
 *
 * Skipped with a reason, rather than failed, when the corpus or a launchable Chromium is missing
 * (src/suite.ts's harnessSkipReason) or when `pnpm build` has not produced dist/index.js yet: a
 * fresh clone that has not built is not a failure either.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const PLUGIN_DIR = fileURLToPath(new URL("../../../plugins/time-marks/", import.meta.url));
const MANIFEST_PATH = `${PLUGIN_DIR}rigline.json`;
const ENTRY_PATH = `${PLUGIN_DIR}dist/index.js`;

/** The real plugin, read off disk, or null when it has not been built yet. */
function loadTimeMarks(): FixturePlugin | null {
  if (!existsSync(ENTRY_PATH)) return null;
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const { manifest, problems } = validateManifest(raw, "time-marks");
  if (manifest === null) {
    throw new Error(`plugins/time-marks/rigline.json is invalid: ${problems.join("; ")}`);
  }
  return {
    name: manifest.name,
    source: readFileSync(ENTRY_PATH, "utf8"),
    manifest: { surfaces: manifest.surfaces, uses: manifest.uses },
  };
}

const timeMarks = loadTimeMarks();
const skipReason =
  (await harnessSkipReason(VERSION)) ??
  (timeMarks === null ? "plugins/time-marks/dist/index.js is missing: run pnpm build first" : null);

describe.skipIf(skipReason !== null)(
  `time-marks against the real bundle${skipReason ? ` (${skipReason})` : ""}`,
  () => {
    const boot = register(VERSION);

    it("marks every row, divides only the first, styles nothing narrower, and loads clean", async () => {
      const booted = await boot({ plugins: [timeMarks as FixturePlugin] });
      try {
        // An absolutely-positioned, zero-content marker node reads as hidden to Playwright's
        // default waitForSelector — that cost an hour to learn — so wait on the DOM directly
        // rather than on visibility, the same way kernel.test.ts's transcript test does.
        await booted.page.waitForFunction(() => {
          const rows = [...document.getElementsByClassName("message_07S1Yg")];
          return (
            rows.length === 2 &&
            rows.every((row) => row.getElementsByClassName("rigline-tm-time").length === 1)
          );
        });

        // The fake host pushes both messages with the same timestamp (src/page.ts), so the gap
        // between them is zero: only the first entry has no earlier entry to compare against, and
        // only it should carry the opening divider lead.
        const hasLead = await booted.page.evaluate(() =>
          [...document.getElementsByClassName("message_07S1Yg")].map(
            (row) => row.getElementsByClassName("rigline-tm-lead").length > 0,
          ),
        );
        expect(hasLead).toEqual([true, false]);

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: "time-marks", status: "loaded" });

        const styleText = await booted.page.evaluate(
          () =>
            document.querySelector('style[data-rigline-style="time-marks"]')?.textContent ?? null,
        );
        expect(styleText).toBeTruthy();
        for (const forbidden of [
          "padding-right",
          "padding-left",
          "width",
          "max-width",
          "margin-right",
        ]) {
          expect(styleText).not.toContain(forbidden);
        }

        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("removes every mark from the menu's toggle, and puts them back", async () => {
      const booted = await boot({ plugins: [timeMarks as FixturePlugin] });
      const { page } = booted;
      const marks = (): Promise<number> =>
        page.evaluate(() => document.getElementsByClassName("rigline-tm-time").length);
      try {
        await page.waitForFunction(
          () => document.getElementsByClassName("rigline-tm-time").length === 2,
        );
        await page.click(".rigline-pill");
        const toggle = page.getByRole("menuitemcheckbox", { name: /Time markers/ });
        expect(await toggle.getAttribute("aria-checked")).toBe("true");

        await toggle.click();
        expect(await toggle.getAttribute("aria-checked")).toBe("false");
        expect(await marks()).toBe(0);

        await toggle.click();
        await page.waitForFunction(
          () => document.getElementsByClassName("rigline-tm-time").length === 2,
        );
        expect(await toggle.getAttribute("aria-checked")).toBe("true");
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
