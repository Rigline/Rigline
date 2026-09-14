import { CONTRACTS } from "@rigline/plugin-api";
import { type CapabilityModule, undeclared } from "../kernel/types.ts";

/**
 * `ctx.decorateTranscript(build)`: one entry per transcript row, with its real time, and a node
 * mounted inside the row for each entry the plugin wants to decorate.
 *
 * Refuses up front when no React renderer injected into the hook, rather than registering a
 * decorator that can never fire: every other way this can go wrong is a refusal at load, and
 * this would otherwise be the silent hole among them.
 */
export const transcriptModule: CapabilityModule<"transcript"> = {
  contract: CONTRACTS.find(
    (c) => c.key === "transcript",
  ) as CapabilityModule<"transcript">["contract"],
  grant({ plugin, kernel, own, disable }) {
    if (!plugin.uses.transcript) {
      return { decorateTranscript: undeclared("decorateTranscript", "transcript") };
    }
    return {
      decorateTranscript(build) {
        if (!kernel.transcript.available()) {
          throw new Error(
            "decorateTranscript() has no React renderer: the devtools hook the pre hook installed was never injected, so no row can be identified",
          );
        }
        return own(kernel.transcript.decorate(plugin.name, plugin.order, build, disable));
      },
    };
  },
};
