import { CONTRACTS } from "@rigline/plugin-api";
import { type CapabilityModule, declaredSwitch, undeclared } from "../kernel/types.ts";

/** `ctx.onSessionId(handler)`: the panel's session, derived once by the kernel's session service. */
export const sessionModule: CapabilityModule<"session"> = {
  contract: CONTRACTS.find((c) => c.key === "session") as CapabilityModule<"session">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!declaredSwitch(plugin, "session")) {
      return { onSessionId: undeclared("onSessionId", "session") };
    }
    return {
      onSessionId(handler) {
        return own(kernel.session.subscribe(guard("onSessionId() handler", handler)));
      },
    };
  },
};
