import { CONTRACTS } from "@prototype/plugin-api";
import { type CapabilityModule, undeclared } from "../kernel/types.ts";

/** `ctx.onSessionId(handler)`: the panel's session, derived once by the kernel's session service. */
export const sessionModule: CapabilityModule<"session"> = {
  contract: CONTRACTS.find((c) => c.key === "session") as CapabilityModule<"session">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!plugin.uses.session) return { onSessionId: undeclared("onSessionId", "session") };
    return {
      onSessionId(handler) {
        return own(kernel.session.subscribe(guard("onSessionId() handler", handler)));
      },
    };
  },
};
