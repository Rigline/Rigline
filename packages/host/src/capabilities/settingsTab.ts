import { CONTRACTS } from "@rigline/plugin-api/internal";
import { type CapabilityModule, declaredSwitch, undeclared } from "../kernel/types.ts";

/** `ctx.settingsTab(title, component)`: a tab in Rigline's settings screen, which the shell draws. */
export const settingsTabModule: CapabilityModule<"settingsTab"> = {
  contract: CONTRACTS.find(
    (c) => c.key === "settingsTab",
  ) as CapabilityModule<"settingsTab">["contract"],
  grant({ plugin, kernel, own, disable }) {
    if (!declaredSwitch(plugin, "settingsTab")) {
      return { settingsTab: undeclared("settingsTab", "settingsTab") };
    }
    return {
      settingsTab(title, component) {
        if (typeof title !== "string" || title.trim() === "") {
          throw new Error("settingsTab() takes a title: what the tab is called in the rail");
        }
        if (typeof component !== "function") {
          throw new Error("settingsTab() takes a component: a function returning what to render");
        }
        return own(kernel.shell.tab(plugin.name, plugin.order, title, component, disable));
      },
    };
  },
};
