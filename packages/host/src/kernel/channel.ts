/**
 * The panel's channel, as the context and cost services follow it: the last `launch_claude` the
 * panel sent, or the first `io_message` channel when no launch has been seen.
 */
import { ioChannel } from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";

export interface ChannelHandlers {
  /** A new channel is followed, and everything read from the last one is now stale. */
  start(channel: string): void;
  /** One `io_message` on the followed channel. */
  record(payload: unknown): void;
}

export function followChannel(bus: Bus, handlers: ChannelHandlers): void {
  let channel: string | null = null;
  const start = (next: string) => {
    channel = next;
    handlers.start(next);
  };
  bus.on("launch_claude", (payload) => {
    const next = (payload as { channelId?: unknown }).channelId;
    if (typeof next === "string" && next !== channel) start(next);
  });
  bus.on("io_message", (payload) => {
    const on = ioChannel(payload);
    if (on === null) return;
    if (channel === null) start(on);
    if (on === channel) handlers.record(payload);
  });
}
