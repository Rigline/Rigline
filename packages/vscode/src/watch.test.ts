/**
 * The watcher, with a hand-cranked clock and a hand-fired event.
 *
 * The properties worth holding are the two that a live read would find only by accident: that the
 * poll still works when the event never fires, and that a burst of signals produces one reaction
 * rather than one npm install per signal.
 */
import { describe, expect, it } from "vitest";
import { stubEditor } from "../test/editor.ts";
import { type Stamps, type WatchReason, watchExtension } from "./watch.ts";

/** A whole directory summarised by one word: these tests care that it changed, not what did. */
const asStamps = (word: string): Stamps => ({ bundle: word, host: word, manifest: word });

const ID = "anthropic.claude-code";

/** Let everything already queued run. The settle puts an await between a signal and its reaction. */
const flush = () => new Promise<void>((done) => setTimeout(done, 0));

function harness(first: string | undefined) {
  let dirs = first === undefined ? [] : [first];
  const listeners: (() => void)[] = [];
  const ticks: (() => void)[] = [];
  const lines: string[] = [];

  const { editor } = stubEditor({
    onExtensionsChanged: (listener) => {
      listeners.push(listener);
      return {
        dispose() {
          listeners.splice(listeners.indexOf(listener), 1);
        },
      };
    },
    log: (line) => {
      lines.push(line);
    },
  });

  return {
    editor,
    lines,
    installed: () => dirs,
    /** Replace the installed set, as a reinstall that supersedes the old directory does. */
    move: (to: string | undefined) => {
      dirs = to === undefined ? [] : [to];
    },
    /** Add a version beside the one already there, which is what a real update often does. */
    add: (dir: string) => {
      dirs = [...dirs, dir].sort();
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

function watcher(
  h: ReturnType<typeof harness>,
  react: (r: WatchReason) => Promise<void>,
  settling: { stamps?: () => Stamps; settleTries?: number } = {},
) {
  return watchExtension({
    editor: h.editor,
    id: ID,
    installed: h.installed,
    react,
    // Settled by default: these tests are about noticing a move, and the settle has its own below.
    stamps: settling.stamps ?? (() => asStamps("steady")),
    ...(settling.settleTries === undefined ? {} : { settleTries: settling.settleTries }),
    settleMs: 0,
    sleep: async () => {},
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

    expect(seen).toEqual([{ kind: "moved", arriving: ["/ext/claude-code-2.1.279"] }]);
    w.dispose();
  });

  // The shape the live read found, and the one every test here had missed: VS Code writes the new
  // version beside the old rather than over it, so a watcher comparing one path sees nothing move.
  it("reacts when a version arrives beside the one already there", async () => {
    const h = harness("/ext/claude-code-2.1.278");
    const seen: WatchReason[] = [];
    const w = watcher(h, async (r) => {
      seen.push(r);
    });

    h.add("/ext/claude-code-2.1.279");
    await w.poke();

    expect(seen).toEqual([{ kind: "moved", arriving: ["/ext/claude-code-2.1.279"] }]);
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
    await flush();

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
    await flush();

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
    await flush();

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

    // Nothing arrived, so nothing has to settle first — there are no bytes being written.
    expect(seen).toEqual([{ kind: "moved", arriving: [] }]);
    expect(h.lines.join()).toContain("removed");
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

  it("waits for the directory to stop changing before reacting", async () => {
    // Why this exists: `settleWebviewBackup` treats bytes unrelated to the backup as "the extension
    // was replaced in place" and makes them the new pristine baseline. Half-written bytes there
    // become what `restore` restores, so reacting early is not a slow failure but a silent one.
    const h = harness("/ext/claude-code-2.1.278");
    const order: string[] = [];
    let writes = 3;
    const w = watcher(
      h,
      async () => {
        order.push("reacted");
      },
      {
        stamps: () => {
          order.push("looked");
          return asStamps(writes-- > 0 ? `growing-${writes}` : "final");
        },
      },
    );

    h.move("/ext/claude-code-2.1.279");
    await w.poke();

    expect(order.at(-1)).toBe("reacted");
    expect(order.filter((o) => o === "looked").length).toBeGreaterThan(2);
    expect(order.filter((o) => o === "reacted")).toHaveLength(1);
    w.dispose();
  });

  it("leaves a directory that never settles to the next look, rather than reacting to it", async () => {
    const h = harness("/ext/claude-code-2.1.278");
    let reactions = 0;
    let n = 0;
    const w = watcher(
      h,
      async () => {
        reactions += 1;
      },
      { stamps: () => asStamps(`changing-${n++}`), settleTries: 3 },
    );

    h.move("/ext/claude-code-2.1.279");
    await w.poke();

    expect(reactions).toBe(0);
    expect(h.lines.join("\n")).toMatch(/still changing/);
    w.dispose();
  });

  it("keeps an unsettled move outstanding, so the next look retries it", async () => {
    // The bug this guards: committing the new path before reacting would make the next poll see no
    // change, and the update would be skipped in silence — the failure the milestone is against.
    const h = harness("/ext/claude-code-2.1.278");
    const seen: WatchReason[] = [];
    let steady = false;
    const w = watcher(
      h,
      async (r) => {
        seen.push(r);
      },
      { stamps: () => asStamps(steady ? "steady" : `changing-${Math.random()}`), settleTries: 2 },
    );

    h.move("/ext/claude-code-2.1.279");
    await w.poke();
    expect(seen).toHaveLength(0);

    steady = true;
    await w.poke();

    expect(seen).toEqual([{ kind: "moved", arriving: ["/ext/claude-code-2.1.279"] }]);
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
