import { CONTRACTS, type Payload } from "@rigline/plugin-api";
import type { CapabilityModule } from "../kernel/types.ts";

/** `ctx.onMessage(type, handler)`: a read tap, replayed from the startup exchange, frozen. */
export const messagesModule: CapabilityModule<"messages"> = {
  contract: CONTRACTS.find((c) => c.key === "messages") as CapabilityModule<"messages">["contract"],
  grant({ plugin, kernel, own, guard }) {
    const declared = new Set(plugin.uses.messages);
    return {
      onMessage(type, handler) {
        if (!declared.has(type)) {
          throw new Error(
            `onMessage("${type}") was never declared under uses.messages in this plugin's rigline.json`,
          );
        }
        const guarded = guard(`onMessage("${type}") handler`, (payload: unknown) =>
          handler(payload as Payload),
        );
        return own(kernel.bus.on(type, guarded));
      },
    };
  },
};
