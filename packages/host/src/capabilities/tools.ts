import { CONTRACTS, toolUses } from "@rigline/plugin-api";
import { type CapabilityModule, declaredSwitch, undeclared } from "../kernel/types.ts";

/**
 * `ctx.onToolUse(handler)`: tool calls lifted out of the conversation stream. The plugin never sees
 * `io_message` itself; the three-deep envelope is host knowledge, pinned by plugin-api's tests.
 */
export const toolsModule: CapabilityModule<"tools"> = {
  contract: CONTRACTS.find((c) => c.key === "tools") as CapabilityModule<"tools">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!declaredSwitch(plugin, "tools")) return { onToolUse: undeclared("onToolUse", "tools") };
    return {
      onToolUse(handler) {
        const guarded = guard("onToolUse() handler", (payload: unknown) => {
          for (const tool of toolUses(payload)) handler(tool);
        });
        return own(kernel.bus.on("io_message", guarded));
      },
    };
  },
};
