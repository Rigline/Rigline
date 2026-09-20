import { CONTRACTS } from "@rigline/plugin-api";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { transcriptVerdict } from "../kernel/verdicts.ts";

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
    if (!declaredSwitch(plugin, "transcript")) {
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
  checks(kernel) {
    const used = usedOnSurface(kernel, "transcript");
    // Held by the check rather than by the service: how long rows have been present with nothing
    // timed is a fact about how long anybody has been *asking*, and nothing else wants to know.
    let untimedSince: number | null = null;
    return [
      {
        name: "transcript: rows identified and timed",
        run: () => {
          if (kernel.surface === "sessionList") {
            return { verdict: "n/a", detail: "the session list renders no transcript" };
          }
          const { entries, timed } = kernel.diagnostics.transcript;
          if (entries === 0 || timed > 0) untimedSince = null;
          else if (untimedSince === null) untimedSince = performance.now();
          const stuck = untimedSince === null ? null : performance.now() - untimedSince;
          return transcriptVerdict(used, entries, timed, stuck);
        },
      },
    ];
  },
};
