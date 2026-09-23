import { CONTRACTS } from "@rigline/plugin-api";
import { type CapabilityModule, declaredSwitch, undeclared } from "../kernel/types.ts";
import { shellVerdict } from "../kernel/verdicts.ts";

/** `ctx.menu(component)`: a place in Rigline's menu, which the shell draws (D88). */
export const menuModule: CapabilityModule<"menu"> = {
  contract: CONTRACTS.find((c) => c.key === "menu") as CapabilityModule<"menu">["contract"],
  grant({ plugin, kernel, own, disable }) {
    if (!declaredSwitch(plugin, "menu")) return { menu: undeclared("menu", "menu") };
    return {
      menu(component) {
        if (typeof component !== "function") {
          throw new Error("menu() takes a component: a function returning what to render");
        }
        return own(kernel.shell.contribute(plugin.name, plugin.order, component, disable));
      },
    };
  },
  checks(kernel) {
    return [
      {
        name: "menu: the RIG pill is on screen",
        run: () => {
          const { started, error, pill } = kernel.shell.state;
          return shellVerdict(started, error, pill.isConnected);
        },
      },
    ];
  },
};
