/**
 * The editor context against the real bundle (D150): held on the panel's own session until the
 * person ticks Rigline's chip, sent with one message, and held again. Every attachment is read off
 * the fake host's transport, and Claude Code's chip is counted by the frames that show it, since a
 * new session brings a new footer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SaveRecord } from "@rigline/plugin-api/internal";
import { describe, expect, it } from "vitest";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const skipReason = await harnessSkipReason(VERSION);

const EDITOR = 'div[contenteditable][role="textbox"]';
const THEIRS = ".selectionChip_gGYT1w";
const OURS = "label.rigline-attach";
const BOX = "input[data-rigline-attach]";
const COMPANION: SaveRecord = { token: "c".repeat(32), scheme: "vscode" };

/** What the extension host sends, as its selection builder makes it. */
const LINES = {
  filePath: "c:\\work\\notes.md",
  sourceUri: "file:///c%3A/work/notes.md",
  startLine: 10,
  endLine: 12,
  startColumn: 0,
  endColumn: 4,
  selectedText: "remember the thing\nand the other thing\nend",
};
const FILE = {
  filePath: "c:\\work\\app.ts",
  sourceUri: "file:///c%3A/work/app.ts",
  startLine: 3,
  endLine: 3,
};

interface AttachWindow {
  readonly __harness: {
    push(message: unknown): void;
    pushRecord(record: unknown): void;
    readonly sent: readonly unknown[];
  };
  __shown?: number;
}

