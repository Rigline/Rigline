/**
 * The session-id plugin against the real webview bundle: the DOM tier `docs/plan.md`'s "next
 * session" notes ask for beside every first-party plugin, now that `packages/harness` can drive the
 * real bundle. Structure copied from `test/kernel.test.ts`, which was refactored onto `src/suite.ts`
 * for exactly this: one file per plugin so a deliberately-failing case never leaks a `console.error`
 * expectation into an unrelated test.
 *
 * Drives the plugin's own build output rather than an inline fixture source, so this test exercises
 * what `rigline build` actually produces (bundled, `@rigline/plugin-api` inlined) and not a
 * hand-written stand-in for it: `pnpm --filter rigline-session-id build` must have run first.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EMPTY_DECLARATIONS } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register } from "../src/suite.ts";

const VERSION = "2.1.270";

const DIST_PATH = fileURLToPath(
  new URL("../../../plugins/session-id/dist/index.js", import.meta.url),
);

const OPTIONAL_ANCHORS = [
  "footerMenuPopup",
  "footerMenuPopupRight",
  "footerMenuHeader",
  "footerMenuHeaderTitle",
  "footerMenuHeaderHint",
  "footerMenuDivider",
  "footerMenuItem",
  "footerMenuItemText",
  "footerMenuItemLabel",
  "footerMenuItemDescription",
] as const;

/** The built plugin as a fixture, or the reason it could not be loaded as one. Read at module scope,
 * same as `harnessSkipReason`, so a missing build skips with a reason rather than failing every
 * test in the file with the same stack trace. */
function loadSessionIdPlugin(): { plugin: FixturePlugin | null; reason: string | null } {
  try {
    return {
      plugin: {
        name: "session-id",
        // Mirrors plugins/session-id/rigline.json's `uses` block exactly: the harness bakes a
        // registry from data, the same shape `rigline install` would read from the manifest, but
        // does not parse the manifest file itself (packages/harness/src/payload.ts).
        manifest: {
          uses: {
            anchors: ["modelPill"],
            messages: ["io_message"],
            mount: true,
            session: true,
            optional: { ...EMPTY_DECLARATIONS, anchors: OPTIONAL_ANCHORS },
          },
        },
        source: readFileSync(DIST_PATH, "utf8"),
      },
      reason: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      plugin: null,
      reason: `plugins/session-id/dist/index.js is missing - run "pnpm --filter rigline-session-id build" first (${message})`,
    };
  }
}

const skipReason = await harnessSkipReason(VERSION);
const { plugin: sessionIdPlugin, reason: buildReason } = skipReason
  ? { plugin: null, reason: null }
  : loadSessionIdPlugin();
const skip = skipReason ?? buildReason;

describe.skipIf(skip !== null)(
  `session-id plugin against the real bundle${skip ? ` (${skip})` : ""}`,
  () => {
    const boot = register(VERSION);

    it("mounts the badge after the real model pill, stamped and loaded without error", async () => {
      const booted = await boot({ plugins: [sessionIdPlugin as FixturePlugin] });
      try {
        // A freshly-mounted badge holds only its label span, painted synchronously to the dimmed
        // placeholder - so it exists before it has any text. Waiting on the id alone risks
        // Playwright's default waitForSelector treating a still-empty element as hidden; wait
        // instead for the placeholder (or whatever supersedes it) to actually be there.
        await booted.page.waitForSelector("#rigline-session-id", { state: "attached" });
        await booted.page.waitForFunction(() => {
          const el = document.getElementById("rigline-session-id");
          return el !== null && (el.textContent?.length ?? 0) > 0;
        });

        const info = await booted.page.evaluate(() => {
          const badge = document.getElementById("rigline-session-id");
          const pill = document.getElementsByClassName("modelPill_gGYT1w")[0] ?? null;
          return {
            mountAttr: badge?.getAttribute("data-rigline-mount") ?? null,
            isNextSibling: pill !== null && pill.nextElementSibling === badge,
            text: badge?.textContent ?? null,
            title: badge?.title ?? null,
          };
        });
        expect(info.mountAttr).toBe("session-id");
        expect(info.isNextSibling).toBe(true);
        expect(info.text).not.toBe("");
        expect(info.title).not.toBe("");

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: "session-id", status: "loaded" });
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("opens a pop-up on click, borrowing the footer's own menu styling", async () => {
      const booted = await boot({ plugins: [sessionIdPlugin as FixturePlugin] });
      try {
        await booted.page.waitForFunction(() => {
          const el = document.getElementById("rigline-session-id");
          return el !== null && (el.textContent?.length ?? 0) > 0;
        });
        await booted.page.click("#rigline-session-id");

        const info = await booted.page.evaluate(() => {
          const badge = document.getElementById("rigline-session-id");
          // The pop-up is the badge's second child: the label span is always first, and openPopup()
          // appends the pop-up straight onto the badge so it is torn down for free with it.
          const popup = badge?.children[1] ?? null;
          return {
            found: popup !== null,
            // footerMenuPopup is a real, present anchor on 2.1.270, so this run should take the
            // borrowed-styling branch rather than the no-anchor fallback.
            hasBorrowedClass: popup?.className.includes("menuPopup") ?? false,
            rowCount: popup?.querySelectorAll("button, [class*=menuHeader]").length ?? 0,
          };
        });
        expect(info.found).toBe(true);
        expect(info.hasBorrowedClass).toBe(true);
        expect(info.rowCount).toBeGreaterThan(0);

        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
