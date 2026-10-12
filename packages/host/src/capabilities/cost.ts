import { CONTRACTS } from "@rigline/plugin-api/internal";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { sessionCostVerdict } from "../kernel/verdicts.ts";

/** `ctx.onSessionCost(handler)`: what the session has cost, derived by the kernel (D129). */
export const costModule: CapabilityModule<"cost"> = {
  contract: CONTRACTS.find((c) => c.key === "cost") as CapabilityModule<"cost">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!declaredSwitch(plugin, "cost")) {
      return { onSessionCost: undeclared("onSessionCost", "cost") };
    }
    return {
      onSessionCost(handler) {
        return own(kernel.cost.subscribe(guard("onSessionCost() handler", handler)));
      },
    };
  },
  checks(kernel) {
    const used = usedOnSurface(kernel, "cost");
    return [
      {
        name: "cost: result observed",
        run: () => sessionCostVerdict(used, kernel.cost.current, kernel.cost.stats),
      },
    ];
  },
};
