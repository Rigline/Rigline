# context-meter

How full the session's context is, at all times: a bar in the row under the composer's controls,
and a percentage in the composer footer.

## What it shows

- **The percentage the panel's own indicator shows**: tokens in context, against where Claude Code
  compacts on its own. The panel shows its indicator only once half the context is used, and only
  after a turn has finished in that panel; this shows from the moment a session opens.
- **Colour by how close that is**: green, then yellow from 63%, then red from 87%, where the panel's
  own indicator changes its glyph. The colours are VS Code's chart colours, which follow the theme.
- **A dimmed `–%`** while there is nothing to show: before the first reading, and after a compaction
  until the next one. Hover for which.
- With auto-compact switched off, the percentage is of the whole window, and the tooltip says so.

Both are elements, so either can be moved or switched off from Rigline's menu or with `rigline
layout`. The bar belongs in `rigRow`; the percentage also fits there.

## When it changes

Once per call Claude Code makes to the model: when the call starts, which counts the whole prompt,
and when it ends, which adds the reply. A tool's output is counted at the next call, so a long tool
shows up a moment after it finishes. In a remote window the start of a call is not reported, and
the count moves when each reply arrives.

## What it depends on

- **`context: true`** (required): `ctx.onContextUsage`, which the host derives from the
  conversation stream and from asking Claude Code. How, and when it asks, is D121 in
  `docs/decisions.md`.
