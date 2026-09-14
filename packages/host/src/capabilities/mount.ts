import { CONTRACTS } from "@rigline/plugin-api";
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
    const optionalAnchors = new Set(plugin.uses.optional.anchors);
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
        if (!declaredAnchors.has(name) && !optionalAnchors.has(name)) {
          throw new Error(
            `watch("${name}") needs the anchor under uses.anchors in this plugin's rigline.json`,
          );
        }
        const className = kernel.tables.anchors[name];
        if (!className) {
          // Required and absent cannot reach here: the declaration check refused the plugin before
          // its module was imported. Optional and absent is the case this exists for — watching
          // nothing, which is what every other optional dependency does when it is not there (D41).
          if (declaredAnchors.has(name)) {
            throw new Error(`anchor "${name}" is not in this extension`);
          }
          return () => {};
        }
        return own(kernel.mounts.watch(className, (el) => onFound(el) ?? undefined, disable));
      },
    };
  },
};
