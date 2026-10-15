# time-marks

Puts the clock time on every transcript entry — one per content block, the density the CLI
actually writes at, not one per assistant turn — at the top right of the row, where Claude Code
puts its own stamp. Where the conversation jumped a calendar day or paused ten minutes or more,
that entry gets a full-width divider instead: a lead ("Today", "Yesterday", a weekday and date, or
"3h 12m later") plus its own time. **Time markers** in Rigline's menu, behind the RIG pill, toggles
the whole feature; the choice persists in `localStorage`, and absence there means on — the feature
is why the plugin is installed.

Claude Code stamps user prompts and its own text replies itself, on by default
(`claudeCode.showMessageTimestamps`). On those rows its stamp is the one that stays — same instant,
your `timeFormat`, and the date on hover — and this plugin fills in what it leaves bare: tool calls,
thinking blocks, and the breaks. Switch its stamps off and every row gets one of these instead; no
setting here, and nothing to keep in step.

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
- `uses.optional.anchors: ["itemTime"]` — cosmetic: a borrowed style class that makes this
  plugin's time read like the app's own dimmed label; without it the time still renders, from
  inline styles alone.
- `uses.style`, required — injecting the one stylesheet rule.
- `uses.menu`, required — the Time markers toggle in Rigline's menu.

## The app-owned rules, and why

`styleRules(rowClass)` is the only place this plugin styles elements it did not create itself. Both
its rules are scoped to rows this plugin has put a node on, so both lapse the moment the decorator
is torn down — the toggle needs no cleanup of its own, and switching the markers off hands every row
straight back to Claude Code's stamp.

**The band.** A row showing a time of ours, and any row with a divider, gets
`--message-padding-top: 24px` — the app's own handle on the row's padding, the timeline dot's offset
and the content's position together — plus a literal `padding-top`, because a sticky-header row sets
its padding outright rather than deriving it, and would otherwise let a divider draw over the first
line of the very prompt it announces. A row Claude Code has stamped is excluded: it has reserved the
same 24px itself where it needs it, and where it has not, our time there is hidden anyway.

**The dedupe.** On a row carrying Claude Code's own stamp, our clock time is set
`visibility: hidden` — never `display: none`, because the span's box is what makes a divider's rule
stop exactly where the stamp begins, with no width for anyone to maintain. Hidden that way it is out
of a search, a selection and the accessibility tree alike. Nothing in the harvest watches the
attribute this keys on, so the plugin contributes a check that says so if it ever changes: *Claude
Code's own time is not doubled*.

Neither rule sets `padding-right`, `padding-left`, `width`, `max-width` or `margin-right`: an
earlier layout reserved a right-hand gutter for the time, and every line of every message wrapped
earlier for it, and the whole transcript grew taller to pay for a label that was supposed to cost
nothing. Narrowing the content is the one thing these rules must never do, and `src/index.test.ts`
asserts that exact list is absent from the generated CSS.

## Testing

`src/index.test.ts` covers `gapName`, `markFor` and `styleRules` with no DOM at all.
`packages/harness/test/time-marks.test.ts` drives the actual built plugin against the real
webview bundle the harness is pinned to, `HARNESS_VERSION` in `packages/harness/src/suite.ts`: a
real transcript row, a real divider, and the real injected stylesheet. It runs both halves of the
dedupe, through the fake host's `showMessageTimestamps` — with Claude Code stamping, our time
computes hidden and keeps its box; without, it computes visible and the row carries our band.
