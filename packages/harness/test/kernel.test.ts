/**
 * The host kernel's own DOM behaviour against the real webview bundle, headless, no VS Code: the
 * third verification tier docs/host.md's "Verification" section names. Each first-party plugin has
 * its own file beside this one; what is here is the kernel, through fixture plugins small enough to
 * read in one screen.
 *
 * Skips with a reason, rather than failing, when the corpus snapshot or a launchable Chromium is
 * absent, so a fresh clone without either is not blocked. The scaffolding is in src/suite.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledDir, harvestReact } from "@rigline/core";
import { EMPTY_DECLARATIONS } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

interface ToolsWindow {
  readonly __harness?: { readonly push: (message: unknown) => void };
  readonly __tools?: {
    readonly uses: readonly string[];
    readonly results: readonly Record<string, unknown>[];
  };
}

interface SurvivorWindow {
  readonly __survivor?: {
    readonly sessions: number;
    readonly threw: string | null;
    readonly clicks: number;
    readonly builds: number;
    readonly node?: Element;
  };
  readonly __detach?: () => void;
}

interface FixtureWindow {
  readonly __staleImported?: boolean;
  readonly __optional?: {
    readonly anchor: string | null;
    readonly cls: string | null;
    readonly watched: number;
    readonly threw: string | null;
  };
}

const skipReason = await harnessSkipReason(VERSION);

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

describe.skipIf(skipReason !== null)(
  `webview kernel against the real bundle${skipReason ? ` (${skipReason})` : ""}`,
  () => {
    const boot = register(VERSION);

    it("boots the real bundle with the pre and post hooks wired", async () => {
      const booted = await boot();
      try {
        console.log(
          `[harness] boot to .modelPill_gGYT1w: ${booted.bootMs.toFixed(0)}ms, ` +
            `then to the kernel's seal: ${booted.kernelMs.toFixed(0)}ms`,
        );
        const d = await booted.diagnostics();
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
      const booted = await boot({ plugins: [mounterPlugin] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        const info = await booted.page.evaluate(() => {
          const badge = document.getElementsByClassName("harness-badge")[0] ?? null;
          // The picker, by the same selector the anchor resolves to: asking for the first element
          // with the class would agree with a wrongly-anchored mount as readily as a right one.
          const pill = document.querySelector('.modelPill_gGYT1w[role="combobox"]');
          return {
            mountAttr: badge?.getAttribute("data-rigline-mount") ?? null,
            isNextSibling: pill !== null && pill.nextElementSibling === badge,
          };
        });
        expect(info.mountAttr).toBe("mounter");
        expect(info.isNextSibling).toBe(true);

        const d = await booted.diagnostics();
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
      const booted = await boot({ plugins: [mounterPlugin, undeclaredPlugin] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        const d = await booted.diagnostics();
        const undeclaredStatus = d.plugins.find((p) => p.name === "undeclared");
        const mounterStatus = d.plugins.find((p) => p.name === "mounter");
        expect(undeclaredStatus?.status).toBe("error");
        expect(undeclaredStatus?.reason).toMatch(/never declared/);
        expect(mounterStatus?.status).toBe("loaded");
      } finally {
        await booted.close();
      }
    }, 20000);

    it("seals acquireVsCodeApi before plugins load, and the app still posts after", async () => {
      const acquirer: FixturePlugin = {
        name: "acquirer",
        manifest: { uses: {} },
        source: `export default { setup() { globalThis.acquireVsCodeApi(); } };`,
      };
      const booted = await boot({ plugins: [acquirer, mounterPlugin] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        const d = await booted.diagnostics();
        const acquirerStatus = d.plugins.find((p) => p.name === "acquirer");
        expect(acquirerStatus?.status).toBe("error");
        expect(acquirerStatus?.reason).toMatch(/already been acquired/);
        expect(d.plugins.find((p) => p.name === "mounter")?.status).toBe("loaded");

        const before = d.outboundCount;
        await booted.page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await booted.page.waitForFunction(
          (n) =>
            (window as unknown as { __rigline: { diagnostics: { outboundCount: number } } })
              .__rigline.diagnostics.outboundCount > n,
          before,
        );
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
      const booted = await boot({ plugins: [stalePlugin] });
      try {
        const d = await booted.diagnostics();
        const status = d.plugins.find((p) => p.name === "stale");
        expect(status?.status).toBe("refused");
        expect(status?.reason).toBe('unknown module "ZZZZZZ"');
        const imported = await booted.page.evaluate(
          () => (window as unknown as FixtureWindow).__staleImported,
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
      const booted = await boot({ plugins: [timerPlugin] });
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

        const d = await booted.diagnostics();
        expect(d.transcript.timed).toBe(2);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("keeps the app's renderer when another injects after it", async () => {
      // What a second react-dom does to the hook: a plugin carrying its own React, or Rigline's
      // own shell. Its commits are not the app's re-renders, and its version is not the app's.
      const intruder: FixturePlugin = {
        name: "intruder",
        manifest: { uses: { transcript: true } },
        source: `export default { setup(ctx) {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    window.__intruder = hook.inject({ version: "19.1.0", rendererPackageName: "react-dom" });
    ctx.decorateTranscript((entry) => {
      const d = document.createElement("i");
      d.className = "harness-time";
      d.textContent = entry.at === null ? "?" : "t";
      return d;
    });
  } };`,
      };
      const booted = await boot({ plugins: [intruder] });
      try {
        await booted.page.waitForFunction(() => {
          const rows = [...document.getElementsByClassName("message_07S1Yg")];
          return (
            rows.length === 2 &&
            rows.every((row) => row.getElementsByClassName("harness-time").length === 1)
          );
        });

        // Synchronous, so nothing of the app's can commit in between the two reads.
        const commits = await booted.page.evaluate(() => {
          const w = window as unknown as {
            __intruder: unknown;
            __REACT_DEVTOOLS_GLOBAL_HOOK__: { onCommitFiberRoot(id: unknown, root: unknown): void };
            __rigline: { diagnostics: { react: { commits: number } } };
          };
          const before = w.__rigline.diagnostics.react.commits;
          for (let i = 0; i < 50; i++)
            w.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(w.__intruder, {});
          return { before, after: w.__rigline.diagnostics.react.commits };
        });
        expect(commits.after).toBe(commits.before);

        // The shell's own react-dom is the other renderer, and injects once the shell has loaded.
        await booted.page.waitForSelector(".rigline-pill");
        const d = await booted.diagnostics();
        expect(d.react.version).toMatch(/^18\./);
        expect(d.react.foreign).toBe(2);
        expect(d.transcript.timed).toBe(2);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("serves one React to every plugin that imports it, and fails one importing anything else", async () => {
      const importer = (name: string): FixturePlugin => ({
        name,
        manifest: { uses: {} },
        source: `import * as React from "react";
import { jsx } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import { useStore } from "@rigline/plugin-api/ui";
export default { setup() {
  (window.__react ??= {})[${JSON.stringify(name)}] = {
    module: React,
    element: React.isValidElement(jsx("i", {})),
    portal: typeof createPortal,
    useStore: typeof useStore,
  };
} };`,
      });
      const stray: FixturePlugin = {
        name: "stray",
        manifest: { uses: {} },
        source: `import pad from "left-pad";
export default { setup() {} };`,
      };
      const booted = await boot({ plugins: [importer("first"), importer("second"), stray] });
      try {
        const seen = await booted.page.evaluate(() => {
          type Seen = {
            module: { version: string };
            element: boolean;
            portal: string;
            useStore: string;
          };
          const r = (window as unknown as { __react?: Record<string, Seen> }).__react ?? {};
          return {
            same: r.first !== undefined && r.first.module === r.second?.module,
            version: r.first?.module.version ?? null,
            element: r.first?.element ?? false,
            portal: r.first?.portal ?? null,
            useStore: r.first?.useStore ?? null,
          };
        });
        expect(seen.same).toBe(true);
        expect(seen.version).toMatch(/^19\./);
        expect(seen.element).toBe(true);
        expect(seen.portal).toBe("function");
        expect(seen.useStore).toBe("function");

        const d = await booted.diagnostics();
        expect(d.plugins.find((p) => p.name === "first")?.status).toBe("loaded");
        expect(d.plugins.find((p) => p.name === "second")?.status).toBe("loaded");
        const failed = d.plugins.find((p) => p.name === "stray");
        expect(failed?.status).toBe("error");
        expect(failed?.reason).toContain("left-pad");
      } finally {
        await booted.close();
      }
    }, 20000);

    it("reads a fiber off an element react-dom 19 rendered, which Rigline's own pill is", async () => {
      // The nearest thing to a React 19 app until Claude Code ships one (D103): the shell's
      // react-dom, rendering into the same page.
      const shell = readFileSync(join(bundledDir(), "runtime", "shell.js"), "utf8");
      expect(shell).not.toContain("findFiberByHostInstance");
      const anchors = harvestReact(shell);
      expect(anchors.version).toMatch(/^19\./);
      expect(anchors.missing).toEqual([]);

      const booted = await boot();
      try {
        await booted.page.waitForSelector(".rigline-pill");
        const popup = await booted.page.evaluate(() => {
          const w = window as unknown as {
            __rigline: { react: { fiberFor(element: Element): unknown } };
          };
          const pill = document.querySelector(".rigline-pill");
          const fiber = pill
            ? (w.__rigline.react.fiberFor(pill) as { memoizedProps?: Record<string, unknown> })
            : null;
          return fiber?.memoizedProps?.["aria-haspopup"] ?? null;
        });
        expect(popup).toBe("menu");
      } finally {
        await booted.close();
      }
    }, 20000);

    it("opens Rigline's menu from the pill, holding what a store caught from boot", async () => {
      // The app sends rename_tab during its own boot, before any plugin loads, so only a store
      // subscribed in setup has it by the time the menu opens (D88). The store is written out
      // because a fixture is unbundled and cannot import the plugin-api root.
      const contributor: FixturePlugin = {
        name: "contributor",
        manifest: { uses: { menu: true, messages: ["rename_tab"] } },
        source: `import { jsx } from "react/jsx-runtime";
import { useStore } from "@rigline/plugin-api/ui";
export default { setup(ctx) {
  let value = null;
  const listeners = new Set();
  const title = {
    get: () => value,
    set: (next) => { value = next; for (const l of [...listeners]) l(); },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
  ctx.onMessage("rename_tab", (payload) => title.set(payload.title));
  ctx.menu(() => jsx("span", { className: "harness-entry", children: useStore(title) ?? "nothing" }));
} };`,
      };
      const booted = await boot({ plugins: [contributor] });
      try {
        await booted.page.waitForSelector(".rigline-pill");
        expect(await booted.page.$(".harness-entry")).toBeNull();

        await booted.page.click(".rigline-pill");
        const entry = await booted.page.waitForSelector(".harness-entry");
        expect(await entry.textContent()).not.toBe("nothing");

        await booted.page.keyboard.press("Escape");
        await booted.page.waitForSelector(".harness-entry", { state: "detached" });
        const d = await booted.diagnostics();
        expect(d.plugins.find((p) => p.name === "contributor")?.status).toBe("loaded");
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("disables a plugin whose menu component throws, and keeps everybody else's", async () => {
      const entry = (name: string, body: string): FixturePlugin => ({
        name,
        manifest: { uses: { menu: true } },
        source: `import { jsx } from "react/jsx-runtime";
export default { setup(ctx) { ctx.menu(() => { ${body} }); } };`,
      });
      const booted = await boot({
        plugins: [
          entry("thrower", 'throw new Error("no menu for you");'),
          entry("steady", 'return jsx("span", { className: "harness-steady", children: "ok" });'),
        ],
      });
      try {
        await booted.page.waitForSelector(".rigline-pill");
        await booted.page.click(".rigline-pill");
        await booted.page.waitForSelector(".harness-steady");

        const d = await booted.diagnostics();
        const thrower = d.plugins.find((p) => p.name === "thrower");
        expect(thrower?.status).toBe("error");
        expect(thrower?.reason).toContain("no menu for you");
        expect(d.plugins.find((p) => p.name === "steady")?.status).toBe("loaded");
        // The shell itself is unharmed: its own errors would be here.
        expect(d.errors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("moves focus across two plugins' entries, drills in and out, and keeps Escape from the app", async () => {
      const alpha: FixturePlugin = {
        name: "alpha",
        manifest: { uses: { menu: true } },
        source: `import { jsx } from "react/jsx-runtime";
import { MenuItem } from "@rigline/plugin-api/ui";
export default { setup(ctx) {
  ctx.menu(() => jsx(MenuItem, { label: "Alpha one", onSelect: () => { window.__chosen = "alpha"; } }));
} };`,
      };
      const beta: FixturePlugin = {
        name: "beta",
        manifest: { uses: { menu: true } },
        source: `import { jsx, jsxs } from "react/jsx-runtime";
import { MenuItem, Submenu } from "@rigline/plugin-api/ui";
export default { setup(ctx) {
  ctx.menu(() => jsxs(Submenu, { label: "Beta sub", children: [
    jsx(MenuItem, { label: "Inner one" }, "1"),
    jsx(MenuItem, { label: "Inner two" }, "2"),
  ] }));
} };`,
      };
      const booted = await boot({ plugins: [alpha, beta] });
      const { page } = booted;
      const focused = (): Promise<string | null> =>
        page.evaluate(() => {
          const el = document.activeElement;
          return el?.getAttribute("role") === "menu" ? "(menu)" : (el?.textContent ?? null);
        });
      try {
        await page.waitForSelector(".rigline-pill");
        await page.evaluate(() => {
          const w = window as unknown as { __escapes: number };
          w.__escapes = 0;
          document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") w.__escapes += 1;
          });
        });

        await page.focus(".rigline-pill");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".rigline-menu");
        expect(await focused()).toBe("Alpha one");
        await page.keyboard.press("ArrowDown");
        expect(await focused()).toContain("Beta sub");
        // Rigline's own Layout entry, after every plugin's.
        await page.keyboard.press("ArrowDown");
        expect(await focused()).toContain("Layout");
        await page.keyboard.press("ArrowDown");
        expect(await focused()).toBe("Alpha one");
        await page.keyboard.press("ArrowUp");
        expect(await focused()).toContain("Layout");
        await page.keyboard.press("ArrowUp");
        expect(await focused()).toContain("Beta sub");

        await page.keyboard.press("ArrowRight");
        expect(await focused()).toBe("Inner one");
        expect(await page.isVisible("text=Alpha one")).toBe(false);
        await page.keyboard.press("End");
        expect(await focused()).toBe("Inner two");
        await page.keyboard.press("ArrowLeft");
        expect(await focused()).toContain("Beta sub");

        await page.keyboard.press("Enter");
        expect(await focused()).toBe("Inner one");
        await page.keyboard.press("Escape");
        expect(await focused()).toContain("Beta sub");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".rigline-menu", { state: "detached" });
        expect(await page.evaluate(() => document.activeElement?.className)).toContain(
          "rigline-pill",
        );
        expect(
          await page.evaluate(() => (window as unknown as { __escapes: number }).__escapes),
        ).toBe(0);

        // Opened with the pointer, nothing is highlighted until something moves.
        await page.click(".rigline-pill");
        await page.waitForSelector(".rigline-menu");
        expect(await focused()).toBe("(menu)");
        await page.click("text=Alpha one");
        await page.waitForSelector(".rigline-menu", { state: "detached" });
        expect(
          await page.evaluate(() => (window as unknown as { __chosen?: string }).__chosen),
        ).toBe("alpha");
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("keeps the menu open when onSelect prevents it, and disables a plugin whose handler throws", async () => {
      const item = (name: string, label: string, body: string): FixturePlugin => ({
        name,
        manifest: { uses: { menu: true } },
        source: `import { jsx } from "react/jsx-runtime";
import { MenuItem } from "@rigline/plugin-api/ui";
export default { setup(ctx) {
  ctx.menu(() => jsx(MenuItem, { label: ${JSON.stringify(label)}, onSelect: (event) => { ${body} } }));
} };`,
      });
      const booted = await boot({
        plugins: [
          item(
            "keeper",
            "Keep",
            "event.preventDefault(); window.__kept = (window.__kept ?? 0) + 1;",
          ),
          item("faulty", "Explode", 'throw new Error("handler boom");'),
        ],
      });
      const { page } = booted;
      try {
        await page.waitForSelector(".rigline-pill");
        await page.click(".rigline-pill");
        await page.click("text=Keep");
        expect(await page.isVisible(".rigline-menu")).toBe(true);
        expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(
          1,
        );

        await page.click("text=Explode");
        await page.waitForSelector("text=Explode", { state: "detached" });
        expect(await page.isVisible("text=Keep")).toBe(true);
        const d = await booted.diagnostics();
        const faulty = d.plugins.find((p) => p.name === "faulty");
        expect(faulty?.status).toBe("error");
        expect(faulty?.reason).toContain("handler boom");
        expect(d.plugins.find((p) => p.name === "keeper")?.status).toBe("loaded");
        expect(d.errors).toEqual([]);
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
      const booted = await boot({
        plugins: [optimist, pessimist],
        remove: { anchors: ["worktreePill"] },
      });
      try {
        await booted.page.waitForSelector(".harness-badge");
        const result = await booted.page.evaluate(
          () => (window as unknown as FixtureWindow).__optional,
        );
        expect(result?.threw).toBeNull();
        expect(result?.anchor).toBeNull();
        // The same call shape, the other answer: an optional lookup that resolves returns the
        // class, and only the null case is what the compiler makes an author handle.
        expect(result?.cls).toBe("worktreePill_OOQiHg");
        // watch() on an absent optional anchor watches nothing rather than throwing, which is the
        // same answer an undelivered message gives.
        expect(result?.watched).toBe(0);

        const d = await booted.diagnostics();
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
          () => (window as unknown as FixtureWindow).__staleImported,
        );
        expect(imported).toBeUndefined();
      } finally {
        await booted.close();
      }
    }, 20000);

    it("refuses only the transcript's plugins when react-dom lacks what the host reads rows with", async () => {
      // D102 at the DOM tier: the tables say react-dom has lost something, and a plugin requiring the
      // transcript is refused by that reason while one taking it optionally, and one never asking,
      // both load.
      const needy: FixturePlugin = {
        name: "needy",
        manifest: { uses: { transcript: true } },
        source: `window.__staleImported = true;
export default { setup() {} };`,
      };
      const hopeful: FixturePlugin = {
        name: "hopeful",
        manifest: { uses: { optional: { ...EMPTY_DECLARATIONS, transcript: true } } },
        source: `window.__hopeful = { threw: null };
export default { setup(ctx) {
    try { ctx.decorateTranscript(() => null); }
    catch (e) { window.__hopeful.threw = String(e && e.message || e); }
  } };`,
      };
      const booted = await boot({
        plugins: [needy, hopeful, mounterPlugin],
        remove: { react: ["memoizedProps"] },
      });
      try {
        await booted.page.waitForSelector(".harness-badge");
        const reason =
          `"transcript" needs react-dom's "memoizedProps", which is gone: ` +
          "the host could reach a fiber but not read which message it shows";

        const d = await booted.diagnostics();
        expect(d.plugins.find((p) => p.name === "needy")).toEqual({
          name: "needy",
          status: "refused",
          reason,
        });
        const imported = await booted.page.evaluate(
          () => (window as unknown as FixtureWindow).__staleImported,
        );
        expect(imported).toBeUndefined();

        const hoped = d.plugins.find((p) => p.name === "hopeful");
        expect(hoped?.status).toBe("loaded");
        expect(hoped?.missingOptional).toEqual([reason]);
        const threw = await booted.page.evaluate(
          () => (globalThis as { __hopeful?: { threw: string | null } }).__hopeful?.threw,
        );
        expect(threw).toBeNull();
        expect(d.transcript.sweeps).toBe(0);

        expect(d.plugins).toContainEqual({ name: "mounter", status: "loaded" });
      } finally {
        await booted.close();
      }
    }, 20000);

    it("grants a switch declared only under optional, and re-places a mount without rebuilding it", async () => {
      // Two properties of the capability layer that a plugin can only find out about the hard way.
      // A switch under `uses.optional` is still declared: optional changes the verdict when what it
      // rests on is gone, never whether the method exists. And a mount the host puts back is the
      // node the plugin built, so a reference it kept, and anything it hung on that node, survives.
      const survivor: FixturePlugin = {
        name: "survivor",
        manifest: {
          uses: {
            anchors: ["modelPill"],
            mount: true,
            optional: { ...EMPTY_DECLARATIONS, session: true },
          },
        },
        source: `export default { setup(ctx) {
    const state = { sessions: 0, threw: null, clicks: 0, builds: 0, sameNode: null };
    window.__survivor = state;
    try {
      ctx.onSessionId(() => { state.sessions += 1; });
    } catch (e) {
      state.threw = String(e && e.message ? e.message : e);
    }
    ctx.watch("modelPill", (pill) => ctx.mountAfter(pill, () => {
      state.builds += 1;
      const s = document.createElement("span");
      s.className = "harness-badge";
      s.textContent = "S";
      // A listener on the node itself: it survives a re-placement only if the node does.
      s.addEventListener("click", () => { state.clicks += 1; });
      state.node = s;
      return s;
    }));
    window.__detach = () => {
      const badge = document.getElementsByClassName("harness-badge")[0];
      badge.remove();
      // A re-render is what takes a mount away and what puts it back (D52), so the detach has to be
      // one. Removing the node alone proved nothing once the host stopped watching every mutation
      // in the document: it would have sat there until the app happened to commit for its own
      // reasons, which is a race dressed up as a test.
      window.__harness.rerender();
    };
  } };`,
      };
      const booted = await boot({ plugins: [survivor] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        const before = await booted.page.evaluate(
          () => (window as unknown as SurvivorWindow).__survivor,
        );
        // Declared only under optional, and the handler still fired with the current session.
        expect(before?.threw).toBeNull();
        expect(before?.sessions).toBeGreaterThan(0);
        expect(before?.builds).toBe(1);

        // Detach it in a re-render, and let the shared per-commit pass put it back.
        await booted.page.evaluate(() => (window as unknown as SurvivorWindow).__detach?.());
        await booted.page.waitForSelector(".harness-badge");
        await booted.page.click(".harness-badge");

        const after = await booted.page.evaluate(() => {
          const w = window as unknown as SurvivorWindow;
          return {
            state: w.__survivor,
            isSameNode: document.getElementsByClassName("harness-badge")[0] === w.__survivor?.node,
          };
        });
        // Re-placed, not rebuilt: one build, the same node object, and its listener still attached.
        expect(after.state?.builds).toBe(1);
        expect(after.isSameNode).toBe(true);
        expect(after.state?.clicks).toBe(1);

        const d = await booted.diagnostics();
        expect(d.plugins.find((p) => p.name === "survivor")?.status).toBe("loaded");
        // The instrument D52 is waiting on, asserted against the real bundle: commits are driving
        // this, the re-placement above was counted, and nothing is stuck detached from a live
        // anchor. `replaced` is the number that decides whether replaceLost survives at all.
        expect(d.mounts.driver).toBe("commit");
        expect(d.mounts.replaced).toBeGreaterThan(0);
        expect(d.mounts.lost).toBe(0);
        expect(d.mounts.moved).toBe(0);
        expect(d.mounts.active).toBeGreaterThan(0);
        // The meters and the flight recorder (D53), pinned in a real browser because both are
        // things a Node test cannot reach: a peak is only meaningful against real traffic, and
        // localStorage is exactly the API that is present and then throws on use.
        expect(d.meters.inbound?.peak).toBeGreaterThan(0);
        expect(d.meters.replace?.peak).toBeGreaterThan(0);
        expect(d.storage.available).toBe(true);
        expect(d.storage.writes).toBeGreaterThan(0);
        expect(d.storage.failures).toBe(0);
        expect(d.storage.bytes).toBeGreaterThan(0);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("follows an anchor that a re-render moved rather than replaced", async () => {
      // The symptom that sent us looking (first seen in the prototype, and again
      // in 1.0 on 2026-09-14): an attachment chip reorders the composer footer, the model pill goes
      // to the end of the row, and every decoration anchored to it stays behind. The node is still
      // connected and the pill is still the same element, so neither "put back what was detached"
      // nor "re-anchor when the element changes" sees anything wrong. Only a position check does.
      const booted = await boot({ plugins: [mounterPlugin] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        // Move the pill to the end of its own parent, which is what the app's own re-render does,
        // and then let a real commit drive the pass.
        await booted.page.evaluate(() => {
          const pill = document.getElementsByClassName("modelPill_gGYT1w")[0];
          pill?.parentElement?.appendChild(pill);
          (window as unknown as { __harness?: { rerender: () => void } }).__harness?.rerender();
        });
        await booted.page.waitForFunction(() => {
          const pill = document.getElementsByClassName("modelPill_gGYT1w")[0];
          const badge = document.getElementsByClassName("harness-badge")[0];
          return pill != null && badge != null && pill.nextElementSibling === badge;
        });

        const d = await booted.diagnostics();
        // Counted as a move, not as a re-placement: the node never left the document, and the two
        // numbers answer different questions (D52).
        expect(d.mounts.moved).toBeGreaterThan(0);
        expect(d.mounts.lost).toBe(0);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("stays on the model picker when a second control wears the pill's class", async () => {
      // The symptom this whole layer exists for (D7). `modelPill_gGYT1w` is on the model picker
      // *and* on the agent-map button, because both are pills; a watch that resolved the class and
      // took the first match gave three first-party decorations to whichever came first in the
      // document, passing every check while pointing at the wrong control. The decoy below is that
      // button in miniature: same class, first in the footer, and not a combobox.
      const booted = await boot({ plugins: [mounterPlugin] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        await booted.page.evaluate(() => {
          const pill = document.querySelector('.modelPill_gGYT1w[role="combobox"]');
          const decoy = document.createElement("button");
          decoy.className = pill?.className ?? "modelPill_gGYT1w";
          decoy.id = "harness-decoy";
          decoy.textContent = "Agents";
          // Ahead of #root rather than inside the footer, for one reason only: React reconciles
          // away a foreign child of a container it owns, and the decoy has to survive the commits
          // below to be a decoy at all. What matters is that it carries the class and comes first
          // in document order, which is precisely what the old class lookup went by.
          document.body.insertBefore(decoy, document.body.firstChild);
          (window as unknown as { __harness?: { rerender: () => void } }).__harness?.rerender();
        });
        // Several commits, so a watch that was going to re-anchor has had every chance to.
        await booted.page.evaluate(() => {
          const w = window as unknown as { __harness?: { rerender: () => void } };
          for (let i = 0; i < 3; i++) w.__harness?.rerender();
        });
        await booted.page.waitForTimeout(300);

        const info = await booted.page.evaluate(() => {
          const badge = document.getElementsByClassName("harness-badge")[0] ?? null;
          const picker = document.querySelector('.modelPill_gGYT1w[role="combobox"]');
          const byClass = document.getElementsByClassName("modelPill_gGYT1w")[0] ?? null;
          return {
            pills: document.getElementsByClassName("modelPill_gGYT1w").length,
            classFirstIsDecoy: byClass?.id === "harness-decoy",
            onPicker: picker !== null && picker.nextElementSibling === badge,
            badgeInDecoy: document.getElementById("harness-decoy")?.contains(badge) ?? false,
            badges: document.getElementsByClassName("harness-badge").length,
          };
        });
        // The decoy is in the document, shares the class, and is what the class lookup this
        // replaced would have handed over — so the assertion below is about which of the two the
        // anchor resolved to, not about there being only one to resolve to.
        expect(info.pills).toBeGreaterThan(1);
        expect(info.classFirstIsDecoy).toBe(true);
        expect(info.onPicker).toBe(true);
        expect(info.badgeInDecoy).toBe(false);
        expect(info.badges).toBe(1);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("says so when an anchor that names one element matches two", async () => {
      // The runtime half of the same question, and the reason both halves exist (D7). The build
      // check counts how many places the bundle applies a class and would say nothing here: the
      // decoy below matches the *refined* selector, which is a refinement that has stopped
      // refining, and only counting elements on screen can catch that.
      const booted = await boot({ plugins: [mounterPlugin] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        await booted.page.evaluate(() => {
          const decoy = document.createElement("button");
          decoy.className = "modelPill_gGYT1w";
          decoy.setAttribute("role", "combobox");
          decoy.id = "harness-twin";
          document.body.appendChild(decoy);
          const w = window as unknown as { __harness?: { rerender: () => void } };
          w.__harness?.rerender();
        });
        // A predicate rather than a sleep, and deliberately not an async one: an async callback
        // here resolves to a promise, which Playwright reads as truthy on the first poll and
        // returns from immediately.
        await booted.page.waitForFunction(() => {
          const w = window as unknown as {
            __rigline?: { diagnostics: { mounts: { multiple: Record<string, number> } } };
          };
          return (w.__rigline?.diagnostics.mounts.multiple.modelPill ?? 0) >= 2;
        });

        const d = await booted.diagnostics();
        expect(d.mounts.multiple.modelPill).toBe(2);
        // A second control wearing the anchor is not a crash and does not disable anything: the
        // panel is fine and the claim is not, which is a warning and a diagnostic, not an error.
        expect(booted.consoleErrors).toEqual([]);
        expect(d.errors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("leaves a correctly placed mount alone, so a commit is not a DOM write", async () => {
      // The other half of the same change, and the risk it introduced. Re-checking position every
      // commit is only safe because `place` is skipped when the node already sits where it belongs;
      // without that the host would rewrite every mount once per frame and drop any selection
      // inside one. Many commits, no moves, is the assertion.
      const booted = await boot({ plugins: [mounterPlugin] });
      try {
        await booted.page.waitForSelector(".harness-badge");
        await booted.page.evaluate(() => {
          const w = window as unknown as { __harness?: { rerender: () => void } };
          for (let i = 0; i < 5; i++) w.__harness?.rerender();
        });
        await booted.page.waitForTimeout(300);

        const d = await booted.diagnostics();
        expect(d.mounts.moved).toBe(0);
        expect(d.mounts.lost).toBe(0);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("mounts before an anchor in registry order, which is what footer decorations need", async () => {
      // `mountBefore` exists because the composer footer measures its own element children and
      // reflows on the total, so a decoration belongs at the end of the footer's left cluster,
      // against the spacer that divides it from the right one (D54). Nothing unconditional sits
      // immediately before that spacer, so `mountAfter` cannot express the position at all.
      //
      // Registry order has to read the same way it does for `mountAfter` — lowest order leftmost —
      // which for a `before` mount means the *highest* order ends up nearest the anchor. Two
      // plugins is the only way to assert that; one node proves nothing about ordering.
      const first: FixturePlugin = {
        name: "first",
        manifest: { uses: { anchors: ["footerSpacer"], mount: true } },
        source: `export default { setup(ctx) {
    ctx.watch("footerSpacer", (el) => ctx.mountBefore(el, () => {
      const s = document.createElement("span");
      s.className = "harness-before";
      s.textContent = "1";
      return s;
    }));
  } };`,
      };
      const second: FixturePlugin = {
        name: "second",
        manifest: { uses: { anchors: ["footerSpacer"], mount: true } },
        source: `export default { setup(ctx) {
    ctx.watch("footerSpacer", (el) => ctx.mountBefore(el, () => {
      const s = document.createElement("span");
      s.className = "harness-before";
      s.textContent = "2";
      return s;
    }));
  } };`,
      };
      const booted = await boot({ plugins: [first, second] });
      try {
        await booted.page.waitForFunction(
          () => document.getElementsByClassName("harness-before").length === 2,
        );
        const placement = await booted.page.evaluate(() => {
          const spacer = document.getElementsByClassName("spacer_gGYT1w")[0] ?? null;
          const order: string[] = [];
          let sibling = spacer?.previousElementSibling ?? null;
          while (sibling?.hasAttribute("data-rigline-mount")) {
            order.unshift(sibling.getAttribute("data-rigline-mount") ?? "?");
            sibling = sibling.previousElementSibling;
          }
          return {
            order,
            // The footer is the container whose children are measured; being *in* it is the
            // point of the placement, not an incidental consequence of it.
            inFooter:
              document
                .getElementsByClassName("harness-before")[0]
                ?.parentElement?.classList.contains("inputFooter_gGYT1w") ?? false,
          };
        });
        // Rigline's own pill after every plugin, nearest the spacer.
        expect(placement.order).toEqual(["first", "second", "rigline"]);
        expect(placement.inFooter).toBe(true);

        const d = await booted.diagnostics();
        expect(d.mounts.abandoned).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("gives up on a mount that keeps being undone, rather than fighting it every frame", async () => {
      // D54. The host re-places a mount it finds out of position, once per commit; when something
      // else moves it straight back, that is a fight the host loses at frame rate, and the panel
      // flickers for as long as it keeps trying. The real case is subtler than this — a decoration
      // inside a container whose owner measures its children, where the host's own insertion is
      // what re-triggers the measurement — but the host cannot see a cause either way. All it can
      // see is that it keeps acting and the world keeps not staying as it left it, which is what
      // this reproduces directly.
      const stubborn: FixturePlugin = {
        name: "stubborn",
        manifest: { uses: { anchors: ["footerSpacer"], mount: true } },
        source: `export default { setup(ctx) {
    ctx.watch("footerSpacer", (el) => ctx.mountBefore(el, () => {
      const s = document.createElement("span");
      s.className = "harness-stubborn";
      s.textContent = "X";
      return s;
    }));
  } };`,
      };
      const booted = await boot({ plugins: [stubborn] });
      try {
        await booted.page.waitForSelector(".harness-stubborn");
        // The undo has to land before the next pass, not merely before the next commit, which is
        // what makes this an observer rather than a step in the loop below. An earlier version
        // moved the node once per re-render and never tripped the damper, correctly: the host got
        // a clean pass in between every fought one, and a correction that sticks even briefly is
        // not a fight. A MutationObserver fires as a microtask straight after the host's own DOM
        // write, so every pass finds the node displaced, which is the real pathology's shape.
        // Re-parenting is idempotent — a node already in `body` is left alone — so the callback
        // cannot re-queue itself.
        await booted.page.evaluate(() => {
          const undo = () => {
            const node = document.getElementsByClassName("harness-stubborn")[0];
            if (node && node.parentElement !== document.body) document.body.appendChild(node);
          };
          new MutationObserver(undo).observe(document.body, { childList: true, subtree: true });
          undo();
        });
        // Spaced over frames because the pre hook coalesces commit notices to one a frame: a tight
        // loop of re-renders would be a handful of passes rather than the thirty-odd this needs.
        await booted.page.evaluate(async () => {
          const w = window as unknown as { __harness?: { rerender: () => void } };
          const frame = () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          for (let i = 0; i < 45; i++) {
            w.__harness?.rerender();
            await frame();
          }
        });

        const d = await booted.diagnostics();
        expect(d.mounts.abandoned).toHaveLength(1);
        expect(d.mounts.abandoned[0]).toContain("stubborn");
        // Not left where it last landed: half of an oscillation has the node somewhere nobody
        // chose, and a ghost on screen is worse than a decoration that is plainly gone.
        const present = await booted.page.evaluate(
          () => document.getElementsByClassName("harness-stubborn").length,
        );
        expect(present).toBe(0);
        // Reported through the plugin's own failure path, so it is the plugin that is disabled and
        // named, not the panel that is degraded anonymously (D27).
        expect(d.plugins.find((p) => p.name === "stubborn")?.status).toBe("error");
        expect(booted.consoleErrors.join("\n")).toContain("stubborn");
      } finally {
        await booted.close();
      }
    }, 40000);

    it("gives up on a watch whose anchor is replaced every time it re-anchors", async () => {
      // The other half of the damper, and the half the reported case actually ran through (D54).
      // Re-anchoring tears one mount down and attaches another rather than repositioning a node, so
      // `moved` and `replaced` both stay flat while the panel flickers at frame rate — which is why
      // the mount counters could not have caught it and why `rebind` exists.
      //
      // The plugin invalidates its own anchor from inside `onFound`, which reads like sabotage and
      // is in fact the pathology's exact shape: in the real case placing the decoration is what
      // makes the app re-render the anchor, so every pass hands the watch a different element and
      // none of it is visible to the host as a cause.
      const churner: FixturePlugin = {
        name: "churner",
        manifest: { uses: { anchors: ["footerSpacer"], mount: true } },
        source: `export default { setup(ctx) {
    ctx.watch("footerSpacer", (el) => {
      const stop = ctx.mountBefore(el, () => {
        const s = document.createElement("span");
        s.className = "harness-churner";
        s.textContent = "C";
        return s;
      });
      el.replaceWith(el.cloneNode(true));
      return stop;
    });
  } };`,
      };
      const booted = await boot({ plugins: [churner] });
      try {
        await booted.page.waitForSelector(".harness-churner");
        await booted.page.evaluate(async () => {
          const w = window as unknown as { __harness?: { rerender: () => void } };
          const frame = () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          for (let i = 0; i < 45; i++) {
            w.__harness?.rerender();
            await frame();
          }
        });

        const d = await booted.diagnostics();
        expect(d.mounts.abandoned).toHaveLength(1);
        expect(d.mounts.abandoned[0]).toContain("churner");
        expect(d.mounts.abandoned[0]).toContain("footerSpacer");
        // The number that would have named this from the panel, had it existed at the time.
        expect(d.meters.rebind?.peak ?? 0).toBeGreaterThan(0);
        expect(d.plugins.find((p) => p.name === "churner")?.status).toBe("error");
      } finally {
        await booted.close();
      }
    }, 40000);

    it("joins a tool result back to the call it answers, and drops one it cannot name", async () => {
      // D51. A tool_result block carries a tool_use_id, the output and is_error, and no tool name
      // at all, so the join is the whole value: without it a plugin knows something finished but
      // not what, and acting on the call instead means acting on an intention the user may have
      // declined.
      const watcher: FixturePlugin = {
        name: "watcher",
        manifest: { uses: { tools: true } },
        source: `export default { setup(ctx) {
    const seen = { uses: [], results: [] };
    window.__tools = seen;
    ctx.onToolUse((t) => seen.uses.push(t.name + ":" + t.id));
    ctx.onToolResult((r) => seen.results.push({
      id: r.id, name: r.name, ok: r.ok, input: r.input, content: r.content,
    }));
  } };`,
      };
      const booted = await boot({ plugins: [watcher] });
      try {
        await booted.page.evaluate(() => {
          const push = (window as unknown as ToolsWindow).__harness?.push;
          if (!push) throw new Error("harness push missing");
          const call = (id: string, name: string, input: unknown) => ({
            type: "io_message",
            message: {
              type: "assistant",
              message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
            },
          });
          const answer = (id: string, content: unknown, isError?: boolean) => ({
            type: "io_message",
            message: {
              type: "user",
              message: {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
              },
            },
          });
          push(call("t1", "EnterWorktree", { name: "TD-9" }));
          push(answer("t1", "Entered", false));
          push(call("t2", "EnterWorktree", { name: "TD-10" }));
          push(answer("t2", "The user doesn't want to proceed", true));
          // No call was ever seen for t3: it belongs to a conversation that predates this panel.
          push(answer("t3", "orphan", false));
        });

        const seen = await booted.page.evaluate(() => (window as unknown as ToolsWindow).__tools);
        expect(seen?.uses).toEqual(["EnterWorktree:t1", "EnterWorktree:t2"]);
        expect(seen?.results).toEqual([
          {
            id: "t1",
            name: "EnterWorktree",
            ok: true,
            input: { name: "TD-9" },
            content: "Entered",
          },
          {
            id: "t2",
            name: "EnterWorktree",
            ok: false,
            input: { name: "TD-10" },
            content: "The user doesn't want to proceed",
          },
        ]);

        const d = await booted.diagnostics();
        expect(d.plugins.find((p) => p.name === "watcher")?.status).toBe("loaded");
        expect(booted.consoleErrors).toEqual([]);
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
      const booted = await boot({ plugins: [renamerPlugin] });
      try {
        await booted.page.waitForFunction(
          () => {
            const sent =
              (
                window as unknown as {
                  __harness?: { sent: { request?: { type: string; title?: unknown } }[] };
                }
              ).__harness?.sent ?? [];
            return sent.some(
              (m) =>
                m.request?.type === "rename_tab" &&
                typeof m.request.title === "string" &&
                m.request.title.startsWith("[h] "),
            );
          },
          { timeout: 10000 },
        );

        const sent = await booted.sent();
        const renameTabs = sent.filter((m) => m.request?.type === "rename_tab");
        const last = renameTabs.at(-1);
        expect(typeof last?.request?.title).toBe("string");
        expect(last?.request?.title as string).toMatch(/^\[h\] /);

        const d = await booted.diagnostics();
        const record = d.rewrites.find((r) => r.plugin === "renamer" && r.type === "rename_tab");
        expect(record?.applied).toBeGreaterThanOrEqual(1);
      } finally {
        await booted.close();
      }
    }, 20000);

    /**
     * A watch for an anchor this *surface* has not got, which is the same answer to the plugin as an
     * optional anchor this *extension* has not got: nothing to mount on, so watch nothing.
     *
     * `footerSpacer` is measured in the table as editor and sidebar only, and the session list
     * renders no composer. Without this, a plugin that spans all three surfaces reports a decoration
     * missing on the one surface where it was never going to appear — which is exactly what the
     * first live read of the panel showed.
     */
    it("watches nothing for an anchor the table says this surface does not render", async () => {
      const spanningPlugin: FixturePlugin = {
        name: "spanning",
        manifest: { uses: { anchors: ["footerSpacer"], mount: true } },
        source: `window.__spanned = { found: 0 };
export default { setup(ctx) {
    ctx.watch("footerSpacer", () => { window.__spanned.found += 1; });
  } };`,
      };
      const booted = await boot({ plugins: [spanningPlugin], surface: "sessionList" });
      try {
        const state = await booted.page.evaluate(() => {
          const found = (globalThis as { __spanned?: { found: number } }).__spanned?.found ?? -1;
          const bridge = (
            globalThis as {
              __rigline?: {
                checks: {
                  run(): readonly {
                    contributor: string;
                    results: readonly { name: string; verdict: string; detail: string }[];
                  }[];
                } | null;
              };
            }
          ).__rigline;
          const core = bridge?.checks?.run().find((g) => g.contributor === "core");
          return {
            found,
            watches: core?.results.find((r) => r.name.startsWith("mount: watches")) ?? null,
          };
        });

        // Registered, never called, and never counted as a watch that found nothing.
        expect(state.found).toBe(0);
        expect(state.watches?.verdict).toBe("n/a");
        expect(state.watches?.detail).toContain("no watches on this surface");

        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: "spanning", status: "loaded" });
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    /**
     * `decorateTranscript` on a surface that renders no rows registers nothing, rather than a
     * decorator that can never fire.
     *
     * Not a tidiness point. The sweep runs on the React commit signal, so a decorator registered on
     * the session list queries for rows once per commit for the life of the window — twenty-seven
     * thousand times in the run that found this — to look for what the anchor table says cannot be
     * there. `transcriptRow` is measured as editor and sidebar, and this reads that rather than
     * naming the surface.
     */
    it("registers no transcript decorator, and so no sweep, where the anchor renders no rows", async () => {
      const decoratorPlugin: FixturePlugin = {
        name: "decorator",
        manifest: { uses: { transcript: true } },
        source: `window.__decorated = { threw: null };
export default { setup(ctx) {
    try { ctx.decorateTranscript(() => null); }
    catch (e) { window.__decorated.threw = String(e && e.message || e); }
  } };`,
      };
      const booted = await boot({ plugins: [decoratorPlugin], surface: "sessionList" });
      try {
        const threw = await booted.page.evaluate(
          () => (globalThis as { __decorated?: { threw: string | null } }).__decorated?.threw,
        );
        // Registered without complaint: a surface with no rows is not a fault, where a missing React
        // renderer is and still throws.
        expect(threw).toBeNull();

        const d = await booted.diagnostics();
        expect(d.transcript.sweeps).toBe(0);
        expect(d.plugins).toContainEqual({ name: "decorator", status: "loaded" });
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    /**
     * A plugin's own diagnostics, end to end: `ctx.check` with no declaration behind it, grouped
     * under the plugin's name, with `core` above it — and a throwing check rendered as one failing
     * line with the plugin still loaded, which is the decision this whole capability turns on.
     */
    it("groups a plugin's contributed checks under its name, core first, and survives one that throws", async () => {
      const checkerPlugin: FixturePlugin = {
        name: "checker",
        // Nothing declared, because a check declares nothing: it names no identifier, so there is
        // no gap a manifest could ever report.
        manifest: { uses: {} },
        source: `export default { setup(ctx) {
    let seen = 0;
    ctx.check("counts something", () => ({ verdict: "pass", detail: seen + " seen" }));
    ctx.check("has had no opportunity", () => ({ verdict: "n/a" }));
    ctx.check("throws", () => { throw new Error("no such element"); });
    ctx.check("answers nonsense", () => ({ verdict: "green" }));
  } };`,
      };
      const booted = await boot({ plugins: [checkerPlugin] });
      try {
        const groups = await booted.page.evaluate(() => {
          const bridge = (
            globalThis as {
              __rigline?: {
                checks: {
                  run(): readonly {
                    contributor: string;
                    failing: number;
                    results: readonly { name: string; verdict: string; detail: string }[];
                  }[];
                } | null;
              };
            }
          ).__rigline;
          return bridge?.checks?.run() ?? null;
        });

        expect(groups).not.toBeNull();
        const names = (groups ?? []).map((g) => g.contributor);
        expect(names[0]).toBe("core");
        expect(names).toContain("checker");

        // core carries the kernel's own lines and every capability module's, keyed by capability.
        const core = (groups ?? []).find((g) => g.contributor === "core");
        expect(core?.results.map((r) => r.name)).toEqual(
          expect.arrayContaining(["tables loaded", "mount: re-placement after a re-render"]),
        );
        expect(core?.results.find((r) => r.name === "tables loaded")?.detail).toBe(VERSION);

        const checker = (groups ?? []).find((g) => g.contributor === "checker");
        expect(checker?.results.map((r) => [r.name, r.verdict])).toEqual([
          ["counts something", "pass"],
          ["has had no opportunity", "n/a"],
          ["throws", "fail"],
          ["answers nonsense", "fail"],
        ]);
        expect(checker?.failing).toBe(2);
        expect(checker?.results[2]?.detail).toContain("no such element");
        expect(checker?.results[3]?.detail).toContain("not a verdict");

        // The point of the decision: neither the throw nor the nonsense disabled the plugin, and
        // neither reached diagnostics.errors, where it would have been counted a second time.
        const d = await booted.diagnostics();
        expect(d.plugins).toContainEqual({ name: "checker", status: "loaded" });
        expect(d.errors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
