/**
 * The host kernel's own DOM behaviour against the real webview bundle, headless, no VS Code: the
 * third verification tier docs/host.md's "Verification" section names. Each first-party plugin has
 * its own file beside this one; what is here is the kernel, through fixture plugins small enough to
 * read in one screen.
 *
 * Skips with a reason, rather than failing, when the corpus snapshot or a launchable Chromium is
 * absent, so a fresh clone without either is not blocked. The scaffolding is in src/suite.ts.
 */
import { EMPTY_DECLARATIONS } from "@rigline/plugin-api";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register } from "../src/suite.ts";

const VERSION = "2.1.270";

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
        console.log(`[harness] boot to .modelPill_gGYT1w: ${booted.bootMs.toFixed(0)}ms`);
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
          const pill = document.getElementsByClassName("modelPill_gGYT1w")[0] ?? null;
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
        expect(d.mounts.active).toBeGreaterThan(0);
      } finally {
        await booted.close();
      }
    }, 20000);

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
  },
);
