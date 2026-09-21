/**
 * The watcher, with a hand-cranked clock and a hand-fired event.
 *
 * The properties worth holding are the two that a live read would find only by accident: that the
 * poll still works when the event never fires, and that a burst of signals produces one reaction
 * rather than one npm install per signal.
 */
import { describe, expect, it } from "vitest";
import type { Editor } from "./editor.ts";
import { type WatchReason, watchExtension } from "./watch.ts";

const ID = "anthropic.claude-code";

function harness(first: string | undefined) {
  let path = first;
  const listeners: (() => void)[] = [];
  const ticks: (() => void)[] = [];
  const lines: string[] = [];

  const editor: Editor = {
    setting: () => undefined,
    extensionPath: () => path,
    onExtensionsChanged: (listener) => {
      listeners.push(listener);
      return {
        dispose() {
          listeners.splice(listeners.indexOf(listener), 1);
        },
      };
    },
    status: () => {},
    log: (line) => {
      lines.push(line);
    },
    ask: async () => undefined,
  };

  return {
    editor,
    lines,
    move: (to: string | undefined) => {
      path = to;
    },
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
    tick: () => {
      for (const fn of [...ticks]) fn();
    },
    listening: () => listeners.length,
    timers: () => ticks.length,
    setInterval: (fn: () => void) => {
      ticks.push(fn);
      return ticks.length;
    },
    clearInterval: (handle: unknown) => {
      ticks.splice((handle as number) - 1, 1);
    },
  };
}

function watcher(h: ReturnType<typeof harness>, react: (r: WatchReason) => Promise<void>) {
  return watchExtension({
    editor: h.editor,
    id: ID,
    react,
    setInterval: h.setInterval,
    clearInterval: h.clearInterval,
  });
}

describe("watchExtension", () => {
  it("reacts when the directory changes, naming both paths", async () => {
    const h = harness("/ext/claude-code-2.1.278");
    const seen: WatchReason[] = [];
    const w = watcher(h, async (r) => {
      seen.push(r);
    });

    h.move("/ext/claude-code-2.1.279");
    await w.poke();

    expect(seen).toEqual([
      { kind: "moved", from: "/ext/claude-code-2.1.278", to: "/ext/claude-code-2.1.279" },
    ]);
    w.dispose();
  });

  it("does nothing while the directory is the same", async () => {
    const h = harness("/ext/claude-code-2.1.278");
    let reactions = 0;
    const w = watcher(h, async () => {
      reactions += 1;
    });

    await w.poke();
    h.fire();
    h.tick();
    await Promise.resolve();

    expect(reactions).toBe(0);
    w.dispose();
  });

  it("still notices through the poll when the event never fires (D80)", async () => {
    // The floor. `onDidChange` is documented for install and has a history of not arriving, so a
    // watcher that depended on it would be a watcher that is absent exactly when it is needed.
    const h = harness("/ext/claude-code-2.1.278");
    const seen: WatchReason[] = [];
    const w = watcher(h, async (r) => {
      seen.push(r);
    });

    h.move("/ext/claude-code-2.1.279");
    h.tick();
    await Promise.resolve();

    expect(seen).toHaveLength(1);
    w.dispose();
  });

  it("reacts once to a burst, not once per signal", async () => {
    // An update fires the event, then the poll, then often the event again as the old directory is
    // deleted. Three reactions would be three npm installs queueing on each other's lock.
    const h = harness("/ext/claude-code-2.1.278");
    let reactions = 0;
    let release: (() => void) | undefined;
    const w = watcher(h, async () => {
      reactions += 1;
      await new Promise<void>((done) => {
        release = done;
      });
    });

    h.move("/ext/claude-code-2.1.279");
    const first = w.poke();
    h.fire();
    h.tick();
    await Promise.resolve();

    expect(reactions).toBe(1);
    release?.();
    await first;
    w.dispose();
  });

  it("treats the extension going away as a move, since a reinstall follows", async () => {
    const h = harness("/ext/claude-code-2.1.278");
    const seen: WatchReason[] = [];
    const w = watcher(h, async (r) => {
      seen.push(r);
    });

    h.move(undefined);
    await w.poke();

    expect(seen).toEqual([{ kind: "moved", from: "/ext/claude-code-2.1.278", to: undefined }]);
    expect(h.lines.join()).toContain("absent");
    w.dispose();
  });

  it("swallows a throwing reaction, because a rejected timer reaches nobody", async () => {
    const h = harness("/ext/claude-code-2.1.278");
    const w = watcher(h, async () => {
      throw new Error("should not happen");
    });

    h.move("/ext/claude-code-2.1.279");
    await expect(w.poke()).resolves.toBeUndefined();
    expect(h.lines.join("\n")).toMatch(/should not happen/);
    w.dispose();
  });

  it("stops listening and stops polling when disposed", async () => {
    const h = harness("/ext/claude-code-2.1.278");
    let reactions = 0;
    const w = watcher(h, async () => {
      reactions += 1;
    });

    w.dispose();
    expect(h.listening()).toBe(0);
    expect(h.timers()).toBe(0);

    h.move("/ext/claude-code-2.1.279");
    await w.poke();
    expect(reactions).toBe(0);
  });
});
