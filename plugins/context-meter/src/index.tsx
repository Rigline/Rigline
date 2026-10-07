/**
 * How full the session's context is: a bar in `rigRow` and a percentage in the composer footer.
 * The percentage is the panel's own, tokens used against where Claude Code compacts on its own;
 * the host derives both counts (D121), and this only draws them.
 */
import {
  type ContextUsage,
  definePlugin,
  type PluginContext,
  type Store,
  storeFrom,
} from "@rigline/plugin-api";
import { Pill, useStore } from "@rigline/plugin-api/ui";
import type { ReactNode } from "react";

export type Band = "low" | "mid" | "high";

/** Where the panel's own indicator changes its glyph, so the colour changes where it does. */
const MID_FROM = 62.5;
const HIGH_FROM = 87;

const COLOURS: Readonly<Record<Band, string>> = {
  low: "var(--vscode-charts-green, #89d185)",
  mid: "var(--vscode-charts-yellow, #cca700)",
  high: "var(--vscode-charts-red, #f14c4c)",
};

const UNKNOWN: ContextUsage = { used: null, limit: null, autoCompact: true, stale: false };

/** The whole percentage used, rounded as the panel rounds it, or null while there is none to show. */
export function percentUsed(usage: ContextUsage): number | null {
  if (usage.stale || usage.used === null || usage.limit === null) return null;
  return Math.round(Math.min((usage.used / usage.limit) * 100, 100));
}

export function band(percent: number): Band {
  if (percent < MID_FROM) return "low";
  return percent < HIGH_FROM ? "mid" : "high";
}

function thousands(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${Number((tokens / 1000).toFixed(1))}k`;
}

export function tooltip(usage: ContextUsage): string {
  if (usage.stale) return "Context compacted; waiting for the next reading";
  if (usage.used === null) return "Context: waiting for the first reading";
  if (usage.limit === null)
    return `Context: ${thousands(usage.used)} tokens; the limit is not known yet`;
  const percent = percentUsed(usage);
  const of = usage.autoCompact
    ? `${percent}% of the way to auto-compact`
    : `${percent}% of the window (auto-compact is off)`;
  return `Context: ${of}\n${thousands(usage.used)} of ${thousands(usage.limit)} tokens`;
}

interface Props {
  readonly usage: Store<ContextUsage>;
}

/** Fixed width and whole numbers, so the footer re-measures only when the number changes (D54). */
function Percent({ usage }: Props): ReactNode {
  const current = useStore(usage);
  const percent = percentUsed(current);
  return (
    <Pill muted={percent === null} title={tooltip(current)}>
      <span
        style={{
          display: "inline-block",
          minWidth: "4ch",
          textAlign: "center",
          color: percent === null ? undefined : COLOURS[band(percent)],
        }}
      >
        {percent ?? "–"}%
      </span>
    </Pill>
  );
}

function Bar({ usage }: Props): ReactNode {
  const current = useStore(usage);
  const percent = percentUsed(current);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <meter> paints through pseudo-elements, which inline styles cannot reach
    <div
      role="meter"
      aria-label="Context used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      title={tooltip(current)}
      style={{
        display: "flex",
        alignItems: "center",
        flex: "1 1 8em",
        minWidth: "4em",
        height: "var(--app-pill-min-height, 18px)",
      }}
    >
      <div
        style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          overflow: "hidden",
          background: "color-mix(in srgb, currentColor 15%, transparent)",
          outline: "1px solid var(--vscode-contrastBorder, transparent)",
        }}
      >
        <div
          style={{
            width: `${percent ?? 0}%`,
            height: "100%",
            background: percent === null ? "transparent" : COLOURS[band(percent)],
            transition: "width 300ms ease, background-color 300ms ease",
          }}
        />
      </div>
    </div>
  );
}

export default definePlugin({
  setup(ctx: PluginContext) {
    const usage = storeFrom(ctx.onContextUsage, UNKNOWN);
    ctx.element("bar", () => <Bar usage={usage} />);
    ctx.element("percent", () => <Percent usage={usage} />);
  },
});
