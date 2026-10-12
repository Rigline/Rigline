/**
 * What the session has cost and how much of the plan is used: a pill for each. The figures are the
 * host's (D129); this only draws them, and colours each window by where it is heading.
 */
import {
  definePlugin,
  type LimitWindow,
  type PluginContext,
  type SessionCost,
  type Store,
  storeFrom,
  type UsageLimits,
} from "@rigline/plugin-api";
import { Pill, useStore } from "@rigline/plugin-api/ui";
import { type ReactNode, useEffect, useState } from "react";

export type Band = "low" | "mid" | "high";
export type WindowName = "fiveHour" | "sevenDay";

const HOUR = 3_600_000;

const WINDOWS: Readonly<
  Record<WindowName, { readonly short: string; readonly title: string; readonly period: number }>
> = {
  fiveHour: { short: "5h", title: "Five-hour limit", period: 5 * HOUR },
  sevenDay: { short: "7d", title: "Weekly limit", period: 7 * 24 * HOUR },
};

/** The panel's own usage bars turn "high" here, so yellow starts where they change. */
const MID_FROM = 0.8;
const HIGH_FROM = 1;
/** How much of a window must have gone before its pace says anything. */
const PACE_FROM = 0.1;

const COLOURS: Readonly<Record<Band, string>> = {
  low: "var(--vscode-charts-green, #89d185)",
  mid: "var(--vscode-charts-yellow, #cca700)",
  high: "var(--vscode-charts-red, #f14c4c)",
};

const UNKNOWN_COST: SessionCost = { usd: null, models: {}, metered: null };
const UNKNOWN_LIMITS: UsageLimits = { fiveHour: null, sevenDay: null };

function money(usd: number): string {
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** What the cost pill reads: a tilde on a plan, where the figure is list price. */
export function costLabel(cost: SessionCost): string {
  if (cost.usd === null) return "$–";
  return `${cost.metered === false ? "~" : ""}${money(cost.usd)}`;
}

export function costTooltip(cost: SessionCost): string {
  if (cost.usd === null) return "Session cost: waiting for a turn that carries cost data";
  const lines = [`Session cost: ${money(cost.usd)}, Claude Code's estimate`];
  const models = Object.entries(cost.models).sort(([, a], [, b]) => b.usd - a.usd);
  if (models.length > 1) lines.push(...models.map(([model, m]) => `${model}: ${money(m.usd)}`));
  if (models.some(([, m]) => m.basis === "unknown")) {
    lines.push("Some of it is priced as the main model, for a model Claude Code has no price for.");
  }
  if (models.some(([, m]) => m.basis === "managed")) lines.push("At your organisation's rates.");
  if (cost.metered === false) {
    lines.push("On a claude.ai plan this is the list price of what was used, not what you pay.");
  }
  lines.push("It moves when a turn finishes.");
  return lines.join("\n");
}

/** How far through its period a window is, from 0 to 1, or null without a reset time. */
export function elapsed(reading: LimitWindow, period: number, now: number): number | null {
  if (reading.resetsAt === null) return null;
  return Math.min(Math.max((now - (reading.resetsAt - period)) / period, 0), 1);
}

/** Where the window will be at its reset at this pace, once enough of it has gone to say. */
export function projected(reading: LimitWindow, period: number, now: number): number | null {
  const gone = elapsed(reading, period, now);
  return gone === null || gone < PACE_FROM ? null : reading.used / gone;
}

/** Coloured by where the window is heading, so red is running out before the reset. */
export function band(reading: LimitWindow, period: number, now: number): Band {
  const heading = Math.max(reading.used, projected(reading, period, now) ?? 0);
  if (heading < MID_FROM) return "low";
  return heading < HIGH_FROM ? "mid" : "high";
}

/** The whole percentage used, as the panel's own bars show it. */
export function percentUsed(reading: LimitWindow): number {
  return Math.floor(Math.min(Math.max(reading.used, 0), 1) * 100);
}

function resetText(name: WindowName, at: number): string {
  const options: Intl.DateTimeFormatOptions =
    name === "fiveHour"
      ? { hour: "2-digit", minute: "2-digit" }
      : { weekday: "short", hour: "2-digit", minute: "2-digit" };
  return new Date(at).toLocaleString(undefined, options);
}

export function windowTooltip(name: WindowName, reading: LimitWindow | null, now: number): string {
  const { title, period } = WINDOWS[name];
  if (reading === null) {
    return `${title}: no reading yet. Claude Code reports one after a request, on a claude.ai plan.`;
  }
  if (reading.resetsAt === null) {
    return reading.used === 0
      ? `${title}: reset; the next request starts a new window`
      : `${title}: ${percentUsed(reading)}% used`;
  }
  const lines = [
    `${title}: ${percentUsed(reading)}% used, resets ${resetText(name, reading.resetsAt)}`,
  ];
  const pace = projected(reading, period, now);
  if (pace !== null) {
    lines.push(
      pace >= 1
        ? "At this pace it runs out before then"
        : `At this pace, about ${Math.round(pace * 10) * 10}% by then`,
    );
  }
  return lines.join("\n");
}

/** The time, a minute at a time, so a window's colour follows its pace while nothing is said. */
function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function CostPill({ cost }: { readonly cost: Store<SessionCost> }): ReactNode {
  const current = useStore(cost);
  return (
    <Pill muted={current.usd === null} title={costTooltip(current)}>
      {costLabel(current)}
    </Pill>
  );
}

interface LimitPillProps {
  readonly name: WindowName;
  readonly limits: Store<UsageLimits>;
  readonly cost: Store<SessionCost>;
}

function LimitPill({ name, limits, cost }: LimitPillProps): ReactNode {
  const reading = useStore(limits)[name];
  const metered = useStore(cost).metered;
  const now = useMinute();
  // A metered account is never sent a window, so a placeholder would hold its place for ever.
  if (reading === null && metered === true) return null;
  const { short, period } = WINDOWS[name];
  return (
    <Pill muted={reading === null} title={windowTooltip(name, reading, now)}>
      {/* One inline span: the pill is a flex container, which drops a space between its items. */}
      <span>
        {short}:{" "}
        <span style={{ color: reading === null ? undefined : COLOURS[band(reading, period, now)] }}>
          {reading === null ? "–" : percentUsed(reading)}%
        </span>
      </span>
    </Pill>
  );
}

export default definePlugin({
  setup(ctx: PluginContext) {
    const cost = storeFrom(ctx.onSessionCost, UNKNOWN_COST);
    const limits = storeFrom(ctx.onUsageLimits, UNKNOWN_LIMITS);
    ctx.element("cost", () => <CostPill cost={cost} />);
    ctx.element("five-hour", () => <LimitPill name="fiveHour" limits={limits} cost={cost} />);
    ctx.element("seven-day", () => <LimitPill name="sevenDay" limits={limits} cost={cost} />);
  },
});