describe.skipIf(skipReason !== null)(
  `the editor context against the real bundle${skipReason ? ` (${skipReason})` : ""}`,
  () => {
    const boot = register(VERSION);
    type Booted = Awaited<ReturnType<typeof boot>>;

    async function push(booted: Booted, message: unknown): Promise<void> {
      await booted.page.evaluate((m) => {
        (window as unknown as AttachWindow).__harness.push(m);
      }, message);
    }

    async function select(booted: Booted, selection: unknown): Promise<void> {
      await push(booted, {
        type: "request",
        channelId: "",
        requestId: "attach-selection",
        request: { type: "selection_changed", selection },
      });
      await booted.page.waitForTimeout(150);
    }

    /** Sends `text`, ends the turn, and returns the `io_message` that carried it, as JSON. */
    async function send(booted: Booted, text: string): Promise<string> {
      await booted.page.click(EDITOR);
      await booted.page.keyboard.type(text);
      await booted.page.keyboard.press("Enter");
      await booted.page.waitForTimeout(300);
      const all = await booted.page.evaluate(
        () => (window as unknown as AttachWindow).__harness.sent,
      );
      const carried = all
        .filter((m) => (m as { readonly type?: unknown }).type === "io_message")
        .map((m) => JSON.stringify(m))
        .find((m) => m.includes(text));
      await booted.page.evaluate(() =>
        (window as unknown as AttachWindow).__harness.pushRecord({
          type: "result",
          subtype: "success",
          is_error: false,
        }),
      );
      await booted.page.waitForTimeout(200);
      if (carried === undefined) throw new Error(`"${text}" was never sent`);
      return carried;
    }

    /** From now on, counts each frame that shows Claude Code's chip. */
    async function countShown(booted: Booted): Promise<void> {
      await booted.page.evaluate((chip) => {
        const w = window as unknown as AttachWindow;
        w.__shown = 0;
        const frame = (): void => {
          const element = document.querySelector(chip);
          if (element !== null && getComputedStyle(element).display !== "none") w.__shown! += 1;
          requestAnimationFrame(frame);
        };
        frame();
      }, THEIRS);
    }

    const shown = (booted: Booted): Promise<number> =>
      booted.page.evaluate(() => (window as unknown as AttachWindow).__shown ?? -1);

    async function line(booted: Booted): Promise<string | undefined> {
      return booted.page.evaluate(() => {
        const bridge = (
          window as unknown as {
            __rigline?: {
              checks?: {
                run(): readonly {
                  results: readonly { name: string; verdict: string; detail: string }[];
                }[];
              } | null;
            };
          }
        ).__rigline;
        const found = (bridge?.checks?.run() ?? [])
          .flatMap((g) => g.results)
          .find((result) => result.name === "editor context");
        return found ? `${found.verdict}: ${found.detail}` : undefined;
      });
    }

    it("holds the selection until it is ticked, sends it with one message, and holds it again", async () => {
      const booted = await boot();
      try {
        await countShown(booted);
        await select(booted, LINES);
        await booted.page.waitForSelector(OURS);
        expect(await booted.page.textContent(OURS)).toBe("notes.md:10-12");
        expect(await booted.page.isChecked(BOX)).toBe(false);
        // In the footer at the end of its left cluster, ahead of the RIG pill (D54).
        expect(
          await booted.page.evaluate((chip) => {
            const slot = document.querySelector(chip)?.closest("[data-rigline-slot]");
            const pill = slot?.nextElementSibling;
            return [
              slot?.parentElement?.classList.contains("inputFooter_gGYT1w"),
              pill?.querySelector(".rigline-pill") !== null,
              pill?.nextElementSibling?.classList.contains("spacer_gGYT1w"),
            ];
          }, OURS),
        ).toEqual([true, true, true]);
        expect(await booted.page.getAttribute(OURS, "title")).toBe(
          "Showing Claude your current file selection (3 lines selected)",
        );
        expect(await send(booted, "held prompt")).not.toContain("ide_selection");

        await booted.page.click(BOX);
        expect(await booted.page.isChecked(BOX)).toBe(true);
        // The composer kept the focus, so the prompt goes on being typed where it was.
        expect(await booted.page.evaluate(() => document.activeElement?.role)).toBe("textbox");
        expect(await send(booted, "ticked prompt")).toContain("<ide_selection>");
        // One message: held again after it, with nothing new selected.
        expect(await booted.page.isChecked(BOX)).toBe(false);
        expect(await send(booted, "next prompt")).not.toContain("ide_selection");

        // The same lines ticked again go again, though the panel counts them as sent already.
        await booted.page.click(BOX);
        expect(await send(booted, "again prompt")).toContain("<ide_selection>");

        expect(await shown(booted)).toBe(0);
        expect(await line(booted)).toBe("pass: ask: 1 session(s) held, 2 ticked, 2 sent");
        expect(booted.consoleErrors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("holds the open file the same way, ignores a scripted tick, and holds a new session's seed", async () => {
      const booted = await boot();
      try {
        await countShown(booted);
        await select(booted, FILE);
        await booted.page.waitForSelector(OURS);
        expect(await booted.page.textContent(OURS)).toBe("app.ts");
        await booted.page.evaluate((box) => {
          (document.querySelector(box) as HTMLInputElement).click();
        }, BOX);
        expect(await booted.page.isChecked(BOX)).toBe(false);
        expect(await send(booted, "file held")).not.toContain("ide_opened_file");

        // A new conversation in this panel, which the panel seeds with the selection as it makes it.
        await push(booted, {
          type: "request",
          channelId: "",
          requestId: "attach-state",
          request: {
            type: "update_state",
            config: {},
            state: { authStatus: {}, experimentGates: {}, openNewInTab: false },
          },
        });
        await booted.page.waitForTimeout(200);
        await push(booted, {
          type: "request",
          channelId: "",
          requestId: "attach-new",
          request: { type: "create_new_conversation" },
        });
        await booted.page.waitForTimeout(800);
        expect(await booted.page.textContent(OURS)).toBe("app.ts");
        expect(await booted.page.isChecked(BOX)).toBe(false);

        await booted.page.click(BOX);
        expect(await send(booted, "file ticked")).toContain("<ide_opened_file>");
        expect(await shown(booted)).toBe(0);
        expect(await line(booted)).toMatch(/^pass: ask: 2 session\(s\) held, 1 ticked, 1 sent$/);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("follows a held file to lines selected in it, and shows an excluded file's selection as the file", async () => {
      const booted = await boot();
      try {
        // The cursor in notes.md, held; then text selected in the same file.
        await select(booted, { ...FILE, filePath: LINES.filePath, sourceUri: LINES.sourceUri });
        await booted.page.waitForSelector(OURS);
        expect(await booted.page.textContent(OURS)).toBe("notes.md");
        expect(await booted.page.getAttribute(OURS, "title")).toBe(
          "Showing Claude your current file selection (notes.md)",
        );
        await select(booted, LINES);
        expect(await booted.page.textContent(OURS)).toBe("notes.md:10-12");

        // A file Claude Code excludes, by its patterns or a .gitignore, arrives with lines but no
        // text, and Claude Code's own chip and block treat it as the file alone.
        const { selectedText: _, ...excluded } = { ...LINES, startLine: 20, endLine: 21 };
        await select(booted, excluded);
        expect(await booted.page.textContent(OURS)).toBe("notes.md");
        await booted.page.click(BOX);
        const sent = await send(booted, "excluded ticked");
        expect(sent).toContain("<ide_opened_file>");
        expect(sent).not.toContain("ide_selection");
      } finally {
        await booted.close();
      }
    }, 30000);

    it("holds and ticks the same way in the sidebar", async () => {
      const booted = await boot({ surface: "sidebar" });
      try {
        await countShown(booted);
        await select(booted, LINES);
        await booted.page.waitForSelector(OURS);
        expect(await send(booted, "sidebar held")).not.toContain("ide_selection");
        await booted.page.click(BOX);
        expect(await send(booted, "sidebar ticked")).toContain("<ide_selection>");
        expect(await booted.page.isChecked(BOX)).toBe(false);
        expect(await shown(booted)).toBe(0);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("leaves Claude Code's chip and its attachment alone when set to always", async () => {
      const booted = await boot({ editor: { attach: "always" } });
      try {
        await select(booted, LINES);
        await booted.page.waitForSelector(THEIRS);
        expect(await booted.page.locator(OURS).count()).toBe(0);
        expect(await send(booted, "always prompt")).toContain("<ide_selection>");
        expect(await line(booted)).toBe("n/a: always: Claude Code's own chip");
      } finally {
        await booted.close();
      }
    });

    it("refuses by name where an identifier is gone, and leaves Claude Code's chip in place", async () => {
      const booted = await boot({ remove: { anchors: ["selectionChip"] } });
      try {
        await select(booted, LINES);
        await booted.page.waitForSelector(THEIRS);
        expect(await booted.page.locator(OURS).count()).toBe(0);
        expect(await send(booted, "refused prompt")).toContain("<ide_selection>");
        expect(await line(booted)).toMatch(
          /^fail: Claude Code's own chip is in place: anchor "selectionChip" does not resolve/,
        );
      } finally {
        await booted.close();
      }
    });

    it("gives the panel back when the hold stops reaching its session", async () => {
      const booted = await boot();
      try {
        await booted.page.evaluate(() => {
          // The footer's own session, found as the host finds it, made to ignore the hold.
          const spacer = document.querySelector(".inputFooter_gGYT1w .spacer_gGYT1w");
          const key = spacer
            ? Object.keys(spacer).find((k) => k.startsWith("__reactFiber$"))
            : null;
          let fiber = key ? (spacer as unknown as Record<string, unknown>)[key] : null;
          for (let i = 0; fiber && i < 8; i++) {
            const session = (fiber as { memoizedProps?: { session?: Record<string, unknown> } })
              .memoizedProps?.session;
            if (session && typeof session.dismissSelection === "function") {
              session.dismissSelection = () => {};
              return;
            }
            fiber = (fiber as { return?: unknown }).return;
          }
          throw new Error("no session");
        });
        await select(booted, LINES);
        await booted.page.waitForTimeout(800);
        expect(await booted.page.isVisible(THEIRS)).toBe(true);
        expect(await booted.page.locator(OURS).count()).toBe(0);
        expect(await line(booted)).toMatch(/^fail: Claude Code's chip stayed in the footer/);
        expect(await send(booted, "stray prompt")).toContain("<ide_selection>");
      } finally {
        await booted.close();
      }
    });

    it("switched to always from Rigline's tab, gives back what it held once the save lands", async () => {
      const booted = await boot({ save: COMPANION });
      const { page } = booted;
      try {
        await select(booted, LINES);
        await page.waitForSelector(OURS);
        await page.click(".rigline-pill");
        await page.getByRole("menuitem", { name: /^Settings…/ }).click();
        await page.getByText("Always", { exact: true }).click();
        expect(await page.getByRole("radio", { name: "Always" }).isChecked()).toBe(true);
        await page.evaluate(() => {
          (
            document.querySelector('a[href^="vscode://rigline.rigline/settings?p="]') as HTMLElement
          ).click();
        });
        const path = join(booted.payloadDir, "registry.js");
        writeFileSync(
          path,
          readFileSync(path, "utf8").replace(
            /^export const editor = .*;$/m,
            `export const editor = ${JSON.stringify({ attach: "always" })};`,
          ),
        );
        await page.waitForSelector(THEIRS, { state: "visible", timeout: 5000 });
        expect(await page.locator(OURS).count()).toBe(0);
        expect(await send(booted, "given back")).toContain("<ide_selection>");
        expect((await booted.diagnostics()).errors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);
  },
);
