import { ANCHORS, type AnchorName, CONTRACTS } from "@rigline/plugin-api";
import { type CapabilityModule, declaredSwitch, undeclared } from "../kernel/types.ts";
import {
  anchorUniqueVerdict,
  mountReplacementVerdict,
  mountsInPlaceVerdict,
  watchesFoundVerdict,
} from "../kernel/verdicts.ts";

/** `ctx.mount`, `ctx.mountAfter`, `ctx.mountBefore` and `ctx.watch`: DOM placement the host keeps
 * in place. */
export const mountModule: CapabilityModule<"mount"> = {
  contract: CONTRACTS.find((c) => c.key === "mount") as CapabilityModule<"mount">["contract"],
  grant({ plugin, kernel, own, disable }) {
    if (!declaredSwitch(plugin, "mount")) {
      return {
        mount: undeclared("mount", "mount"),
        mountAfter: undeclared("mountAfter", "mount"),
        mountBefore: undeclared("mountBefore", "mount"),
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
      mountBefore(sibling, build) {
        const off = kernel.mounts.attach(
          sibling,
          "before",
          plugin.order,
          plugin.name,
          build,
          disable,
          "mountBefore()",
        );
        return off ? own(off) : () => {};
      },
      watch(name, onFound) {
        if (!declaredAnchors.has(name) && !optionalAnchors.has(name)) {
          throw new Error(
            `watch("${name}") needs the anchor under uses.anchors in this plugin's rigline.json`,
          );
        }
        // The selector, not the class. An anchor's class may be on several controls and the
        // selector is where the table says which one it means (D7); a style anchor has no selector
        // because it is borrowed rather than queried, and watching one is a plugin's mistake
        // rather than a version's, so it says so in those words.
        const selector = kernel.tables.anchorSelectors?.[name] ?? null;
        if (!selector) {
          // Required and absent cannot reach here: the declaration check refused the plugin before
          // its module was imported. Optional and absent is the case this exists for — watching
          // nothing, which is what every other optional dependency does when it is not there (D41).
          if (kernel.tables.anchors[name]) {
            throw new Error(`anchor "${name}" is a borrowed style, which has no element to watch`);
          }
          if (declaredAnchors.has(name)) {
            throw new Error(
              kernel.tables.unresolvedAnchors?.[name] ??
                `anchor "${name}" is not in this extension`,
            );
          }
          return () => {};
        }
        // `unique` is the anchor's own claim, carried through so the host can notice at runtime
        // when it stops holding (D7). The table is Rigline's vocabulary and ships with the loader,
        // so this is a lookup rather than another generated field.
        const target = {
          anchor: name,
          selector,
          unique: ANCHORS[name as AnchorName]?.kind === "singleton",
        };
        return own(
          kernel.mounts.watch(target, plugin.name, (el) => onFound(el) ?? undefined, disable),
        );
      },
    };
  },
  checks(kernel) {
    const m = kernel.diagnostics.mounts;
    return [
      {
        name: "mount: nodes are where the host put them",
        run: () => mountsInPlaceVerdict(kernel.mounts.inspect().mounts),
      },
      {
        name: "mount: watches have found their element",
        run: () => watchesFoundVerdict(kernel.mounts.inspect().watches),
      },
      {
        name: "mount: re-placement after a re-render",
        run: () =>
          mountReplacementVerdict(m.driver, m.active, m.replaced, m.moved, m.lost, m.abandoned),
      },
      {
        name: "mount: watched singletons match one element",
        run: () => anchorUniqueVerdict(m.multiple),
      },
    ];
  },
};
