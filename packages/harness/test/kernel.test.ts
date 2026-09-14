/**
 * Host and plugin DOM behaviour against the real webview bundle, headless, no VS Code: the third
 * verification tier docs/host.md's "Verification" section names.
 *
 * Skips with a reason, rather than failing, when the corpus snapshot or a launchable Chromium is
 * absent, so a fresh clone without either is not blocked. Each test prepares its own payload (only
 * the fixture plugins it needs) and navigates its own page, so a plugin deliberately made to fail
 * (undeclared, stale) cannot leak an expected console.error into an unrelated test's assertions;
 * one browser is shared across the suite.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_DECLARATIONS } from "@rigline/plugin-api";
import { type Browser, type ConsoleMessage, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missing, versionDir } from "../../core/test/corpus.ts";
import { type FixturePlugin, preparePayload, type RemovedIdentifiers } from "../src/payload.ts";
import { type Harness, startHarness } from "../src/server.ts";

const VERSION = "2.1.270";

/** Try launching Chromium once; the failure reason, or null when it launched fine. */
async function chromiumLaunchFailure(): Promise<string | null> {
  try {
    const probe = await chromium.launch();
    await probe.close();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface PluginStatus {
  readonly name: string;
  readonly status: "loaded" | "refused" | "error" | "inactive";
  readonly reason?: string;
  readonly missingOptional?: readonly string[];
}

interface RewriteRecord {
  readonly plugin: string;
  readonly type: string;
  readonly applied: number;
}

interface HarnessDiagnostics {
  readonly acquireWrapped: boolean;
  readonly acquireCalled: boolean;
  readonly outboundCount: number;
  readonly inboundCount: number;
  readonly bufferSealed: boolean;
  readonly identifiersFor: string | null;
  readonly errors: readonly string[];
  readonly react: { readonly hook: string; readonly version: string | null };
  readonly plugins: readonly PluginStatus[];
  readonly rewrites: readonly RewriteRecord[];
  readonly transcript: { readonly timed: number };
}

interface OutboundEnvelope {
  readonly type: string;
  readonly request?: { readonly type: string; readonly title?: unknown };
}

interface RiglineWindow {
  readonly __rigline?: { readonly diagnostics: HarnessDiagnostics };
  readonly __harness?: { readonly sent: readonly OutboundEnvelope[] };
  readonly __staleImported?: boolean;
  readonly __optional?: {
    readonly anchor: string | null;
    readonly cls: string | null;
    readonly watched: number;
    readonly threw: string | null;
  };
}

const corpusReason = missing(VERSION);
const chromiumReason = corpusReason ? null : await chromiumLaunchFailure();
const skipReason = corpusReason || chromiumReason || "";

const mounterPlugin: FixturePlugin = {
  name: "mounter",
  manifest: { uses: { anchors: ["modelPill"], mount: true } },
  source: `export default { setup(ctx) {
    ctx.watch("modelPill", (el) => ctx.mountAfter(el, () => {
      const s = document.createElement("span");
      s.className = "harness-badge";
      s.textContent = "H";
      return s;
    }));
  } };`,
};

describe.skipIf(!!corpusReason || !!chromiumReason)(
  `webview kernel against the real bundle${skipReason ? ` (${skipReason})` : ""}`,
  () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await chromium.launch();
    });

    afterAll(async () => {
      await browser.close();
    });

    interface Booted {
      readonly page: Page;
      readonly consoleErrors: readonly string[];
      readonly bootMs: number;
      close(): Promise<void>;
    }

    /** Prepare a fresh payload with exactly `plugins`, start a server for it, and navigate a fresh page to the boot goal state. */
    async function boot(
      plugins: readonly FixturePlugin[],
      remove?: RemovedIdentifiers,
    ): Promise<Booted> {
      const dir = mkdtempSync(join(tmpdir(), "rigline-harness-"));
      preparePayload(dir, { version: VERSION, plugins, remove });
      const harness: Harness = await startHarness({
        bundleDir: join(versionDir(VERSION), "webview"),
        payloadDir: dir,
        surface: "editor",
      });
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

      const started = performance.now();
      await page.goto(harness.url);
      await page.waitForSelector(".modelPill_gGYT1w", { timeout: 15000 });
      const bootMs = performance.now() - started;

      return {
        page,
        consoleErrors,
        bootMs,
        async close() {
          await page.close();
          await harness.close();
        },
      };
    }

    function diagnostics(page: Page): Promise<HarnessDiagnostics> {
      return page.evaluate(
        () => (window as unknown as RiglineWindow).__rigline?.diagnostics as HarnessDiagnostics,
      );
    }

    it("boots the real bundle with the pre and post hooks wired", async () => {
      const booted = await boot([]);
      try {
        console.log(`[harness] boot to .modelPill_gGYT1w: ${booted.bootMs.toFixed(0)}ms`);
        const d = await diagnostics(booted.page);
        expect(d.acquireWrapped).toBe(true);
        expect(d.acquireCalled).toBe(true);
        expect(d.outboundCount).toBeGreaterThan(0);
        expect(d.inboundCount).toBeGreaterThan(0);
        expect(d.bufferSealed).toBe(true);
        expect(d.identifiersFor).toBe(VERSION);
        expect(d.errors).toEqual([]);
        expect(d.react.version).toMatch(/^18\./);
        expect(d.react.hook).toBe("installed");
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("mounts a decoration after an anchor, attributed and placed as its sibling", async () => {
      const booted = await boot([mounterPlugin]);
      try {
        await booted.page.waitForSelector(".harness-badge");
        const info = await booted.page.evaluate(() => {
          const badge = document.getElementsByClassName("harness-badge")[0] ?? null;
          const pill = document.getElementsByClassName("modelPill_gGYT1w")[0] ?? null;
          return {
            mountAttr: badge?.getAttribute("data-rigline-mount") ?? null,
            isNextSibling: pill !== null && pill.nextElementSibling === badge,
          };
        });
        expect(info.mountAttr).toBe("mounter");
        expect(info.isNextSibling).toBe(true);

        const d = await diagnostics(booted.page);
        expect(d.plugins).toContainEqual({ name: "mounter", status: "loaded" });
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("refuses an anchor a plugin never declared, without disturbing another plugin's mount", async () => {
      const undeclaredPlugin: FixturePlugin = {
        name: "undeclared",
        manifest: { uses: {} },
        source: `export default { setup(ctx) { ctx.anchor("modelPill"); } };`,
      };
      const booted = await boot([mounterPlugin, undeclaredPlugin]);
      try {
        await booted.page.waitForSelector(".harness-badge");
        const d = await diagnostics(booted.page);
        const undeclaredStatus = d.plugins.find((p) => p.name === "undeclared");
        const mounterStatus = d.plugins.find((p) => p.name === "mounter");
        expect(undeclaredStatus?.status).toBe("error");
        expect(undeclaredStatus?.reason).toMatch(/never declared/);
        expect(mounterStatus?.status).toBe("loaded");
      } finally {
        await booted.close();
      }
    }, 20000);

    it("refuses a plugin naming an identifier gone from this version, and never imports it", async () => {
      const stalePlugin: FixturePlugin = {
        name: "stale",
        manifest: { uses: { classes: { ZZZZZZ: ["nothing"] } } },
        source: `window.__staleImported = true;
export default { setup() {} };`,
      };
      const booted = await boot([stalePlugin]);
      try {
        const d = await diagnostics(booted.page);
        const status = d.plugins.find((p) => p.name === "stale");
        expect(status?.status).toBe("refused");
        expect(status?.reason).toBe('unknown module "ZZZZZZ"');
        const imported = await booted.page.evaluate(
          () => (window as unknown as RiglineWindow).__staleImported,
        );
        expect(imported).toBeUndefined();
      } finally {
        await booted.close();
      }
    }, 20000);

    it("decorates transcript rows with a real time once the pushed messages land", async () => {
      const timerPlugin: FixturePlugin = {
        name: "timer",
        manifest: { uses: { transcript: true } },
        source: `export default { setup(ctx) {
    ctx.decorateTranscript((entry) => {
      const d = document.createElement("i");
      d.className = "harness-time";
      d.textContent = entry.at === null ? "?" : "t";
      return d;
    });
  } };`,
      };
      const booted = await boot([timerPlugin]);
      try {
        // The fake host pushes one user and one assistant io_message down launch_claude's
        // channel shortly after boot (src/page.ts); wait for both rows and their decoration.
        await booted.page.waitForFunction(() => {
          const rows = [...document.getElementsByClassName("message_07S1Yg")];
          return (
            rows.length === 2 &&
            rows.every((row) => row.getElementsByClassName("harness-time").length === 1)
          );
        });

        const rows = await booted.page.evaluate(() =>
          [...document.getElementsByClassName("message_07S1Yg")].map(
            (row) => row.getElementsByClassName("harness-time")[0]?.textContent ?? null,
          ),
        );
        expect(rows).toEqual(["t", "t"]);

        const d = await diagnostics(booted.page);
        expect(d.transcript.timed).toBe(2);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("degrades a plugin over a missing optional and refuses the one that required it", async () => {
      // The acceptance case for D41, at the DOM tier: one identifier gone from the tables the
      // loader reads, two plugins declaring it, and two different verdicts. Nothing about the
      // bundle changes — only what the loader believes about it, which is the state an extension
      // update leaves behind.
      const optimist: FixturePlugin = {
        name: "optimist",
        manifest: {
          uses: {
            anchors: ["modelPill"],
            mount: true,
            optional: {
              ...EMPTY_DECLARATIONS,
              anchors: ["worktreePill"],
              classes: { OOQiHg: ["worktreePill"] },
            },
          },
        },
        source: `export default { setup(ctx) {
    const result = { anchor: undefined, cls: undefined, watched: 0, threw: null };
    try {
      result.anchor = ctx.optional.anchor("worktreePill");
      result.cls = ctx.optional.cls("OOQiHg", "worktreePill");
      ctx.watch("worktreePill", () => { result.watched += 1; });
    } catch (e) {
      result.threw = String(e && e.message ? e.message : e);
    }
    window.__optional = result;
    ctx.watch("modelPill", (el) => ctx.mountAfter(el, () => {
      const s = document.createElement("span");
      s.className = "harness-badge";
      s.textContent = "O";
      return s;
    }));
  } };`,
      };
      const pessimist: FixturePlugin = {
        name: "pessimist",
        manifest: { uses: { anchors: ["worktreePill"] } },
        source: `window.__staleImported = true;
export default { setup() {} };`,
      };
      const booted = await boot([optimist, pessimist], { anchors: ["worktreePill"] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        const result = await booted.page.evaluate(
          () => (window as unknown as RiglineWindow).__optional,
        );
        expect(result?.threw).toBeNull();
        expect(result?.anchor).toBeNull();
        // The same call shape, the other answer: an optional lookup that resolves returns the
        // class, and only the null case is what the compiler makes an author handle.
        expect(result?.cls).toBe("worktreePill_OOQiHg");
        // watch() on an absent optional anchor watches nothing rather than throwing, which is the
        // same answer an undelivered message gives.
        expect(result?.watched).toBe(0);

        const d = await diagnostics(booted.page);
        const loaded = d.plugins.find((p) => p.name === "optimist");
        expect(loaded?.status).toBe("loaded");
        expect(loaded?.missingOptional).toEqual([
          'anchor "worktreePill" (OOQiHg.worktreePill) is not in this extension',
        ]);

        const refused = d.plugins.find((p) => p.name === "pessimist");
        expect(refused?.status).toBe("refused");
        expect(refused?.reason).toBe(
          'anchor "worktreePill" (OOQiHg.worktreePill) is not in this extension',
        );
        const imported = await booted.page.evaluate(
          () => (window as unknown as RiglineWindow).__staleImported,
        );
        expect(imported).toBeUndefined();
      } finally {
        await booted.close();
      }
    }, 20000);

    it("rewrites an outbound rename_tab once the chain reaches it", async () => {
      // The app renames its own tab reactively once a session exists and the fake host's init
      // reply admits it (page.ts's config.openNewInTab), which races this plugin's own
      // registration: the first rename_tab(s) go out before setup() has run, which the pre hook
      // counts as "missed" rather than applying to them. Once this plugin has seen the app send
      // rename_tab at all, resending it is what makes the rewrite observable without depending
      // on a real user interaction in a headless run — the fallback docs/spikes/playwright-
      // harness.md anticipates for exactly this case.
      const renamerPlugin: FixturePlugin = {
        name: "renamer",
        manifest: {
          uses: { rewrites: { rename_tab: ["title"] }, messages: ["rename_tab"] },
        },
        source: `export default { setup(ctx) {
    let resent = false;
    ctx.rewrite("rename_tab", (m) => ({
      title: "[h] " + (typeof m.title === "string" ? m.title : ""),
    }));
    ctx.onMessage("rename_tab", () => {
      if (resent) return;
      resent = true;
      setTimeout(() => ctx.resend("rename_tab"), 200);
    });
  } };`,
      };
      const booted = await boot([renamerPlugin]);
      try {
        await booted.page.waitForFunction(
          () => {
            const sent = (window as unknown as RiglineWindow).__harness?.sent ?? [];
            return sent.some(
              (m) =>
                m.request?.type === "rename_tab" &&
                typeof m.request.title === "string" &&
                m.request.title.startsWith("[h] "),
            );
          },
          { timeout: 10000 },
        );

        const sent = await booted.page.evaluate(
          () => (window as unknown as RiglineWindow).__harness?.sent ?? [],
        );
        const renameTabs = sent.filter((m) => m.request?.type === "rename_tab");
        const last = renameTabs.at(-1);
        expect(typeof last?.request?.title).toBe("string");
        expect(last?.request?.title as string).toMatch(/^\[h\] /);

        const d = await diagnostics(booted.page);
        const record = d.rewrites.find((r) => r.plugin === "renamer" && r.type === "rename_tab");
        expect(record?.applied).toBeGreaterThanOrEqual(1);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
