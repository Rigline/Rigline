import { CONTRACTS } from "@rigline/plugin-api/internal";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { contextUsageVerdict } from "../kernel/verdicts.ts";

/** `ctx.onContextUsage(handler)`: how full the context is, derived by the kernel (D121). */
export const contextModule: CapabilityModule<"context"> = {
  contract: CONTRACTS.find((c) => c.key === "context") as CapabilityModule<"context">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!declaredSwitch(plugin, "context")) {
      return { onContextUsage: undeclared("onContextUsage", "context") };
    }
    return {
      onContextUsage(handler) {
        return own(kernel.context.subscribe(guard("onContextUsage() handler", handler)));
      },
    };
  },
  checks(kernel) {
    const used = usedOnSurface(kernel, "context");
    return [
      {
        name: "context: usage observed",
        run: () => contextUsageVerdict(used, kernel.context.current, kernel.context.stats),
      },
    ];
  },
};
