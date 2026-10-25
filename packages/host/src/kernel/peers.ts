/**
 * The channel every editor-tab panel on this machine shares, under a name `install` derives from the
 * token (D141): one envelope, and a body per type that its own reader checks. A hint that is never
 * relied on, so whatever arrives that this version does not understand is dropped and counted.
 */
import { RIGLINE } from "@rigline/plugin-api/internal";
import type { Diagnostics } from "./bridge.ts";

export const PEERS_VERSION = 1;

/** A body as its type holds it, or why it does not — naming a field, never a value. */
export type Reader<T> = (body: unknown) => T | string;

export interface Peers {
  post(type: string, body: unknown): void;
  /** Hears `type` from the other panels, each body through `read` before `handle` sees it. */
  on<T>(type: string, read: Reader<T>, handle: (body: T) => void): void;
  close(): void;
}

export interface PeersOptions {
  /** The channel's name from `registry.js`, or null where there is no token. */
  readonly name: string | null;
  readonly counts: Diagnostics["broadcast"];
  readonly fail: (reason: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Random per panel and never kept: a panel only has to know itself within its own life. */
function senderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createPeers(options: PeersOptions): Peers {
  const { name, counts, fail } = options;
  const from = senderId();
  const types = new Map<string, (body: unknown) => void>();
  let channel: BroadcastChannel | null = null;
  if (name !== null) {
    try {
      channel = new BroadcastChannel(name);
      counts.open = true;
    } catch (e) {
      fail(`the channel did not open: ${message(e)}`);
    }
  }

  function drop(reason: string): void {
    counts.dropped += 1;
    counts.lastDrop = reason;
  }

  function tally(type: string, field: "posted" | "heard"): void {
    const entry = (counts.types[type] ??= { posted: 0, heard: 0 });
    entry[field] += 1;
    counts[field] += 1;
  }

  if (channel !== null) {
    channel.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isRecord(data)) return drop("a message that is not an object");
      if (data.v !== PEERS_VERSION) return drop("an unknown version");
      if (typeof data.from !== "string") return drop("no sender");
      if (data.from === from) return drop("its own message");
      if (data.ns !== RIGLINE) return drop("an unknown namespace");
      const take = typeof data.type === "string" ? types.get(data.type) : undefined;
      if (take === undefined) return drop("an unknown type");
      take(data.body);
    };
    channel.onmessageerror = () => drop("a message that could not be read");
  }

  return {
    post(type, body) {
      if (channel === null) return;
      try {
        channel.postMessage({ v: PEERS_VERSION, from, ns: RIGLINE, type, body });
        tally(type, "posted");
      } catch (e) {
        fail(`could not tell the other panels of a ${type}: ${message(e)}`);
      }
    },
    on(type, read, handle) {
      types.set(type, (body) => {
        const held = read(body);
        if (typeof held === "string") return drop(held);
        tally(type, "heard");
        try {
          handle(held);
        } catch (e) {
          fail(`a ${type} from another panel: ${message(e)}`);
        }
      });
    },
    close() {
      channel?.close();
      channel = null;
    },
  };
}
