import { CONTRACTS, type IdentifierTables, stylesheetNames } from "@rigline/plugin-api/internal";
import {
  type CapabilityModule,
  CapabilityViolation,
  declaredSwitch,
  type PluginRecord,
  undeclared,
} from "../kernel/types.ts";
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

const described = new WeakMap<IdentifierTables, ReadonlyMap<string, string>>();

/**
 * Every class in the class table, `moduleClasses`, with what a refusal naming it should say: its
 * anchor where it has one, else its module and local name.
 */
function classTable(tables: IdentifierTables): ReadonlyMap<string, string> {
  const cached = described.get(tables);
  if (cached !== undefined) return cached;
  const anchorOf = new Map<string, string>();
  for (const [name, cls] of Object.entries(tables.anchors)) {
    if (cls !== null && !anchorOf.has(cls)) anchorOf.set(cls, name);
  }
  const table = new Map<string, string>();
  for (const [module, locals] of Object.entries(tables.moduleClasses)) {
    for (const [local, cls] of Object.entries(locals)) {
      const anchor = anchorOf.get(cls);
      table.set(
        cls,
        anchor !== undefined
          ? `the extension's class behind the anchor "${anchor}", which rigline.json does not ` +
              "declare. Declare the anchor under uses.anchors and build the selector from " +
              `ctx.anchor("${anchor}")`
          : `the extension's class "${local}" in module ${module}, which rigline.json does not ` +
              `declare. Declare it under uses.classes as { "${module}": ["${local}"] } and build ` +
              `the selector from ctx.cls("${module}", "${local}")`,
      );
    }
  }
  described.set(tables, table);
  return table;
}

/** Every class the plugin's declarations resolve to on this version, required or optional. */
function declaredClasses(plugin: PluginRecord, tables: IdentifierTables): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const classes of [plugin.uses.classes, plugin.uses.optional.classes]) {
    for (const [module, locals] of Object.entries(classes)) {
      for (const local of locals) {
        const cls = tables.moduleClasses[module]?.[local];
        if (cls !== undefined) declared.add(cls);
      }
    }
  }
  for (const name of [...plugin.uses.anchors, ...plugin.uses.optional.anchors]) {
    const cls = tables.anchors[name];
    if (cls) declared.add(cls);
  }
  return declared;
}

/**
 * Why this stylesheet may not be placed, or null (D107). Only a class in this version's class table
 * counts as the extension's: a plugin's own class, and one no module defines, pass.
 */
function refusal(
  css: string,
  tables: IdentifierTables,
  declared: ReadonlySet<string>,
): string | null {
  const names = stylesheetNames(css);
  if (names.classAttribute !== null) {
    return (
      `style() selects on the class attribute (${names.classAttribute}), which reaches the ` +
      "extension's classes without declaring one. Select your own elements by class, and the " +
      "extension's through ctx.cls or an anchor."
    );
  }
  const table = classTable(tables);
  for (const cls of names.classes) {
    const owner = declared.has(cls) ? undefined : table.get(cls);
    if (owner !== undefined) return `style() names .${cls}, ${owner}.`;
  }
  return null;
}

/** `ctx.style(css)`: a host-managed stylesheet, stamped with its owner and removed on teardown. */
export const styleModule: CapabilityModule<"style"> = {
  contract: CONTRACTS.find((c) => c.key === "style") as CapabilityModule<"style">["contract"],
  grant({ plugin, kernel, own }) {
    if (!declaredSwitch(plugin, "style")) return { style: undeclared("style", "style") };
    const declared = declaredClasses(plugin, kernel.tables);
    return {
      style(css) {
        const problem = refusal(css, kernel.tables, declared);
        if (problem !== null) throw new CapabilityViolation(problem);
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
