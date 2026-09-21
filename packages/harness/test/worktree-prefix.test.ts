/**
 * worktree-prefix against the real bundle. The plugin is pure bus logic — it touches no DOM at
 * all — so unlike kernel.test.ts's fixtures this file never asserts on a rendered element; every
 * assertion reads `rename_tab` titles off the fake host's transport (src/suite.ts's `sent()`).
 * Structure copied from kernel.test.ts; the shared scaffolding is in src/suite.ts.
 *
 * The plugin's own decision state (`observedWorktree`, `defaultCwd`, the session-list map) is
 * driven directly over the bus rather than through a real session or a real worktree: every
 * host->webview message this needs (`update_session_state`, `update_state`, a wrapped
 * `list_sessions_response`, an `io_message` carrying a `tool_use` block) is pushed unprompted
 * through `window.__harness.push` (src/page.ts), exactly the shape `pre.ts`'s tap() expects. This
 * mirrors the 0.x harness's own `hosts()`/`reply()`/`tool()` helpers, and it means the session id
 * this test assigns need not match whatever id the app's own real session happens to hold — the
 * rewrite chain only ever consults worktree-prefix's own state, never the app's.
 *
 * Two things this harness genuinely cannot exercise, noted here rather than silently skipped:
 * - The host patch (`includeWorktrees`). This fixture has no `extension.js` at all, only the
 *   webview bundle and a scripted reply table, so there is no session-list *fetch* to patch. Only
 *   the two capabilities the webview half of the plugin actually uses are covered here; the patch
 *   is exercised by grepping the real corpus (see the plugin's own report) and can only be
 *   confirmed live, per the staged plan that capability was designed to.
 * - Inventory behaviour 19 ("if the app has never sent rename_tab yet, an EnterWorktree
 *   observation has nothing to resend"). The fake host's `init` reply admits `openNewInTab`, so the
 *   app sends its first `rename_tab` very early and unpredictably relative to plugin load — there
 *   is no reliable way in this harness to observe a tool call *before* that first send without
 *   racing it, and `resend()`'s "false when nothing was sent" branch is already covered directly by
 *   `packages/host/test/pre.test.ts`.
 *
 * A companion fixture, `pulse`, stands in for "the app happens to resend rename_tab on its own" (a
 * visibility toggle, a permission event): `window.__pulse(mark?)` calls `ctx.resend("rename_tab")`,
 * and — since the rewrite chain for one type is shared across every plugin that declared it — the
 * resend still runs worktree-prefix's own rewriter with its current state. This is what lets a test
 * observe the list-based detection path, which (unlike the tool-call path) never resends on its own
 * by design. `mark`, when given, is `pulse`'s own patch applied ahead of worktree-prefix's in
 * registry order, standing in for a title that has already been marked by the time worktree-prefix
 * sees it (see "does not double an already-prefixed title" below).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FixturePlugin } from "../src/payload.ts";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

/**
 * What the plugin puts between the worktree label and the app's own title. Written out here rather
 * than imported from the plugin on purpose: a test that reads the same constant as the code cannot
 * notice the constant changing, and this one is user-visible on every tab.
 */
const SEP = " › ";
const skipReason = await harnessSkipReason(VERSION);

// The plugin's own built output, not a hand-copied stand-in: this drives what actually ships.
// Requires `pnpm build` to have produced plugins/worktree-prefix/dist/index.js first, the same
// dependency src/payload.ts already has on packages/host/dist/pre.js.
const DIST = fileURLToPath(
  new URL("../../../plugins/worktree-prefix/dist/index.js", import.meta.url),
);

const worktreePrefixPlugin: FixturePlugin = {
  name: "worktree-prefix",
  manifest: {
    surfaces: ["editor", "sidebar"],
    uses: {
      session: true,
      tools: true,
      messages: ["list_sessions_response", "update_state", "init_response"],
      rewrites: { rename_tab: ["title"] },
    },
  },
  source: readFileSync(DIST, "utf8"),
};

/**
 * Stands in for "the app happens to resend rename_tab on its own" (a visibility toggle, a
 * permission event) — the trigger the list-detection path relies on and never provides itself.
 * `window.__pulse(mark?)` forces the whole chain to run again; when a plugin registered before
 * worktree-prefix in this test's registry order needs to simulate an already-marked title arriving
 * from upstream (the "does not double up" scenario), `mark` is applied first, in this plugin's own
 * declared rewrite, so worktree-prefix's own idempotency check is what is actually under test.
 */
