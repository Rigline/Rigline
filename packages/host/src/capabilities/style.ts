import { CONTRACTS } from "@rigline/plugin-api";
import { type CapabilityModule, declaredSwitch, undeclared } from "../kernel/types.ts";
import { stylesheetsVerdict } from "../kernel/verdicts.ts";

/**
 * Every `<style>` this module has placed and not torn down, so its check can ask whether they are
 * still in the document.
 *
 * Module scope, which is host state rather than a plugin's: the elements are keyed by the owner
 * they were stamped with, and a teardown removes its own. A sheet the host placed and something
 * else removed is a plugin whose every rule silently stopped applying, and nothing else in the
 * panel would say so.
 */
const placed = new Set<{ readonly owner: string; readonly element: HTMLStyleElement }>();

/** `ctx.style(css)`: a host-managed stylesheet, stamped with its owner and removed on teardown. */
export const styleModule: CapabilityModule<"style"> = {
  contract: CONTRACTS.find((c) => c.key === "style") as CapabilityModule<"style">["contract"],
  grant({ plugin, own }) {
    if (!declaredSwitch(plugin, "style")) return { style: undeclared("style", "style") };
    return {
      style(css) {
        const element = document.createElement("style");
        element.setAttribute("data-rigline-style", plugin.name);
        element.textContent = css;
        document.head.appendChild(element);
        const record = { owner: plugin.name, element };
        placed.add(record);
        return own(() => {
          placed.delete(record);
          element.remove();
        });
      },
    };
  },
  checks() {
    return [
      {
        name: "style: stylesheets are still in the document",
        run: () =>
          stylesheetsVerdict(
            [...placed].map((s) => ({ owner: s.owner, present: s.element.isConnected })),
          ),
      },
    ];
  },
};
