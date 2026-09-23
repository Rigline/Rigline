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
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const DIST_PATH = fileURLToPath(
  new URL("../../../plugins/session-id/dist/index.js", import.meta.url),
);

/** A ListAgents result carrying this session's own address, in the CLI's exact wording. */
async function pushAddress(page: Page): Promise<void> {
  await page.evaluate(() => {
    const push = (window as unknown as { __harness?: { push: (m: unknown) => void } }).__harness
      ?.push;
    if (!push) throw new Error("harness push missing");
    push({
      type: "io_message",
      channelId: "harness-address-channel",
      message: {
        type: "user",
        uuid: "addr-1",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "addr-call",
              content: "This session is abcd-1234-ticket-work-46 [fa26a5] - the name others use.",
            },
          ],
        },
      },
    });
  });
}

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
            anchors: ["footerSpacer"],
            messages: ["io_message"],
            mount: true,
            session: true,
            menu: true,
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

    it("mounts the badge before the real footer spacer, stamped and loaded without error", async () => {
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

        // The spacer, and the badge immediately before it. Anchoring to the model pill is what this
        // replaced, and the reason is a property of the real bundle rather than of this plugin: the
        // footer measures its element children to pick a fit stage and moves the pill out of itself
        // at the widest one, so a badge anchored to the pill leaves and re-enters the container
        // being measured and oscillates against the measurement (D54). Asserting the spacer here is
        // what would notice the anchor being quietly moved back. Rigline's own pill sits between the
        // two, because the host places it after every plugin.
        const info = await booted.page.evaluate(() => {
          const badge = document.getElementById("rigline-session-id");
          const spacer = document.getElementsByClassName("spacer_gGYT1w")[0] ?? null;
          const pill = spacer?.previousElementSibling ?? null;
          return {
            mountAttr: badge?.getAttribute("data-rigline-mount") ?? null,
            isPreviousSibling:
              pill?.getAttribute("data-rigline-mount") === "rigline" &&
              pill.previousElementSibling === badge,
            inFooter: badge?.parentElement?.classList.contains("inputFooter_gGYT1w") ?? false,
            text: badge?.textContent ?? null,
            title: badge?.title ?? null,
          };
        });
        expect(info.mountAttr).toBe("session-id");
        expect(info.isPreviousSibling).toBe(true);
        expect(info.inFooter).toBe(true);
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

    it("keeps the session id in the pill and the address in the menu, once one is observed", async () => {
      // The behaviour this plugin was changed to have, pinned against the real bundle. A messaging
      // address is as wide as somebody's worktree directory or Remote Control session title, and
      // the pill has room for a token, so an observed address must reach the menu and leave the
      // pill alone. It used to take the pill, which is how a 24-character name ended up in the
      // composer footer.
      const booted = await boot({ plugins: [sessionIdPlugin as FixturePlugin] });
      try {
        await booted.page.waitForSelector("#rigline-session-id", { state: "attached" });
        await booted.page.waitForFunction(() => {
          const el = document.getElementById("rigline-session-id");
          return el !== null && (el.textContent?.length ?? 0) > 0;
        });
        const before = await booted.page.evaluate(
          () => document.getElementById("rigline-session-id")?.textContent ?? null,
        );

        await pushAddress(booted.page);

        const after = await booted.page.evaluate(() => {
          const badge = document.getElementById("rigline-session-id");
          return { text: badge?.textContent ?? null, title: badge?.title ?? null };
        });
        // Unchanged, and specifically not the address that just crossed the bus.
        expect(after.text).toBe(before);
        expect(after.text).not.toContain("abcd-1234-ticket-work-46");
        expect(after.text).not.toContain("fa26a5");
        // The address did land, though — the tooltip and the menu are where it belongs.
        expect(after.title).toContain("abcd-1234-ticket-work-46 [fa26a5]");

        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("lists every identifier under Session identifiers in Rigline's menu, copying on choice", async () => {
      const booted = await boot({ plugins: [sessionIdPlugin as FixturePlugin] });
      const { page } = booted;
      try {
        await page.waitForSelector("#rigline-session-id", { state: "attached" });
        await pushAddress(page);
        await page.click(".rigline-pill");
        await page.click("text=Session identifiers");

        // The harness host never assigns a session id, so its rows are a note in their slot.
        const address = page.getByRole("menuitem", { name: /Messaging address/ });
        expect(await address.textContent()).toContain("abcd-1234-ticket-work-46 [fa26a5]");
        expect(await page.isVisible("text=No session id yet")).toBe(true);

        await address.click();
        expect(await page.isVisible(".rigline-menu")).toBe(true);
        expect(await address.textContent()).toMatch(/copied|copy failed/);

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: "session-id", status: "loaded" });
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