const pulsePlugin: FixturePlugin = {
  name: "pulse",
  manifest: { uses: { rewrites: { rename_tab: ["title"] } } },
  source: `export default { setup(ctx) {
    let mark = null;
    window.__pulse = (m) => {
      mark = m || null;
      ctx.resend("rename_tab");
    };
    ctx.rewrite("rename_tab", (payload) => {
      if (!mark) return null;
      const title = typeof payload.title === "string" ? payload.title : "";
      return { title: mark + title };
    });
  } };`,
};

const WORKTREE_NAME = "TD-1234-close-the-write-leak";
const WORKTREE_PATH = "C:\\dev\\ai\\atlas\\.claude\\worktrees\\TD-1234-close-the-write-leak";
const WORKTREE_PATH_UPPER_DRIVE =
  "C:\\DEV\\AI\\atlas\\.claude\\worktrees\\TD-1234-close-the-write-leak";
const MAIN_CWD = "c:\\dev\\ai\\atlas";

describe.skipIf(skipReason !== null)(
  `worktree-prefix against the real bundle${skipReason ? ` (${skipReason})` : ""}`,
  () => {
    const boot = register(VERSION);
    type Booted = Awaited<ReturnType<typeof boot>>;

    /** One unprompted host->webview message, exactly as `pre.ts`'s tap() expects it. */
    async function push(booted: Booted, message: unknown): Promise<void> {
      await booted.page.evaluate((m) => {
        (window as unknown as { __harness: { push: (msg: unknown) => void } }).__harness.push(m);
      }, message);
    }

    /** `window.__pulse(mark?)`: force the whole rename_tab chain to run again, right now. */
    async function pulse(booted: Booted, mark?: string): Promise<void> {
      await booted.page.waitForFunction(
        () => typeof (window as unknown as { __pulse?: unknown }).__pulse === "function",
      );
      await booted.page.evaluate(
        (m) => (window as unknown as { __pulse: (mark: string | undefined) => void }).__pulse(m),
        mark,
      );
    }

    async function hostSession(
      booted: Booted,
      sessionId: string | null,
      extra: Record<string, unknown> = {},
    ): Promise<void> {
      await push(booted, { type: "update_session_state", sessionId, ...extra });
    }

    async function hostDefaultCwd(booted: Booted, cwd: string): Promise<void> {
      await push(booted, { type: "update_state", state: { defaultCwd: cwd } });
    }

    async function hostSessionList(
      booted: Booted,
      sessions: readonly Record<string, unknown>[],
    ): Promise<void> {
      await push(booted, {
        type: "response",
        requestId: `harness-list-${Math.random().toString(36).slice(2)}`,
        response: { type: "list_sessions_response", sessions },
      });
    }

    /**
     * A whole tool call: the assistant's `tool_use` block and then the `tool_result` that settles
     * it, because the plugin acts on the outcome and not the intention (D51). `ok: false` pushes a
     * call the user declined or that failed, which is the case the plugin must ignore.
     */
    async function hostTool(
      booted: Booted,
      name: string,
      input: Record<string, unknown>,
      ok = true,
    ): Promise<void> {
      const id = `tool-${Math.random().toString(36).slice(2)}`;
      const envelope = (message: Record<string, unknown>) => ({
        type: "io_message",
        channelId: "harness-tool-channel",
        message: {
          uuid: `tool-msg-${Math.random().toString(36).slice(2)}`,
          timestamp: new Date().toISOString(),
          ...message,
        },
      });
      await push(
        booted,
        envelope({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
        }),
      );
      await push(
        booted,
        envelope({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: id,
                content: ok ? "done" : "The user doesn't want to proceed",
                is_error: !ok,
              },
            ],
          },
        }),
      );
    }

    /** Every `rename_tab` title actually sent, in order. */
    async function titles(booted: Booted): Promise<(string | null)[]> {
      const sent = await booted.sent();
      return sent
        .filter((m) => m.request?.type === "rename_tab")
        .map((m) => (typeof m.request?.title === "string" ? (m.request?.title as string) : null));
    }

    async function waitForRenameCount(booted: Booted, count: number): Promise<void> {
      await booted.page.waitForFunction((n) => {
        const sent =
          (
            window as unknown as {
              __harness?: { sent: { request?: { type: string } }[] };
            }
          ).__harness?.sent ?? [];
        return sent.filter((m) => m.request?.type === "rename_tab").length >= n;
      }, count);
    }

    it("passes rename_tab through unmodified before anything is known, and leaves a main-checkout session untouched", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1);
        expect(bare).not.toBeNull();

        await hostSession(booted, "s-main");
        await hostSessionList(booted, [
          { id: "s-main", worktree: undefined },
          { id: "s-other", worktree: { name: WORKTREE_NAME, path: WORKTREE_PATH } },
        ]);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(bare);

        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("prefixes a session known via the list with its ticket key, reapplies identically, and never doubles it up", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;

        await hostSession(booted, "s-worktree");
        await hostSessionList(booted, [
          { id: "s-worktree", worktree: { name: WORKTREE_NAME, path: WORKTREE_PATH } },
        ]);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);
        // Pinned literally, once: a hyphen here is indistinguishable from one inside a session
        // title, which is the ambiguity the separator exists to remove.
        expect((await titles(booted)).at(-1)).toBe(`TD-1234 › ${bare}`);

        // Same field, same state, same original: resend() always replays the app's pristine
        // title, never the chain's last output, so a second resend must reapply identically
        // rather than compounding.
        await pulse(booted);
        await waitForRenameCount(booted, 3);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("does not double an already-prefixed title", async () => {
      // resend() always replays the app's pristine, never-prefixed original (pre.ts's
      // lastOutbound), so there is no natural way in this harness to hand worktree-prefix's own
      // rewrite a title it already marked. What is directly testable is the guard itself: with
      // `pulse` registered ahead of worktree-prefix in registry order, its patch is what
      // worktree-prefix's own handler sees as `payload.title` — standing in for "something
      // upstream echoed a previously-marked title back", the hypothetical the guard's doc comment
      // names. `pulse` is told to apply the *same* marker worktree-prefix's own state independently
      // computes, so a passing test proves worktree-prefix's idempotency check, not a coincidence
      // of two different markers happening not to collide.
      const booted = await boot({ plugins: [pulsePlugin, worktreePrefixPlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;

        await hostSession(booted, "s-worktree");
        await hostSessionList(booted, [
          { id: "s-worktree", worktree: { name: WORKTREE_NAME, path: WORKTREE_PATH } },
        ]);
        await pulse(booted, `TD-1234${SEP}`);
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("falls back to 8-character truncation for a non-ticket worktree name, end to end", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;

        await hostSession(booted, "s-spike");
        await hostSessionList(booted, [
          {
            id: "s-spike",
            worktree: {
              name: "spike-new-parser",
              path: "C:\\dev\\ai\\atlas\\.claude\\worktrees\\spike-new-parser",
            },
          },
        ]);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        // "spike": eight characters is a budget, and the cut lands on the word boundary inside it
        // rather than mid-token. The 0.x prototype's blind slice gave "spike-ne", which is how a
        // name that happens to be ticket-shaped became a different, plausible ticket number.
        expect((await titles(booted)).at(-1)).toBe(`spike${SEP}${bare}`);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("withholds the prefix when the workspace itself is rooted on the worktree, even across a drive-letter case mismatch", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;

        await hostSession(booted, "s-worktree");
        await hostDefaultCwd(booted, WORKTREE_PATH_UPPER_DRIVE);
        await hostSessionList(booted, [
          { id: "s-worktree", worktree: { name: WORKTREE_NAME, path: WORKTREE_PATH } },
        ]);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        // Same observed transcript discrepancy the unit test covers, exercised end to end: the
        // suppression must still fire when defaultCwd and the worktree's own path agree only after
        // folding case.
        expect((await titles(booted)).at(-1)).toBe(bare);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("drops the prefix on an explicit farewell, and picks up the next session's own state", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;

        await hostSession(booted, "s-worktree");
        await hostSessionList(booted, [
          { id: "s-worktree", worktree: { name: WORKTREE_NAME, path: WORKTREE_PATH } },
          { id: "s-main", worktree: undefined },
        ]);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);

        // The farewell names the session currently hosted, so it is read as "hosting nothing" —
        // not "keep whatever was last known" — and the prefix must drop with it.
        await hostSession(booted, "s-worktree", { isFarewell: true });
        await pulse(booted);
        await waitForRenameCount(booted, 3);
        expect((await titles(booted)).at(-1)).toBe(bare);

        // A plain switch to a different, unrelated session must not inherit the departed
        // session's state.
        await hostSession(booted, "s-main");
        await pulse(booted);
        await waitForRenameCount(booted, 4);
        expect((await titles(booted)).at(-1)).toBe(bare);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("prefixes the moment an EnterWorktree tool call is observed, with no list entry involved at all, and reverts on ExitWorktree", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;
        await hostSession(booted, "s-migrated");

        // The scenario the whole feature exists for: the session list will never mention this
        // session again (it migrated its transcript out from under the window's own listing), so
        // there is nothing here but the observed tool call itself.
        await hostTool(booted, "EnterWorktree", { name: WORKTREE_NAME });
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);

        await hostTool(booted, "ExitWorktree", {});
        await waitForRenameCount(booted, 3);
        expect((await titles(booted)).at(-1)).toBe(bare);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("ignores a worktree move that was declined or failed, and is not confused by it afterwards", async () => {
      // The reason this plugin reads results rather than calls (D51). A declined EnterWorktree is
      // a call the assistant made and the session did not complete: acting on it renames a real
      // VS Code tab after a move that never happened, and nothing on screen says otherwise.
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;
        await hostSession(booted, "s-declined");

        await hostTool(booted, "EnterWorktree", { name: WORKTREE_NAME }, false);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(bare);

        // And the failure left nothing behind: the next attempt, which does succeed, still lands.
        await hostTool(booted, "EnterWorktree", { name: WORKTREE_NAME });
        await waitForRenameCount(booted, 3);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);

        // A failed exit is refused the same way, and does not strip a prefix that still holds.
        await hostTool(booted, "ExitWorktree", {}, false);
        await pulse(booted);
        await waitForRenameCount(booted, 4);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("an observed tool-call move outranks a disagreeing session-list entry, and is not undone by a stale one", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;

        await hostSession(booted, "s-worktree");
        await hostSessionList(booted, [
          { id: "s-worktree", worktree: { name: WORKTREE_NAME, path: WORKTREE_PATH } },
        ]);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(`TD-1234${SEP}${bare}`);

        // A later observed move to a *different* worktree must win over the list's answer.
        await hostTool(booted, "EnterWorktree", { name: "OT-9" });
        await waitForRenameCount(booted, 3);
        expect((await titles(booted)).at(-1)).toBe(`OT-9${SEP}${bare}`);

        // An observed exit is a positive answer; the list entry (never refreshed) still claims a
        // worktree, and must not resurrect the prefix.
        await hostTool(booted, "ExitWorktree", {});
        await waitForRenameCount(booted, 4);
        expect((await titles(booted)).at(-1)).toBe(bare);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("applies the workspace-is-the-worktree suppression to the tool-observed path too, by comparing defaultCwd's last segment", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        const bare = (await titles(booted)).at(-1) as string;

        await hostSession(booted, "s-worktree");
        await hostDefaultCwd(booted, WORKTREE_PATH);
        // The {name} form of EnterWorktree carries no path to compare directly, so the gate falls
        // back to defaultCwd's own last segment.
        await hostTool(booted, "EnterWorktree", { name: WORKTREE_NAME });
        await waitForRenameCount(booted, 2);
        expect((await titles(booted)).at(-1)).toBe(bare);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("makes no change and puts no extra traffic on the bus for an unrelated tool call or a re-entry of the same worktree", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        await hostSession(booted, "s-worktree");

        await hostTool(booted, "Bash", { command: "ls" });
        await booted.page.waitForTimeout(300);
        const afterBash = (await titles(booted)).length;

        await hostTool(booted, "EnterWorktree", { name: WORKTREE_NAME });
        await waitForRenameCount(booted, afterBash + 1);
        const afterEnter = (await titles(booted)).length;

        // Re-entering the *same* worktree observed a moment ago changes nothing worth resending.
        await hostTool(booted, "EnterWorktree", { name: WORKTREE_NAME });
        await booted.page.waitForTimeout(300);
        expect((await titles(booted)).length).toBe(afterEnter);

        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 20000);

    it("never causes the host to record a diagnostics error across a full worktree-entering, tab-renaming sequence", async () => {
      const booted = await boot({ plugins: [worktreePrefixPlugin, pulsePlugin] });
      try {
        await waitForRenameCount(booted, 1);
        await hostSession(booted, "s-worktree");
        await hostDefaultCwd(booted, MAIN_CWD);
        await hostSessionList(booted, [
          { id: "s-worktree", worktree: { name: WORKTREE_NAME, path: WORKTREE_PATH } },
        ]);
        await pulse(booted);
        await waitForRenameCount(booted, 2);
        await hostTool(booted, "EnterWorktree", { name: "OT-9" });
        await waitForRenameCount(booted, 3);
        await hostTool(booted, "ExitWorktree", {});
        await waitForRenameCount(booted, 4);

        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
        expect(booted.consoleErrors).toEqual([]);
        // At least three chain runs (the list-based pulse and the two tool-observed resends —
        // the natural boot-time send may or may not be among them, racing this plugin's own
        // registration same as kernel.test.ts's "rewrites an outbound rename_tab" describes), but
        // only two *applied* a patch: entering OT-9 reverses the ExitWorktree that follows it back
        // to the bare title, which is correctly a null patch, not a no-op run.
        const record = d.rewrites.find(
          (r) => r.plugin === "worktree-prefix" && r.type === "rename_tab",
        );
        expect(record?.ran).toBeGreaterThanOrEqual(3);
        expect(record?.applied).toBeGreaterThanOrEqual(2);
      } finally {
        await booted.close();
      }
    }, 20000);
  },
);
