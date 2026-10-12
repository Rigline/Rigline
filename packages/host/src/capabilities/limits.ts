import { CONTRACTS } from "@rigline/plugin-api/internal";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { usageLimitsVerdict } from "../kernel/verdicts.ts";

/** `ctx.onUsageLimits(handler)`: the plan's usage windows, derived by the kernel (D129). */
export const limitsModule: CapabilityModule<"limits"> = {
  contract: CONTRACTS.find((c) => c.key === "limits") as CapabilityModule<"limits">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!declaredSwitch(plugin, "limits")) {
      return { onUsageLimits: undeclared("onUsageLimits", "limits") };
    }
    return {
      onUsageLimits(handler) {
        return own(kernel.limits.subscribe(guard("onUsageLimits() handler", handler)));
      },
    };
  },
  checks(kernel) {
    const used = usedOnSurface(kernel, "limits");
    return [
      {
        name: "limits: windows observed",
        run: () => usageLimitsVerdict(used, kernel.limits.current, kernel.limits.stats),
      },
    ];
  },
};
