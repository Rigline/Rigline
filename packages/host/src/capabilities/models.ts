import { CONTRACTS } from "@rigline/plugin-api/internal";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { modelStateVerdict } from "../kernel/verdicts.ts";

/** `ctx.onModelState(handler)`: which models this install offers, derived by the kernel (D120). */
export const modelsModule: CapabilityModule<"models"> = {
  contract: CONTRACTS.find((c) => c.key === "models") as CapabilityModule<"models">["contract"],
  grant({ plugin, kernel, own, guard }) {
    if (!declaredSwitch(plugin, "models")) {
      return { onModelState: undeclared("onModelState", "models") };
    }
    return {
      onModelState(handler) {
        return own(kernel.models.subscribe(guard("onModelState() handler", handler)));
      },
    };
  },
  checks(kernel) {
    const used = usedOnSurface(kernel, "models");
    return [
      {
        name: "models: list observed",
        run: () => modelStateVerdict(used, kernel.models.current, kernel.models.stats),
      },
    ];
  },
};
