/**
 * The models service against a fake panel session: what it reads off the session's signals, the
 * order it calls the session's setters in, and what it calls a refusal (D120 as amended). The
 * harness drives the real session in the real bundle.
 */
import type { FiberLike, ModelSettings, ModelState } from "@rigline/plugin-api/internal";
import { describe, expect, it } from "vitest";
import type { Bus } from "../src/kernel/bridge.ts";
import { createModelsService, sessionOf } from "../src/kernel/models.ts";

/** A signal as the panel's library makes one: `subscribe` calls back at once and on every change. */
function signal(initial: unknown) {
  let value = initial;
  const listeners = new Set<(value: unknown) => void>();
  return {
    get value() {
      return value;
    },
    set value(next: unknown) {
      value = next;
      for (const listener of [...listeners]) listener(next);
    },
    subscribe(fn: (value: unknown) => void) {
      listeners.add(fn);
      fn(value);
      return () => void listeners.delete(fn);
    },
  };
}

const MODELS = [
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus",
    supportsEffort: true,
    supportedEffortLevels: ["low", "high", "xhigh"],
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5-5",
    displayName: "Sonnet",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "xhigh"],
  },
];

/** A session as the footer is handed it, recording each setter call, which may refuse one. */
function fakeSession(options: { refuseModel?: boolean; ultracode?: boolean } = {}) {
  const calls: string[] = [];
  const session = {
    modelSelection: signal("opus"),
    effortLevel: signal("xhigh"),
    claudeConfig: signal({ models: MODELS }),
    async setModel(entry: { readonly value: string }) {
      calls.push(`model ${JSON.stringify(entry)}`);
      const before = session.modelSelection.value;
      session.modelSelection.value = entry.value;
      await Promise.resolve();
      if (options.refuseModel) session.modelSelection.value = before;
      return !options.refuseModel;
    },
    async setEffortLevel(level: string) {
      calls.push(`effort ${level}`);
      session.effortLevel.value = level;
    },
    async setThinkingLevel(level: string) {
      calls.push(`thinking ${level}`);
    },
    ...(options.ultracode === false
      ? {}
      : {
          async setUltracode(on: boolean) {
            calls.push(`ultracode ${String(on)}`);
          },
        }),
  };
  return { session, calls };
}

function fakeBus() {
  const handlers = new Map<string, ((payload: unknown) => void)[]>();
  const bus: Bus = {
    on(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      return () => {};
    },
    sealBuffer() {},
    rewriters: { add: () => () => {}, resend: () => false, outboundSeen: () => 0 },
    ask: () => Promise.resolve(null),
  };
  const emit = (type: string, payload: unknown) => {
    for (const handler of handlers.get(type) ?? []) handler(payload);
  };
  return { bus, emit };
}

/** A footer whose fiber carries `session` two steps up, as 2.1.301's does. */
function footer(session: unknown): FiberLike {
  return {
    memoizedProps: {},
    return: { memoizedProps: {}, return: { memoizedProps: { session } } },
  };
}

