# __NAME__

__DESCRIPTION__

## Depends on

- `uses.tools` — `ctx.onToolUse`, every completed tool call the assistant makes.

## Contributes

- `elements.badge` — the tool-call count, before `footerSpacer` by default: the flexible gap
  dividing the composer footer's left cluster from its right, and the place footer elements go. The
  footer measures the widths of its own element children to pick a fit stage; the spacer renders in
  every stage, so an element beside it contributes a constant width and the measurement settles. It
  may also go in `rigRow`, the row under the composer's controls.

## Notes

`badgeText` is exported and tested because it is the half a plain test run can hold. Everything
else is a question about the app, and only the app can answer it.
