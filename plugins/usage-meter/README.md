# usage-meter

What the session has cost and how much of your plan is used: three pills in the row under the
composer's controls.

<p align="center">
  <img src="../../docs/media/usage-meter.png" width="341" alt="The session's cost and the five-hour and weekly limits under the composer, with the five-hour pill's tooltip open on its reset time and pace.">
</p>

## What it shows

- **Session cost**: Claude Code's own estimate of what this session has cost so far, the figure
  `/cost` reports. It is priced the way Claude Code prices it: cache reads and writes at their own
  rates, web searches, and an organisation's own rates where it has them. With more than one model,
  the tooltip gives each one's share.
  - *at managed rates* after the total means an organisation's own rates apply.
  - *(main model's price)* after a model means Claude Code had no price for that model and charged
    it at the main model's.
- **On a claude.ai plan** the figure is the list price of what the session used, not what you pay,
  so it reads `~$1.23`. With an API key, Console or a cloud provider it reads `$1.23`.
- **The five-hour and weekly limits**: `5h: 42%` and `7d: 18%`, the same windows the panel's own
  *Account & usage* bars show. The number is how much is used now. The colour is where the window
  is heading at this pace: green, then yellow once it is heading past 80%, then red once it would
  run out before it resets. Until a tenth of the window has gone, the colour follows what is used
  instead, since a burst at the start says little.
  - The tooltip gives the reset time.
  - *Pace: ~60% at reset* is where the window will be when it resets, at the rate it has been used
    so far. *Pace: runs out before reset* means that rate reaches the limit first.
  - *reset* means the window's time is up, and the next request starts a new one.
- **A dimmed `$–` or `–%`** while there is nothing to show yet.
  - The cost is unknown in a panel until a turn there carries cost data, which a reload starts
    over.
  - Claude Code reports the limits only on a claude.ai plan, after a request.
- With an API key or a cloud provider there are no plan limits, so the two limit pills do not
  appear.

Each is an element, so it can be moved or switched off from Rigline's menu or with `rigline
layout`. All three also fit in the composer footer.

## When it changes

- **The cost moves when a turn finishes**, so a long turn shows the last one's figure until it
  ends. It falls on `/clear`, and a resumed session continues from what Claude Code saved for it.
- **The limits move when Claude Code next hears from Anthropic**, which is after each request in
  any panel signed in to the same account, in this window or another, and a window resets on time.
  Claude Code's own *Account & usage* bars follow only their own window, so the pills can be ahead
  of them.
- **A sidebar panel hears other sidebars, and an editor tab other tabs.** A window holding both
  passes readings between them.

## What it depends on

- **`cost: true`** (required): `ctx.onSessionCost`, which the host reads from each turn's result.
- **`limits: true`** (optional): `ctx.onUsageLimits`, which the host reads from the usage windows
  the extension sends every panel and the readings other panels share. Without it the limit pills
  stay dimmed, and the cost pill still works.

How both are derived is D129 and D147 in `docs/decisions.md`. Rigline asks Claude Code for none of
it: both are messages the panels already receive.
