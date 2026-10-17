/**
 * The panel's channel, as the context and cost services follow it: the last `launch_claude` the
 * panel sent, or the first `io_message` channel when no launch has been seen.
 */
import { ioChannel } from "@rigline/plugin-api/internal";
import type { Bus } from "./bridge.ts";

export interface ChannelHandlers {
  /**
   * A new channel is followed, and everything read from the last one is now stale. `resumed` when
   * the launch named a session to resume, as a restored conversation's and a relaunch's do.
   */
  start(channel: string, resumed: boolean): void;
  /** One `io_message` on the followed channel. */
  record(payload: unknown): void;
}

export function followChannel(bus: Bus, handlers: ChannelHandlers): void {
  let channel: string | null = null;
  const start = (next: string, resumed: boolean) => {
    channel = next;
    handlers.start(next, resumed);
  };
  bus.on("launch_claude", (payload) => {
    const { channelId: next, resume } = payload as { channelId?: unknown; resume?: unknown };
    if (typeof next === "string" && next !== channel) {
      start(next, typeof resume === "string" && resume !== "");
    }
  });
  bus.on("io_message", (payload) => {
    const on = ioChannel(payload);
    if (on === null) return;
    if (channel === null) start(on, false);
    if (on === channel) handlers.record(payload);
  });
}
