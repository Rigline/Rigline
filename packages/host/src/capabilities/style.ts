import { CONTRACTS } from "@rigline/plugin-api";
import { type CapabilityModule, declaredSwitch, undeclared } from "../kernel/types.ts";

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
        return own(() => element.remove());
      },
    };
  },
};
