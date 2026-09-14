# time-marks

Puts the clock time on every transcript entry — one per content block, the density the CLI
actually writes at, not one per assistant turn — hanging in the empty padding band above the row
rather than taking a line or a column of its own. Where the conversation jumped a calendar day or
paused ten minutes or more, that entry gets a full-width divider instead: a lead ("Today",
"Yesterday", a weekday and date, or "3h 12m later") plus its own time. A small hand-drawn clock
icon after the model pill toggles the whole feature; the choice persists in `localStorage`, and
absence there means on — the feature is why the plugin is installed.

## Depends on

- `uses.transcript`, required — the whole reason this plugin exists: one entry per row with its
  real time, or `null` when no record has said one yet. There is no fallback for a null time; see
  `packages/plugin-api/src/transcript.ts` for where the real times come from and why a row's own
  on-screen timestamp is never read.
- `uses.anchors: ["transcriptRow"]`, required — resolves the row's own class, needed to scope the
  one stylesheet rule below. The `transcript` capability's own contract already depends on this
  class internally to find rows at all (`packages/plugin-api/src/capabilities/switches.ts`), so
  declaring it optional here would buy nothing: losing it costs the whole capability already, not
  one decoration.
- `uses.optional.anchors: ["modelPill", "itemTime"]` — both cosmetic. `modelPill` carries only the
  toggle icon's placement; without it the feature still runs at its stored (default: on) setting,
  just with no button in the composer footer to flip it. `itemTime` is a borrowed style class that
  makes this plugin's time read like the app's own dimmed label; without it the time still renders,
  from inline styles alone.
- `uses.mount`, `uses.style`, both required — placing the toggle icon and injecting the one
  stylesheet rule.

## The one app-owned rule, and why

`styleRules(rowClass)` is the only place this plugin styles an element it did not create itself.
Scoped with `:has(> .rigline-tm-lead)` so it matches only rows this plugin actually decorated with
a divider, and lapses automatically the moment that divider node is removed — no separate cleanup
needed when the feature is toggled off. It sets both `--message-padding-top` (the app's own handle
on the row's padding, the timeline dot's offset and the content's position, all three deriving from
it) and a literal `padding-top`, because a sticky-header row was found to set `padding-top` outright
rather than deriving it from the variable, and would otherwise keep its own smaller value and let
the divider draw over the first line of the very prompt it is announcing.

It never sets `padding-right`, `padding-left`, `width`, `max-width` or `margin-right`: an earlier
layout reserved a right-hand gutter for the time, and every line of every message wrapped earlier
for it, and the whole transcript grew taller to pay for a label that was supposed to cost nothing.
Narrowing the content is the one thing this rule must never do again, and `src/index.test.ts`
asserts that exact list is absent from the generated CSS.

## Testing

`src/index.test.ts` covers `gapName`, `markFor` and `styleRules` with no DOM at all.
`packages/harness/test/time-marks.test.ts` drives the actual built plugin against the real
2.1.270 webview bundle: a real transcript row, a real divider, and the real injected stylesheet.
