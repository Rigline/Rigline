/**
 * The read-only guarantee, and the replay buffer's bounds.
 *
 * What a tap can *do* to a message needs a stubbed acquireVsCodeApi and nothing else, and it is
 * the one part of pre.js where a regression is silent — a tap that can write looks exactly like a
 * tap that cannot until something rewrites protocol. So this gets a Node test, driven against the
 * BUILT dist/pre.js rather than the source: that is what the injector copies into the extension,
 * so a build that dropped or reshaped something is in scope. It is also a plain .js file, which is
 * what lets a Node-side .ts test import browser-target code at all. Run `pnpm --filter @rigline/host
 * build` first.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BUILT = fileURLToPath(new URL("../dist/pre.js", import.meta.url));

/**
 * As much of pre.ts's bridge as these tests read. Restated rather than imported: importing the
 * type would make TypeScript check pre.ts under this project, which has no DOM lib and is the
 * reason the host package keeps its own tsconfig that excludes this file. The duplication is the
 * price of testing the built artifact, and it is confined to this file.
 */
interface Diagnostics {
  version: string;
  acquireWrapped: boolean;
  acquireCalled: boolean;
  outboundCount: number;
  inboundCount: number;
  buffered: number;
  bufferSealed: boolean;
  tapClones: number;
  tapCloneMs: number;
  tapCloneMaxMs: number;
  tapCloneMaxType: string | null;
  resent: number;
  react: {
    hook: "installed" | "chained";
    version: string | null;
    commits: number;
    notified: number;
    foreign: number;
  };
  errors: string[];
}