function service(session: unknown, settings?: ModelSettings) {
  const fake = fakeBus();
  let fiber: FiberLike | null = session === null ? null : footer(session);
  const commits: (() => void)[] = [];
  const faults: string[] = [];
  const models = createModelsService({
    bus: fake.bus,
    react: {
      onCommit: (handler) => {
        commits.push(handler);
        return () => {};
      },
      fiberFor: () => fiber,
    },
    spacer: () => ({}) as Element,
    settings,
    fail: (reason) => faults.push(reason),
  });
  const states: ModelState[] = [];
  models.subscribe((state) => states.push(state));
  return {
    models,
    states,
    faults,
    emit: fake.emit,
    last: () => states.at(-1),
    commit: (next: unknown) => {
      fiber = next === null ? null : footer(next);
      for (const handler of commits) handler();
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("reading the panel's session", () => {
  it("reads the list, the model and the effort the picker draws", () => {
    const { session } = fakeSession();
    const { last } = service(session);
    expect(last()?.models.map((m) => m.value)).toEqual(["opus", "sonnet"]);
    expect(last()?.current?.value).toBe("opus");
    expect(last()?.effort).toBe("xhigh");
  });

  it("follows the session's own signals as they change", async () => {
    const { session } = fakeSession();
    const { last } = service(session);
    session.modelSelection.value = "sonnet";
    session.effortLevel.value = "low";
    await settle();
    expect(last()?.current?.value).toBe("sonnet");
    expect(last()?.effort).toBe("low");
  });

  it("prefers the drawn config, which falls back to the stored one, where the session has it", () => {
    const { session } = fakeSession();
    const drawn = { ...session, drawnClaudeConfig: signal({ models: [MODELS[1]] }) };
    const { last } = service(drawn);
    expect(last()?.models.map((m) => m.value)).toEqual(["sonnet"]);
  });

  it("moves to a new session, and keeps the last where the footer has gone", async () => {
    const first = fakeSession().session;
    const second = fakeSession().session;
    second.modelSelection.value = "sonnet";
    const { last, commit, models } = service(first);
    commit(null);
    expect(last()?.current?.value).toBe("opus");
    commit(second);
    expect(last()?.current?.value).toBe("sonnet");
    expect(models.stats.sessions).toBe(2);
    // The first is no longer followed.
    first.effortLevel.value = "low";
    await settle();
    expect(last()?.effort).toBe("xhigh");
  });

  it("never throws into the panel's own setter, whatever a handler does", async () => {
    const { session } = fakeSession();
    const { models, faults } = service(session);
    models.subscribe((state) => {
      if (state.current?.value === "sonnet") throw new Error("boom");
    });
    expect(() => {
      session.modelSelection.value = "sonnet";
    }).not.toThrow();
    await settle();
    expect(faults).toEqual(["a model state handler threw: boom"]);
  });
});

describe("applying a choice through the panel's setters", () => {
  it("sets the model as the config's own entry, then the effort, and says what the panel holds", async () => {
    const { session, calls } = fakeSession();
    const { models } = service(session);
    const result = await models.apply({ model: "sonnet", effort: "medium" });
    expect(calls).toEqual([`model ${JSON.stringify(MODELS[1])}`, "effort medium"]);
    expect(result).toEqual({
      applied: { model: "sonnet", effort: "medium", thinkingLevel: null, ultracode: null },
    });
  });

  it("refuses where the panel rolled the model back, which it explains itself", async () => {
    const { session } = fakeSession({ refuseModel: true });
    const { models } = service(session);
    expect(await models.apply({ model: "sonnet", effort: "medium" })).toEqual({
      refused: "Claude Code kept opus; the panel says why",
    });
    expect(models.stats).toMatchObject({ applied: 0, refused: 1 });
  });

  it("refuses before calling anything when the panel's list does not offer the choice", async () => {
    const { session, calls } = fakeSession();
    const { models } = service(session);
    expect(await models.apply({ model: "sonnet", effort: "high" })).toEqual({
      refused: 'sonnet does not take the effort "high"',
    });
    expect(calls).toEqual([]);
  });

  it("refuses ultracode where this version's session has no switch for it", async () => {
    const { session, calls } = fakeSession({ ultracode: false });
    const { models } = service(session);
    expect(await models.apply({ model: "opus", ultracode: true })).toEqual({
      refused: "this version of Claude Code has no ultracode switch",
    });
    expect(calls).toEqual([]);
  });

  it("refuses with no session to apply it to", async () => {
    const { models } = service(null);
    expect(await models.apply({ model: "opus" })).toMatchObject({
      refused: expect.stringMatching(/does not offer|no session/),
    });
  });
});

describe("whether this session has chosen", () => {
  const always: ModelSettings = { requireChoice: "always", default: null };

  it("is lifted by a choice applied here, and asked again after a new launch", async () => {
    const { session } = fakeSession();
    const { models, last, emit } = service(session, always);
    expect(last()?.choiceRequired).toBe(true);
    await models.apply({ model: "opus", effort: "xhigh" });
    expect(last()?.choiceRequired).toBe(false);
    emit("launch_claude", { type: "launch_claude", channelId: "next" });
    expect(last()?.choiceRequired).toBe(true);
  });

  it("is lifted by the panel's own request for a model or an effort", () => {
    const { session } = fakeSession();
    const { last, emit } = service(session, always);
    emit("apply_settings", { type: "apply_settings", settings: { outputStyle: "x" } });
    expect(last()?.choiceRequired).toBe(true);
    emit("apply_settings", { type: "apply_settings", settings: { effortLevel: "low" } });
    expect(last()?.choiceRequired).toBe(false);
  });
});

describe("sessionOf", () => {
  it("takes the session both halves of React's pair name, or the one only one names", () => {
    const { session } = fakeSession();
    const own = footer(session);
    expect(sessionOf({ ...own, alternate: footer(session) })).toBe(session);
    expect(sessionOf({ ...own, alternate: { memoizedProps: {} } })).toBe(session);
  });

  it("ignores a session prop that is not the panel's shape", () => {
    expect(sessionOf(footer({ setModel: () => {} }))).toBeNull();
  });
});
