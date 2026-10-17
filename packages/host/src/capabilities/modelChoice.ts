import { CONTRACTS } from "@rigline/plugin-api/internal";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { modelChoiceVerdict } from "../kernel/verdicts.ts";

/**
 * `ctx.applyChoice(choice, event)`: the model and the effort that goes with it (D120 as amended).
 *
 * **The event is here and the composition is the kernel's.** A plugin names a model and an effort;
 * the kernel validates them against the list the panel is holding and builds every payload, so a
 * plugin names no message type, no settings key and no field. What this module adds is the one check
 * that needs the call site: the event must be one a person caused.
 */
export const modelChoiceModule: CapabilityModule<"modelChoice"> = {
  contract: CONTRACTS.find(
    (c) => c.key === "modelChoice",
  ) as CapabilityModule<"modelChoice">["contract"],
  grant({ plugin, kernel }) {
    if (!declaredSwitch(plugin, "modelChoice")) {
      return { applyChoice: undeclared("applyChoice", "modelChoice") };
    }
    return {
      applyChoice(choice: unknown, event: unknown) {
        // `isTrusted` cannot be forged: Blink defines it on the event instance as a
        // non-configurable accessor, so `defineProperty` throws and the value still reads false.
        // A plain `=== true` is therefore enough, and `Event.prototype` has no such descriptor to
        // reach through.
        //
        // `eventPhase` is deliberately not checked. Requiring the dispatch to still be running
        // would forbid confirm-then-apply and anything after an `await`, for a bar a plugin minded
        // to misbehave has shorter ways round. This keeps the compliance claim true — no write on a
        // timer, none from a tap, none at load — rather than defending against a plugin already
        // running in the page, which nothing here can do (D79).
        const trusted =
          typeof event === "object" &&
          event !== null &&
          (event as { readonly isTrusted?: unknown }).isTrusted === true;
        if (!trusted) {
          return Promise.resolve({
            refused:
              "applyChoice needs the event from something a person did; a scripted one does not count",
          });
        }
        return kernel.models.apply(choice as never);
      },
    };
  },
  checks(kernel) {
    const used = usedOnSurface(kernel, "modelChoice");
    return [
      {
        name: "modelChoice: choices applied",
        run: () => modelChoiceVerdict(used, kernel.models.stats),
      },
    ];
  },
};
