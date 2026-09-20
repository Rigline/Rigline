/**
 * __DESCRIPTION__
 *
 * A worked example of the loop every plugin is: declare what you depend on in `rigline.json`, wait
 * to be handed the element you decorate, and put something beside it. Replace the body; keep the
 * shape.
 */
import { definePlugin, type PluginContext, type Teardown } from "@rigline/plugin-api";

/**
 * What the badge reads, for a given number of tool calls.
 *
 * Pure, and exported, because this is the half a plain `vitest` run can hold: anything that touches
 * the DOM wants the app itself, and anything that does not should not need it. See
 * `src/index.test.ts`.
 */
export function badgeText(calls: number): string {
  if (calls === 0) return "no tools yet";
  return `${calls} tool ${calls === 1 ? "call" : "calls"}`;
}

export default definePlugin({
  setup(ctx: PluginContext): Teardown {
    let calls = 0;
    const badge = document.createElement("span");
    badge.className = "example-badge";
    badge.textContent = badgeText(calls);

    // Scoped to a class this plugin put on its own element. Never scope a rule to an anchor's bare
    // class: one class is applied wherever that look is wanted, so a rule written against it lands
    // on every control wearing it. See the anchors guide.
    const stopStyle = ctx.style(`
      .example-badge {
        font-size: 11px;
        opacity: 0.7;
        padding: 0 6px;
        white-space: nowrap;
      }
    `);

    // Every completed tool call the assistant makes. `uses.tools` is what makes this fire; without
    // the declaration it throws and disables the plugin, which is the point of declaring.
    const stopTools = ctx.onToolUse(() => {
      calls += 1;
      badge.textContent = badgeText(calls);
    });

    // `watch` hands over the element for an anchor whenever one is in the document, and again if
    // the app replaces it. No plugin polls for an element.
    //
    // `footerSpacer` and `mountBefore` together, rather than any other footer anchor: the composer
    // footer measures the widths of its own element children to pick a fit stage, and resets that
    // measurement on any foreign change inside it. A decoration whose membership of the footer
    // changes with the stage fights the ladder that moved it. The spacer renders in every stage, so
    // a decoration beside it contributes a constant width and the ladder settles.
    const stopWatch = ctx.watch("footerSpacer", (spacer) => ctx.mountBefore(spacer, () => badge));

    // One line in Rigline's diagnostics panel, under this plugin's name. It declares nothing: the
    // host calls it, hands it nothing, and gets a verdict back.
    //
    // Worth the four lines from the first day, because the failure a plugin has is normally silent.
    // An extension update can leave this one loaded, declared, styled and drawing nothing, and
    // every other line in that panel will say it is fine. Ask the question only your own state can
    // answer — here, whether the badge is actually in the document — and say `n/a` with a reason
    // when there is nothing to report yet.
    //
    // The host runs this about once a second for the life of the window, so read state you already
    // keep. Do not walk the DOM or recompute an answer here; do that work where it already happens.
    const stopCheck = ctx.check("badge is mounted", () =>
      badge.isConnected
        ? { verdict: "pass", detail: badgeText(calls) }
        : { verdict: "fail", detail: "the badge is not in the document" },
    );

    return () => {
      stopCheck();
      stopWatch();
      stopTools();
      stopStyle();
    };
  },
});
