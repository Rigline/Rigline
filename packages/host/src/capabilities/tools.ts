import { CONTRACTS } from "@rigline/plugin-api";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { toolCallsVerdict } from "../kernel/verdicts.ts";

/**
 * `ctx.onToolUse(handler)` and `ctx.onToolResult(handler)`: the assistant's tool calls, and what
 * became of them. The plugin never sees `io_message` itself — the three-deep envelope and the
 * `tool_use_id` correlation are host knowledge, pinned by plugin-api's tests and read once by the
 * kernel's tool service for every plugin that asks (decisions.md, D51).
 */
export const toolsModule: CapabilityModule<"tools"> = {
  contract: CONTRACTS.find((c) => c.key === "tools") as CapabilityModule<"tools">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!declaredSwitch(plugin, "tools")) {
      return {
        onToolUse: undeclared("onToolUse", "tools"),
        onToolResult: undeclared("onToolResult", "tools"),
      };
    }
    return {
      onToolUse(handler) {
        return own(kernel.tools.onUse(guard("onToolUse() handler", handler)));
      },
      onToolResult(handler) {
        return own(kernel.tools.onResult(guard("onToolResult() handler", handler)));
      },
    };
  },
  checks(kernel) {
    // Its own subscription, exactly as a plugin's check would keep its own count: the service
    // hands out calls and counts nothing, and a check that reads is a check that has already been
    // told. Never torn down, because the check it answers lives as long as the panel does.
    const used = usedOnSurface(kernel, "tools");
    let seen = 0;
    let last: string | null = null;
    if (used) {
      kernel.tools.onUse((tool) => {
        seen += 1;
        last = tool.name;
      });
    }
    return [{ name: "tools: calls observed", run: () => toolCallsVerdict(used, seen, last) }];
  },
};
