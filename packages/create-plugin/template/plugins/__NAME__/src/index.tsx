/**
 * __DESCRIPTION__
 *
 * A worked example of the loop every plugin is: declare what you contribute and depend on in
 * `rigline.json`, keep what you learn in a store, and render it from a component. Replace the body;
 * keep the shape.
 */
import {
  definePlugin,
  type PluginContext,
  type Store,
  store,
  type Teardown,
} from "@rigline/plugin-api";
import { Pill, useStore } from "@rigline/plugin-api/ui";
import type { ReactNode } from "react";

/**
 * What the badge reads, for a given number of tool calls.
 *
 * Pure, and exported, because this is the half a plain `vitest` run can hold: anything that renders
 * wants the app itself, and anything that does not should not need it. See `src/index.test.ts`.
 */
export function badgeText(calls: number): string {
  if (calls === 0) return "no tools yet";
  return `${calls} tool ${calls === 1 ? "call" : "calls"}`;
}

function Badge(props: { readonly calls: Store<number> }): ReactNode {
  return <Pill>{badgeText(useStore(props.calls))}</Pill>;
}

export default definePlugin({
  setup(ctx: PluginContext): Teardown {
    // A store, made here rather than in the component, because state caught in `setup` is caught
    // from the moment the plugin loads, and the badge and anything else can share it.
    const calls = store(0);

    // Every completed tool call the assistant makes. `uses.tools` is what makes this fire; without
    // the declaration it throws and disables the plugin, which is the point of declaring.
    const stopTools = ctx.onToolUse(() => calls.set(calls.get() + 1));

    // `badge` is declared under `elements` in rigline.json, which says where it goes by default:
    // before `footerSpacer`, at the end of the composer footer's left cluster. Rigline places it,
    // keeps it placed, and moves it if the user asks for it somewhere else.
    const stopBadge = ctx.element("badge", () => <Badge calls={calls} />);

    // One line in Rigline's diagnostics panel, under this plugin's name. Whether the badge is on
    // screen is Rigline's to say, and it does; ask what only your own state can answer, and say
    // `n/a` with a reason when there is nothing to report yet. The host runs this about once a
    // second, so read state you already keep rather than computing anything here.
    const stopCheck = ctx.check("tool calls observed", () =>
      calls.get() === 0
        ? { verdict: "n/a", detail: "none yet" }
        : { verdict: "pass", detail: badgeText(calls.get()) },
    );

    return () => {
      stopCheck();
      stopBadge();
      stopTools();
    };
  },
});
