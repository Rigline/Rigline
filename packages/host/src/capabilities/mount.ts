import { CONTRACTS } from "@prototype/plugin-api";
import { type CapabilityModule, undeclared } from "../kernel/types.ts";

/** `ctx.mount`, `ctx.mountAfter` and `ctx.watch`: DOM placement the host keeps in place. */
export const mountModule: CapabilityModule<"mount"> = {
  contract: CONTRACTS.find((c) => c.key === "mount") as CapabilityModule<"mount">["contract"],
  grant({ plugin, kernel, own, disable }) {
    if (!plugin.uses.mount) {
      return {
        mount: undeclared("mount", "mount"),
        mountAfter: undeclared("mountAfter", "mount"),
        watch: undeclared("watch", "mount"),
      };
    }
    const declaredAnchors = new Set(plugin.uses.anchors);
    return {
      mount(target, build) {
        const off = kernel.mounts.attach(
          target,
          "inside",
          plugin.order,
          plugin.name,
          build,
          disable,
          "mount()",
        );
        return off ? own(off) : () => {};
      },
      mountAfter(sibling, build) {
        const off = kernel.mounts.attach(
          sibling,
          "after",
          plugin.order,
          plugin.name,
          build,
          disable,
          "mountAfter()",
        );
        return off ? own(off) : () => {};
      },
      watch(name, onFound) {
        if (!declaredAnchors.has(name)) {
          throw new Error(
            `watch("${name}") needs the anchor under uses.anchors in this plugin's prototype.json`,
          );
        }
        const className = kernel.tables.anchors[name];
        if (!className) throw new Error(`anchor "${name}" is not in this extension`);
        return own(kernel.mounts.watch(className, (el) => onFound(el) ?? undefined, disable));
      },
    };
  },
};
