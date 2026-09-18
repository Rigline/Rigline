# __NAME__

__DESCRIPTION__

## Depends on

- `uses.anchors: ["footerSpacer"]` — the flexible gap dividing the composer footer's left cluster
  from its right, and the anchor every footer decoration uses. The footer measures the widths of its
  own element children to pick a fit stage; the spacer renders in every stage, so a decoration
  beside it contributes a constant width and the measurement settles.
- `uses.mount` — `ctx.watch` and `ctx.mountBefore`, which place the badge and keep it placed across
  a re-render.
- `uses.style` — one stylesheet, scoped to the class this plugin puts on its own element.
- `uses.tools` — `ctx.onToolUse`, every completed tool call the assistant makes.

## Notes

`badgeText` is exported and tested because it is the half a plain test run can hold. Everything
else is a question about the app, and only the app can answer it.
