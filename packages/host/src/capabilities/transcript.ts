import { ANCHORS, CONTRACTS, type Surface } from "@rigline/plugin-api";
import {
  type CapabilityModule,
  declaredSwitch,
  undeclared,
  usedOnSurface,
} from "../kernel/types.ts";
import { transcriptVerdict } from "../kernel/verdicts.ts";

/**
 * Whether this surface renders transcript rows at all, by the anchor the capability finds them with.
 *
 * `transcriptRow` is measured as editor and sidebar, so the session list is not merely empty — it
 * can never have a row. Read from the table rather than by naming the surface, for the same reason
 * `ctx.watch` reads it (D68): the answer belongs to the anchor, and a surface named in a condition
 * here is a second place to correct when the app grows a fourth webview. Absent means *not yet
 * measured*, which must read as "assume it does".
 */
function rendersRows(surface: Surface): boolean {
  const spec = ANCHORS.transcriptRow as { readonly surfaces?: readonly Surface[] };
  return !spec.surfaces || spec.surfaces.includes(surface);
}

/**
 * `ctx.decorateTranscript(build)`: one entry per transcript row, with its real time, and a node
 * mounted inside the row for each entry the plugin wants to decorate.
 *
 * Refuses up front when no React renderer injected into the hook, rather than registering a
 * decorator that can never fire: every other way this can go wrong is a refusal at load, and
 * this would otherwise be the silent hole among them.
 *
 * On a surface with no rows it registers nothing instead, which is not the same case and not a
 * fault. It is also not free to get wrong: the sweep runs on the React commit signal, so a decorator
 * registered on the session list queried for rows once per commit — twenty-seven thousand times in
 * one measured run — to find what could not be there.
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
        if (!rendersRows(kernel.surface)) return () => {};
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
          if (!rendersRows(kernel.surface)) {
            return {
              verdict: "n/a",
              detail: `the ${kernel.surface} surface renders no transcript`,
            };
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
