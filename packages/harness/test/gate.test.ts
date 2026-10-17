/**
 * The model gate against the real bundle (D139): what it holds, what it leaves alone, and what lifts
 * it. Every send is read off the fake host's transport, since a held prompt is one that never
 * reached it.
 */
import type { ModelSettings } from "@rigline/plugin-api/internal";
import { describe, expect, it, vi } from "vitest";
import { harnessSkipReason, register, HARNESS_VERSION as VERSION } from "../src/suite.ts";

const skipReason = await harnessSkipReason(VERSION);

const EDITOR = 'div[contenteditable][role="textbox"]';
const STRIP = "[data-rigline-gate]";
const SEND = ".rigline-gate-send";

const ALWAYS: ModelSettings = { requireChoice: "always", default: null };
const UNLESS_DEFAULT: ModelSettings = {
  requireChoice: "unlessDefault",
  default: { model: "opus", effort: "high" },
};

const MODELS = [
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    supportsEffort: true,
    supportedEffortLevels: ["medium", "high"],
  },
  { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku" },
];

interface GateWindow {
  readonly __harness?: {
    readonly push: (message: unknown) => void;
    readonly sent: readonly unknown[];
  };
}

describe.skipIf(skipReason !== null)(
  `the model gate against the real bundle${skipReason ? ` (${skipReason})` : ""}`,
  () => {
    const boot = register(VERSION);
    type Booted = Awaited<ReturnType<typeof boot>>;

    async function push(booted: Booted, message: unknown): Promise<void> {
      await booted.page.evaluate((m) => {
        const harness = (window as unknown as GateWindow).__harness;
        if (!harness) throw new Error("harness missing");
        harness.push(m);
      }, message);
    }

    /**
     * The model list and what is live, on `update_state` as the extension host pushes them, so the
     * panel's own picker draws them too. Auth is kept so the panel stays signed in.
     */
    async function live(
      booted: Booted,
      setting: string,
      effort: string | null,
      extra: Record<string, unknown> = {},
    ): Promise<void> {
      await push(booted, {
        type: "request",
        channelId: "",
        requestId: "gate-state",
        request: {
          type: "update_state",
          config: { models: MODELS },
          state: {
            authStatus: {},
            experimentGates: {},
            openNewInTab: true,
            modelSetting: setting,
            settings: effort === null ? {} : { effortLevel: effort },
            ...extra,
          },
        },
      });
    }

    /** How many prompts carrying `text` reached the fake host. */
    async function sent(booted: Booted, text: string): Promise<number> {
      const all = await booted.page.evaluate(
        () => (window as unknown as GateWindow).__harness?.sent ?? [],
      );
      return all.filter(
        (m) =>
          (m as { readonly type?: unknown }).type === "io_message" &&
          JSON.stringify(m).includes(text),
      ).length;
    }

    async function type(booted: Booted, text: string): Promise<void> {
      await booted.page.click(EDITOR);
      await booted.page.keyboard.type(text);
    }

    async function gateLine(booted: Booted): Promise<string | undefined> {
      return booted.page.evaluate(() => {
        const bridge = (
          window as unknown as {
            __rigline?: {
              checks?: {
                run(): readonly {
                  contributor: string;
                  results: readonly { name: string; verdict: string; detail: string }[];
                }[];
              } | null;
            };
          }
        ).__rigline;
        const groups = bridge?.checks?.run() ?? [];
        const line = groups
          .flatMap((g) => g.results)
          .find((result) => result.name === "model gate");
        return line ? `${line.verdict}: ${line.detail}` : undefined;
      });
    }

    it("holds a send until something chooses, keeping the text, and lets the override send it", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        await live(booted, "opus", "high");
        await type(booted, "hello gate");
        await booted.page.keyboard.press("Enter");

        // Held: the strip names what is live, with its version, and nothing went out.
        await booted.page.waitForSelector(`${STRIP}:not([hidden])`);
        expect(await booted.page.textContent(SEND)).toBe("Send with Opus 5.5 · high");
        await booted.page.waitForTimeout(200);
        expect(await sent(booted, "hello gate")).toBe(0);
        expect(await booted.page.textContent(EDITOR)).toBe("hello gate");

        // The override sends what was typed, through the composer's own submit.
        await booted.page.click(SEND);
        await vi.waitFor(async () => {
          expect(await sent(booted, "hello gate")).toBe(1);
        });
        expect(await booted.page.isHidden(STRIP)).toBe(true);

        // And it counted as the session's choice, so the next send goes straight out.
        await type(booted, "second prompt");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          expect(await sent(booted, "second prompt")).toBe(1);
        });
        expect(await gateLine(booted)).toBe("pass: always: 1 held, 1 sent anyway");
        const d = await booted.diagnostics();
        expect(d.errors).toEqual([]);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("says so before anything is sent, and keeps what is live without sending when nothing is typed", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        await live(booted, "opus", "high");
        // Shown as soon as the session needs a choice, so Enter is never a guess.
        await booted.page.waitForSelector(`${STRIP}:not([hidden])`);
        expect(await booted.page.textContent(`${STRIP} span`)).toBe(
          "No model chosen for this session.",
        );
        expect(await booted.page.textContent(SEND)).toBe("Use Opus 5.5 · high");
        await type(booted, "typed");
        expect(await booted.page.textContent(SEND)).toBe("Send with Opus 5.5 · high");
        await booted.page.keyboard.press("ControlOrMeta+a");
        await booted.page.keyboard.press("Backspace");
        expect(await booted.page.textContent(SEND)).toBe("Use Opus 5.5 · high");

        await booted.page.click(SEND);
        await booted.page.waitForSelector(STRIP, { state: "hidden" });
        expect(await gateLine(booted)).toBe("pass: always: 0 held, 0 sent anyway");
        await type(booted, "chosen");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          expect(await sent(booted, "chosen")).toBe(1);
        });
      } finally {
        await booted.close();
      }
    }, 30000);

    it("never asks in a resumed session, which carries the choice it started with", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        // As the panel launches a restored conversation, or relaunches one after the CLI exits.
        await push(booted, { type: "launch_claude", channelId: "harness-resumed", resume: "s-1" });
        await live(booted, "opus", "high");
        await booted.page.waitForTimeout(200);
        expect(await booted.page.isHidden(STRIP)).toBe(true);
        await type(booted, "resumed");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          expect(await sent(booted, "resumed")).toBe(1);
        });
        expect(await gateLine(booted)).toBe("pass: always: 0 held, 0 sent anyway");
      } finally {
        await booted.close();
      }
    }, 30000);

    it("holds nothing and draws nothing when it is off", async () => {
      const booted = await boot();
      try {
        await live(booted, "opus", "high");
        await type(booted, "ungated");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          expect(await sent(booted, "ungated")).toBe(1);
        });
        expect(await booted.page.$(STRIP)).toBeNull();
        expect(await gateLine(booted)).toBe("n/a: off");
      } finally {
        await booted.close();
      }
    }, 30000);

    it("counts Claude Code's own picker as a choice, and leaves its Enter alone", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        await live(booted, "opus", "high");
        // Opened from the command menu, which leaves the editor focused with the picker open: the
        // one way an Enter in the editor belongs to the picker, and so the one the gate must see.
        await type(booted, "/model");
        await booted.page.waitForSelector(`${EDITOR}[aria-controls]`);
        await booted.page.keyboard.press("Enter");
        await booted.page.waitForSelector('.modelPill_gGYT1w[aria-expanded="true"]');
        await booted.page.keyboard.press("ArrowDown");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          const all = await booted.page.evaluate(
            () => (window as unknown as GateWindow).__harness?.sent ?? [],
          );
          expect(JSON.stringify(all)).toContain('"set_model"');
        });
        expect(await booted.page.isHidden(STRIP)).toBe(true);

        // That was the choice, so the prompt goes straight out.
        await type(booted, "after picking");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          expect(await sent(booted, "after picking")).toBe(1);
        });
        expect(await gateLine(booted)).toBe("pass: always: 0 held, 0 sent anyway");
      } finally {
        await booted.close();
      }
    }, 30000);

    it("leaves the command menu's Enter to the menu", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        await live(booted, "opus", "high");
        await type(booted, "/");
        await booted.page.waitForSelector(`${EDITOR}[aria-controls]`);
        await booted.page.keyboard.press("Enter");
        await booted.page.waitForTimeout(200);
        expect(await gateLine(booted)).toBe("pass: always: 0 held, 0 sent anyway");
      } finally {
        await booted.close();
      }
    }, 30000);

    it("holds the send button as it holds Enter", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        await live(booted, "opus", "high");
        await type(booted, "by button");
        await booted.page.click('button[type="submit"][aria-label="Send message"]');
        await booted.page.waitForSelector(`${STRIP}:not([hidden])`);
        await booted.page.waitForTimeout(200);
        expect(await sent(booted, "by button")).toBe(0);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("asks in mode 2 only while the default is not what is live", async () => {
      const booted = await boot({ model: UNLESS_DEFAULT });
      try {
        await live(booted, "opus", "high");
        await type(booted, "on the default");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          expect(await sent(booted, "on the default")).toBe(1);
        });
        expect(await booted.page.isHidden(STRIP)).toBe(true);
      } finally {
        await booted.close();
      }

      const drifted = await boot({ model: UNLESS_DEFAULT });
      try {
        await live(drifted, "haiku", null);
        await type(drifted, "off the default");
        await drifted.page.keyboard.press("Enter");
        await drifted.page.waitForSelector(`${STRIP}:not([hidden])`);
        expect(await drifted.page.textContent(`${STRIP} span`)).toBe(
          "Not your default, Opus 5.5 · high.",
        );
        expect(await drifted.page.textContent(SEND)).toBe("Send with Haiku 5.5");
        expect(await sent(drifted, "off the default")).toBe(0);
      } finally {
        await drifted.close();
      }
    }, 40000);

    it("offers to send anyway while the models have not arrived", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        await type(booted, "too early");
        await booted.page.keyboard.press("Enter");
        await booted.page.waitForSelector(`${STRIP}:not([hidden])`);
        expect(await booted.page.textContent(`${STRIP} span`)).toBe(
          "The models are still loading.",
        );
        expect(await booted.page.textContent(SEND)).toBe("Send anyway");
      } finally {
        await booted.close();
      }
    }, 30000);

    it("follows Ctrl+Enter to send: a plain Enter is a newline it never takes", async () => {
      const booted = await boot({ model: ALWAYS });
      try {
        await live(booted, "opus", "high", { useCtrlEnterToSend: true });
        await type(booted, "line one");
        await booted.page.keyboard.press("Enter");
        await booted.page.waitForTimeout(200);
        expect(await gateLine(booted)).toBe("pass: always: 0 held, 0 sent anyway");

        await booted.page.keyboard.press("Control+Enter");
        await vi.waitFor(async () => {
          expect(await gateLine(booted)).toBe("pass: always: 1 held, 0 sent anyway");
        });
        expect(await sent(booted, "line one")).toBe(0);
      } finally {
        await booted.close();
      }
    }, 30000);

    it("holds nothing where the composer is not there to hold, and says so", async () => {
      const booted = await boot({ model: ALWAYS, remove: { anchors: ["composerBox"] } });
      try {
        await live(booted, "opus", "high");
        await type(booted, "unheld");
        await booted.page.keyboard.press("Enter");
        await vi.waitFor(async () => {
          expect(await sent(booted, "unheld")).toBe(1);
        });
        expect(await booted.page.$(STRIP)).toBeNull();
        expect(await gateLine(booted)).toBe(
          "fail: the composer is not one element in this extension, so no send is held",
        );
      } finally {
        await booted.close();
      }
    }, 30000);
  },
);
