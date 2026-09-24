/**
 * The session-id plugin against the real webview bundle.
 *
 * Drives the plugin's own build output and its own manifest rather than an inline fixture, so this
 * tests what `rigline build` produces and what `install` would bake: `pnpm build` must have run.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const PLUGIN_DIR = new URL("../../../plugins/session-id/", import.meta.url);

/** Where the short id renders: the slot the host places before the footer spacer. */
const SHORT_ID = '[data-rigline-slot="session-id/short-id"] .rigline-ui-pill';

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
    const manifest = JSON.parse(readFileSync(new URL("rigline.json", PLUGIN_DIR), "utf8"));
    return {
      plugin: {
        name: "session-id",
        manifest: { uses: manifest.uses, elements: manifest.elements },
        source: readFileSync(fileURLToPath(new URL("dist/index.js", PLUGIN_DIR)), "utf8"),
      },
      reason: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      plugin: null,
      reason: `plugins/session-id/dist/index.js is missing - run "pnpm build" first (${message})`,
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

    it("places the short id before the real footer spacer and Rigline's pill, with the rest off", async () => {
      const booted = await boot({ plugins: [sessionIdPlugin as FixturePlugin] });
      try {
        await booted.page.waitForSelector(SHORT_ID);

        // The spacer rather than the model pill, because the footer measures its children and moves
        // the pill out of itself at its widest stage (D54); Rigline's pill sits between, last by order.
        const info = await booted.page.evaluate((selector) => {
          const pill = document.querySelector(selector) as HTMLElement | null;
          const slot = pill?.closest("[data-rigline-slot]") ?? null;
          const next = slot?.nextElementSibling ?? null;
          return {
            owner: slot?.getAttribute("data-rigline-mount") ?? null,
            inFooter: slot?.parentElement?.classList.contains("inputFooter_gGYT1w") ?? false,
            beforeRig: next?.getAttribute("data-rigline-mount") === "rigline",
            thenSpacer: next?.nextElementSibling?.classList.contains("spacer_gGYT1w") ?? false,
            text: pill?.textContent ?? null,
            title: pill?.title ?? null,
            others: document.querySelectorAll(
              '[data-rigline-element="session-id/full-id"], [data-rigline-element="session-id/address"]',
            ).length,
          };
        }, SHORT_ID);
        expect(info).toMatchObject({
          owner: "session-id",
          inFooter: true,
          beforeRig: true,
          thenSpacer: true,
          others: 0,
        });
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

    it("keeps the session id in the pill and the address in its tooltip, once one is observed", async () => {
      // A messaging address is as wide as somebody's worktree directory or Remote Control session
      // title, and the pill has room for a token, so an observed address must leave the pill alone.
      const booted = await boot({ plugins: [sessionIdPlugin as FixturePlugin] });
      try {
        await booted.page.waitForSelector(SHORT_ID);
        const read = () =>
          booted.page.evaluate((selector) => {
            const pill = document.querySelector(selector) as HTMLElement | null;
            return { text: pill?.textContent ?? null, title: pill?.title ?? null };
          }, SHORT_ID);
        const before = await read();

        await pushAddress(booted.page);
        await booted.page.waitForFunction(
          (selector) =>
            (document.querySelector(selector) as HTMLElement | null)?.title.includes("fa26a5"),
          SHORT_ID,
        );

        const after = await read();
        expect(after.text).toBe(before.text);
        expect(after.text).not.toContain("abcd-1234-ticket-work-46");
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
        await page.waitForSelector(SHORT_ID);
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