interface Bridge {
  diagnostics: Diagnostics;
  react: {
    onCommit(handler: () => void): () => void;
    fiberFor(element: unknown): unknown;
    rendererVersion(): string | null;
  };
  bus: {
    on(type: string, handler: (payload: unknown) => void): () => void;
    sealBuffer(): void;
    rewriters: {
      add(
        type: string,
        apply: (payload: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
      ): () => void;
      resend(type: string): boolean;
      outboundSeen(type: string): number;
    };
  };
}

/** The real VS Code webview API shape, faithfully enough to drive the wrapper. */
interface Api {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/** What the test drives. */
interface Harness {
  bridge: Bridge;
  api: Api;
  /** What the extension host received, in order. */
  sent: unknown[];
  /** Deliver an inbound message the way the webview's own listener would see it. */
  receive(message: unknown): void;
  /** What a listener registered after pre.js — as the app's is — sees. */
  appReceived: unknown[];
}

type MessageListener = (event: { data: unknown }) => void;

const HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";

/** The part of the devtools hook react-dom calls. */
interface DevtoolsHook {
  inject(internals: unknown): unknown;
  onCommitFiberRoot(rendererId: unknown, root?: unknown): unknown;
}

const TOUCHED_GLOBALS = [
  "document",
  "addEventListener",
  "acquireVsCodeApi",
  "__rigline",
  HOOK,
] as const;

function globalRecord(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

let savedGlobals: Map<string, unknown>;

beforeAll(() => {
  if (!existsSync(BUILT)) {
    throw new Error(`${BUILT} is missing — run 'pnpm --filter @rigline/host build'`);
  }
  const g = globalRecord();
  savedGlobals = new Map();
  for (const key of TOUCHED_GLOBALS) {
    if (Object.hasOwn(g, key)) savedGlobals.set(key, g[key]);
  }
});

afterAll(() => {
  const g = globalRecord();
  for (const key of TOUCHED_GLOBALS) {
    if (savedGlobals.has(key)) g[key] = savedGlobals.get(key);
    else delete g[key];
  }
});

/**
 * A fresh pre.js against a fresh fake webview.
 *
 * pre.js is a side-effecting module with no exports, so each case needs its own evaluation: the
 * cache-busting query is the only way to get one, since a module instance is per URL.
 */
async function boot(existingHook?: DevtoolsHook): Promise<Harness> {
  const sent: unknown[] = [];
  const appReceived: unknown[] = [];
  const listeners: MessageListener[] = [];

  const g = globalRecord();
  g.document = { querySelector: () => ({ childElementCount: 0 }) };
  g.addEventListener = ((type: string, listener: MessageListener) => {
    if (type === "message") listeners.push(listener);
  }) as unknown;
  g.acquireVsCodeApi = (() => ({
    postMessage: (message: unknown) => {
      sent.push(message);
    },
    getState: () => undefined,
    setState: () => {},
  })) as unknown;
  delete g.__rigline;
  if (existingHook) g[HOOK] = existingHook;
  else delete g[HOOK];

  await import(`${pathToFileURL(BUILT).href}?case=${Math.random()}`);

  // Registered after pre.js, exactly as the app's own listener is: pre.js runs from a static
  // import at the head of the bundle, so its listener is always first in line.
  const appListener: MessageListener = (event) => {
    const data = event.data as { type?: unknown; message?: unknown } | null;
    if (data && data.type === "from-extension") appReceived.push(data.message);
  };
  (g.addEventListener as (type: string, listener: MessageListener) => void)("message", appListener);

  const bridge = g.__rigline as Bridge;
  const api = (g.acquireVsCodeApi as () => Api)();

  return {
    bridge,
    api,
    sent,
    appReceived,
    receive(message: unknown) {
      for (const listener of listeners) listener({ data: { type: "from-extension", message } });
    },
  };
}

/** The canonical outbound "request" envelope shape. */
interface RenameTabEnvelope {
  type: "request";
  channelId: string;
  requestId: string;
  request: { type: "rename_tab"; title: string; hasPendingPermissions: boolean };
}

function renameTab(): RenameTabEnvelope {
  return {
    type: "request",
    channelId: "real-channel",
    requestId: "abc123",
    request: { type: "rename_tab", title: "a title", hasPendingPermissions: false },
  };
}

describe("the wrapper itself", () => {
  it("tags the bridge with an explicit version", async () => {
    const h = await boot();
    expect(h.bridge.diagnostics.version).toBe("rigline-1");
  });

  it("reports the wrapper installed and called", async () => {
    const h = await boot();
    expect(h.bridge.diagnostics.acquireWrapped).toBe(true);
    expect(h.bridge.diagnostics.acquireCalled).toBe(true);
  });

  it("returns the same object on every call, as the real API does", async () => {
    const h = await boot();
    const again = (globalRecord().acquireVsCodeApi as () => Api)();
    expect(again).toBe(h.api);
  });

  it("counts outbound and inbound independently", async () => {
    const h = await boot();
    h.api.postMessage(renameTab());
    h.receive({ type: "log_event", name: "x" });
    expect(h.bridge.diagnostics.outboundCount).toBe(1);
    expect(h.bridge.diagnostics.inboundCount).toBe(1);
  });
});

describe("a tap cannot write", () => {
  it("freezes an outbound payload; the host still gets the app's own object", async () => {
    const h = await boot();
    const seen: unknown[] = [];
    h.bridge.bus.on("rename_tab", (payload) => seen.push(payload));
    const envelope = renameTab();
    h.api.postMessage(envelope);

    const payload = seen[0] as { title: string };
    expect(() => {
      payload.title = "hacked";
    }).toThrow(TypeError);
    expect(h.sent[0]).toBe(envelope);
    expect(h.bridge.diagnostics.errors).toHaveLength(0);
  });

  it("freezes the outer envelope, and independently freezes the nested request", async () => {
    const h = await boot();
    const seen: unknown[] = [];
    h.bridge.bus.on("request", (payload) => seen.push(payload));
    h.api.postMessage(renameTab());

    const envelope = seen[0] as { requestId: string; request: { title: string } };
    expect(() => {
      envelope.requestId = "hacked";
    }).toThrow(TypeError);
    expect(() => {
      envelope.request.title = "hacked";
    }).toThrow(TypeError);
  });

  it("freezes inbound messages the same way", async () => {
    const h = await boot();
    const seen: unknown[] = [];
    h.bridge.bus.on("session_states_update", (payload) => seen.push(payload));
    const message = { type: "session_states_update", sessions: ["s1"] };
    h.receive(message);

    const payload = seen[0] as { sessions: string[] };
    expect(() => {
      payload.sessions = ["hacked"];
    }).toThrow(TypeError);
    expect(h.appReceived[0]).toBe(message);
  });

  it("still freezes a late tap's replay, and never touches the original", async () => {
    const h = await boot();
    const envelope = renameTab();
    h.api.postMessage(envelope);

    const seen: unknown[] = [];
    h.bridge.bus.on("rename_tab", (payload) => seen.push(payload));

    const payload = seen[0] as { title: string };
    expect(() => {
      payload.title = "hacked";
    }).toThrow(TypeError);
    expect(envelope.request.title).toBe("a title");
  });

  it("clones once for every simultaneous tap, never the object heading for the host", async () => {
    const h = await boot();
    const seen: unknown[] = [];
    h.bridge.bus.on("rename_tab", (payload) => seen.push(payload));
    h.bridge.bus.on("rename_tab", (payload) => seen.push(payload));
    h.api.postMessage(renameTab());

    expect(seen[0]).toBe(seen[1]);
    const sentRequest = (h.sent[0] as RenameTabEnvelope).request;
    expect(seen[0]).not.toBe(sentRequest);
    expect(seen[0]).toEqual(sentRequest);
  });

  it("drops an uncloneable message from taps, fails closed, and still delivers it", async () => {
    const h = await boot();
    const delivered: unknown[] = [];
    h.bridge.bus.on("log_event", (payload) => delivered.push(payload));
    const uncloneable = { type: "log_event", callback: () => {} };
    h.api.postMessage(uncloneable);

    expect(delivered).toHaveLength(0);
    expect(h.sent[0]).toBe(uncloneable);
    expect(h.bridge.diagnostics.errors).toHaveLength(1);
    expect(h.bridge.diagnostics.errors[0]).toMatch(/^clone:log_event:/);
  });

  it("catches a throwing tap without stopping the next tap or the message", async () => {
    const h = await boot();
    const seen: unknown[] = [];
    h.bridge.bus.on("rename_tab", () => {
      throw new Error("plugin bug");
    });
    h.bridge.bus.on("rename_tab", (payload) => seen.push(payload));
    h.api.postMessage(renameTab());

    expect(h.bridge.diagnostics.errors[0]).toMatch(/^bus:rename_tab:plugin bug$/);
    expect(seen).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });
});

describe("envelope unwrapping", () => {
  it("delivers a response under both its inner type and its outer envelope", async () => {
    const h = await boot();
    const outerSeen: unknown[] = [];
    const innerSeen: unknown[] = [];
    h.bridge.bus.on("response", (payload) => outerSeen.push(payload));
    h.bridge.bus.on("list_sessions_response", (payload) => innerSeen.push(payload));

    h.receive({
      type: "response",
      requestId: "q1",
      response: { type: "list_sessions_response", sessions: [{ id: "s1" }] },
    });

    expect(outerSeen).toHaveLength(1);
    expect(innerSeen).toHaveLength(1);
    expect((innerSeen[0] as { sessions: unknown }).sessions).toEqual([{ id: "s1" }]);
  });

  it("delivers an outbound request under both its inner type and 'request'", async () => {
    const h = await boot();
    const outerSeen: unknown[] = [];
    const innerSeen: unknown[] = [];
    h.bridge.bus.on("request", (payload) => outerSeen.push(payload));
    h.bridge.bus.on("rename_tab", (payload) => innerSeen.push(payload));

    h.api.postMessage(renameTab());

    expect(outerSeen).toHaveLength(1);
    expect(innerSeen).toHaveLength(1);
  });

  it("leaves io_message wrapped, never unwrapping the Anthropic protocol nested inside it", async () => {
    const h = await boot();
    const wrappedSeen: unknown[] = [];
    const innerSeen: unknown[] = [];
    h.bridge.bus.on("io_message", (payload) => wrappedSeen.push(payload));
    h.bridge.bus.on("content_block_delta", (payload) => innerSeen.push(payload));

    h.receive({
      type: "io_message",
      requestId: "z9",
      message: { type: "content_block_delta", delta: { text: "hi" } },
    });

    expect(wrappedSeen).toHaveLength(1);
    expect(innerSeen).toHaveLength(0);
  });
});

describe("the replay buffer", () => {
  it("attributes the worst clone to the type that caused it", async () => {
    const h = await boot();
    h.bridge.bus.on("rename_tab", () => {});
    h.api.postMessage(renameTab());

    expect(h.bridge.diagnostics.tapCloneMaxType).toBe("rename_tab");
    expect(h.bridge.diagnostics.tapCloneMaxMs).toBeGreaterThanOrEqual(0);
  });

  it("costs nothing to clone until a type is tapped, but still buffers for later", async () => {
    const h = await boot();
    h.api.postMessage({ type: "log_event", name: "untapped" });

    expect(h.bridge.diagnostics.tapClones).toBe(0);
    expect(h.bridge.diagnostics.buffered).toBe(1);
  });

  it("stops growing the buffer once sealed, but replays only what preceded the seal", async () => {
    const h = await boot();
    h.api.postMessage({ type: "log_event", name: "before" });
    h.bridge.bus.sealBuffer();
    expect(h.bridge.diagnostics.bufferSealed).toBe(true);
    const bufferedAtSeal = h.bridge.diagnostics.buffered;

    h.api.postMessage({ type: "log_event", name: "after" });
    expect(h.bridge.diagnostics.buffered).toBe(bufferedAtSeal);

    const replayed: unknown[] = [];
    h.bridge.bus.on("log_event", (payload) => replayed.push(payload));
    expect(replayed).toHaveLength(1);
    expect((replayed[0] as { name: string }).name).toBe("before");
  });

  it("still delivers live even when sealed from the start", async () => {
    const h = await boot();
    h.bridge.bus.sealBuffer();
    expect(h.bridge.diagnostics.buffered).toBe(0);

    const seen: unknown[] = [];
    h.bridge.bus.on("log_event", (payload) => seen.push(payload));
    h.api.postMessage({ type: "log_event", name: "live" });

    expect(seen).toHaveLength(1);
    expect(h.bridge.diagnostics.buffered).toBe(0);
  });
});

describe("the rewrite chain", () => {
  it("patches the declared field inside the envelope, leaving correlation fields alone", async () => {
    const h = await boot();
    h.bridge.bus.rewriters.add("rename_tab", (payload) => ({
      title: `${payload.title as string}!`,
    }));
    const envelope = renameTab();
    h.api.postMessage(envelope);

    const sentEnvelope = h.sent[0] as RenameTabEnvelope;
    expect(sentEnvelope).not.toBe(envelope);
    expect(sentEnvelope.requestId).toBe(envelope.requestId);
    expect(sentEnvelope.request.hasPendingPermissions).toBe(false);
    expect(sentEnvelope.request.title).toBe("a title!");
    expect(envelope.request.title).toBe("a title");
  });

  it("posts the app's own object unchanged when nothing is registered", async () => {
    const h = await boot();
    const envelope = renameTab();
    h.api.postMessage(envelope);
    expect(h.sent[0]).toBe(envelope);
  });

  it("composes multiple rewriters in registration order", async () => {
    const h = await boot();
    const seen: string[] = [];
    h.bridge.bus.rewriters.add("rename_tab", (payload) => {
      seen.push(`A:${payload.title as string}`);
      return { title: `${payload.title as string}-A` };
    });
    h.bridge.bus.rewriters.add("rename_tab", (payload) => {
      seen.push(`B:${payload.title as string}`);
      return { title: `${payload.title as string}-B` };
    });
    h.api.postMessage(renameTab());

    expect(seen).toEqual(["A:a title", "B:a title-A"]);
    expect((h.sent[0] as RenameTabEnvelope).request.title).toBe("a title-A-B");
  });

  it("hands each rewriter a frozen view, even inside the chain", async () => {
    const h = await boot();
    h.bridge.bus.rewriters.add("rename_tab", (payload) => {
      expect(() => {
        (payload as { title: string }).title = "hacked";
      }).toThrow(TypeError);
      return null;
    });
    h.api.postMessage(renameTab());
  });

  it("treats a null return as a no-op", async () => {
    const h = await boot();
    h.bridge.bus.rewriters.add("rename_tab", () => null);
    const envelope = renameTab();
    h.api.postMessage(envelope);
    expect(h.sent[0]).toBe(envelope);
  });

  it("never shows a read tap anything but the app's original", async () => {
    const h = await boot();
    const tapped: unknown[] = [];
    h.bridge.bus.on("rename_tab", (payload) => tapped.push(payload));
    h.bridge.bus.rewriters.add("rename_tab", (payload) => ({
      title: `${payload.title as string}-X`,
    }));
    h.api.postMessage(renameTab());

    expect((tapped[0] as { title: string }).title).toBe("a title");
    expect((h.sent[0] as RenameTabEnvelope).request.title).toBe("a title-X");
  });

  it("catches a throwing rewriter without blocking the next one", async () => {
    const h = await boot();
    h.bridge.bus.rewriters.add("rename_tab", () => {
      throw new Error("writer bug");
    });
    h.bridge.bus.rewriters.add("rename_tab", (payload) => ({
      title: `${payload.title as string}-ok`,
    }));
    h.api.postMessage(renameTab());

    expect(h.bridge.diagnostics.errors[0]).toMatch(/^rewrite:rename_tab:writer bug$/);
    expect((h.sent[0] as RenameTabEnvelope).request.title).toBe("a title-ok");
  });

  it("can patch a bare notification directly, with no envelope invented", async () => {
    const h = await boot();
    h.bridge.bus.rewriters.add("log_event", () => ({ name: "renamed" }));
    h.api.postMessage({ type: "log_event", name: "original" });

    expect(h.sent[0]).toEqual({ type: "log_event", name: "renamed" });
  });

  it("stops applying once removed", async () => {
    const h = await boot();
    const remove = h.bridge.bus.rewriters.add("rename_tab", () => ({ title: "patched" }));
    h.api.postMessage(renameTab());
    expect((h.sent[0] as RenameTabEnvelope).request.title).toBe("patched");

    remove();
    const envelope = renameTab();
    h.api.postMessage(envelope);
    expect(h.sent[1]).toBe(envelope);
  });
});

describe("counting sends the chain did not see", () => {
  it("counts only outbound sends of the payload type", async () => {
    const h = await boot();
    h.api.postMessage(renameTab());
    h.api.postMessage(renameTab());
    expect(h.bridge.bus.rewriters.outboundSeen("rename_tab")).toBe(2);
  });

  it("is keyed on the payload type, never the envelope type", async () => {
    const h = await boot();
    h.api.postMessage(renameTab());
    expect(h.bridge.bus.rewriters.outboundSeen("request")).toBe(0);
  });

  it("does not count an inbound message of the same type", async () => {
    const h = await boot();
    h.receive({
      type: "response",
      requestId: "q1",
      response: { type: "list_sessions_response", sessions: [] },
    });
    expect(h.bridge.bus.rewriters.outboundSeen("list_sessions_response")).toBe(0);
  });

  it("keeps counting after the buffer is sealed", async () => {
    const h = await boot();
    h.api.postMessage(renameTab());
    h.bridge.bus.sealBuffer();
    h.api.postMessage(renameTab());
    expect(h.bridge.bus.rewriters.outboundSeen("rename_tab")).toBe(2);
  });

  it("never counts a resend", async () => {
    const h = await boot();
    h.api.postMessage(renameTab());
    const before = h.bridge.bus.rewriters.outboundSeen("rename_tab");
    h.bridge.bus.rewriters.resend("rename_tab");
    expect(h.bridge.bus.rewriters.outboundSeen("rename_tab")).toBe(before);
  });

  it("is a live snapshot, correct at whatever point it is read", async () => {
    const h = await boot();
    expect(h.bridge.bus.rewriters.outboundSeen("rename_tab")).toBe(0);
    h.api.postMessage(renameTab());
    expect(h.bridge.bus.rewriters.outboundSeen("rename_tab")).toBe(1);
    h.api.postMessage(renameTab());
    expect(h.bridge.bus.rewriters.outboundSeen("rename_tab")).toBe(2);
  });
});

describe("resending the app's last message", () => {
  it("re-runs the chain against a rewriter added after the original send", async () => {
    const h = await boot();
    h.api.postMessage(renameTab());
    h.bridge.bus.rewriters.add("rename_tab", (payload) => ({
      title: `${payload.title as string}-late`,
    }));

    expect(h.bridge.bus.rewriters.resend("rename_tab")).toBe(true);
    expect((h.sent[1] as RenameTabEnvelope).request.title).toBe("a title-late");
  });

  it("replays the original app payload, not the chain's previous output", async () => {
    const h = await boot();
    let version = 0;
    h.bridge.bus.rewriters.add("rename_tab", (payload) => ({
      title: `${payload.title as string}-v${++version}`,
    }));
    h.api.postMessage(renameTab());
    expect((h.sent[0] as RenameTabEnvelope).request.title).toBe("a title-v1");

    h.bridge.bus.rewriters.resend("rename_tab");
    expect((h.sent[1] as RenameTabEnvelope).request.title).toBe("a title-v2");
  });

  it("mints a fresh requestId but keeps the same channelId", async () => {
    const h = await boot();
    const envelope = renameTab();
    h.api.postMessage(envelope);
    h.bridge.bus.rewriters.resend("rename_tab");

    const resent = h.sent[1] as RenameTabEnvelope;
    expect(resent.requestId).not.toBe(envelope.requestId);
    expect(resent.channelId).toBe(envelope.channelId);
  });

  it("returns false when the app never sent that type", async () => {
    const h = await boot();
    expect(h.bridge.bus.rewriters.resend("rename_tab")).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  it("refuses a resend called synchronously from inside its own chain", async () => {
    const h = await boot();
    let resendResult: boolean | undefined;
    h.bridge.bus.rewriters.add("rename_tab", () => {
      resendResult = h.bridge.bus.rewriters.resend("rename_tab");
      return null;
    });
    h.api.postMessage(renameTab());

    expect(resendResult).toBe(false);
    expect(h.sent).toHaveLength(1);
    expect(h.bridge.diagnostics.errors.some((e) => /^resend:rename_tab:refused/.test(e))).toBe(
      true,
    );
  });

  it("is invisible to read taps but counted in diagnostics.resent", async () => {
    const h = await boot();
    const tapped: unknown[] = [];
    h.bridge.bus.on("rename_tab", (payload) => tapped.push(payload));
    h.api.postMessage(renameTab());
    h.bridge.bus.rewriters.resend("rename_tab");

    expect(tapped).toHaveLength(1);
    expect(h.bridge.diagnostics.resent).toBe(1);
  });

  it("keeps a resent bare notification bare", async () => {
    const h = await boot();
    h.api.postMessage({ type: "log_event", name: "original" });
    h.bridge.bus.rewriters.resend("log_event");

    expect(h.sent[1]).toEqual({ type: "log_event", name: "original" });
    expect((h.sent[1] as Record<string, unknown>).request).toBeUndefined();
  });
});

describe("the app's renderer, and any other", () => {
  function hook(): DevtoolsHook {
    return globalRecord()[HOOK] as DevtoolsHook;
  }

  function renderer(version: string, fiber: string) {
    return { version, rendererPackageName: "react-dom", findFiberByHostInstance: () => fiber };
  }

  /** Past the commit notice's coalescing, which falls back to a 16ms timer with no animation frame. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  it("keeps the first renderer's lookup and version, and only counts a later one", async () => {
    const h = await boot();
    hook().inject(renderer("18.3.1", "app fiber"));
    hook().inject(renderer("19.1.0", "foreign fiber"));

    expect(h.bridge.react.fiberFor({})).toBe("app fiber");
    expect(h.bridge.react.rendererVersion()).toBe("18.3.1");
    expect(h.bridge.diagnostics.react.version).toBe("18.3.1");
    expect(h.bridge.diagnostics.react.foreign).toBe(1);
  });

  it("notifies on the app's commits and never on another renderer's", async () => {
    const h = await boot();
    const app = hook().inject(renderer("18.3.1", "app fiber"));
    const other = hook().inject(renderer("19.1.0", "foreign fiber"));
    let notices = 0;
    h.bridge.react.onCommit(() => {
      notices += 1;
    });

    for (let i = 0; i < 3; i++) hook().onCommitFiberRoot(other, {});
    await settle();
    expect(notices).toBe(0);
    expect(h.bridge.diagnostics.react.commits).toBe(0);

    hook().onCommitFiberRoot(app, {});
    await settle();
    expect(notices).toBe(1);
    expect(h.bridge.diagnostics.react.commits).toBe(1);
  });

  it("does the same when chained to a hook that was already there, passing everything on", async () => {
    const passed: unknown[] = [];
    let next = 7;
    const existing: DevtoolsHook = {
      inject: () => next++,
      onCommitFiberRoot: (id) => {
        passed.push(id);
      },
    };
    const h = await boot(existing);
    expect(h.bridge.diagnostics.react.hook).toBe("chained");

    const app = hook().inject(renderer("18.3.1", "app fiber"));
    const other = hook().inject(renderer("19.1.0", "foreign fiber"));
    expect([app, other]).toEqual([7, 8]);
    expect(h.bridge.react.fiberFor({})).toBe("app fiber");

    hook().onCommitFiberRoot(other, {});
    hook().onCommitFiberRoot(app, {});
    expect(passed).toEqual([8, 7]);
    expect(h.bridge.diagnostics.react.commits).toBe(1);
    expect(h.bridge.diagnostics.react.foreign).toBe(1);
  });
});
