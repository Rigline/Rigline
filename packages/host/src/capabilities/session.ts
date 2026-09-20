import { CONTRACTS } from "@rigline/plugin-api";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { sessionIdVerdict } from "../kernel/verdicts.ts";

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
  checks(kernel) {
    const used = usedOnSurface(kernel, "session");
    let id: string | null = null;
    if (used) {
      kernel.session.subscribe((next) => {
        id = next;
      });
    }
    return [{ name: "session: id observed", run: () => sessionIdVerdict(used, id) }];
  },
};
