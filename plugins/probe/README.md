# probe

Prototype's own integration harness. It is loaded as an ordinary plugin — same manifest, same `ctx`,
same capability enforcement as any third-party plugin — so that "the probe passes" is proof the
host's plugin machinery works end to end, not a special case exempted from the rules it checks.

## What it checks

One named check per capability the manifest declares (anchors, classes via `cls`'s escape hatch is
not exercised here but `anchor` is, messages, rewrites, mount, style, tools, session, transcript),
plus checks read directly off `globalThis.__prototype.diagnostics` — pre/post hook timing, raw bus
counts, the buffer's seal state, every installed plugin's load status, rewrite bookkeeping, and the
React renderer hook the transcript capability rests on. The probe is the one plugin allowed to read
that global directly: it exists to diagnose the host, and none of it is something a manifest could
sanely declare.

Every check reports a verdict of `pass`, `fail` or `n/a`, plus a one-line detail, through a single
path so the badge's failing count and the panel's lines can never disagree. `n/a` is a real state,
not a lesser failure: it means a check cannot apply on this surface (the session list renders no
model pill and no transcript) or has had no opportunity yet (no session id has arrived, no tool has
run, no tab has been renamed).

## The badge

A small `GRO` badge sits beside the model pill in the composer footer on the full editor and the
sidebar, or fixed to the bottom-right corner on the session list, which has no composer. Green means
every check is `pass` or `n/a`; red means at least one is `fail`, with the failing count shown on
the badge and as its tooltip.

## The panel

Click the badge to open a small monospace panel, fixed to a corner, listing every check by name with
its verdict and detail. It re-renders once a second while open, and immediately whenever an event
changes a verdict. Close it by clicking the badge again, pressing Escape, or clicking outside the
panel.

## Reading a red badge

Every check names the thing that broke: `every plugin loaded` names the plugin and its refusal
reason; `rewrite chain composes in order` and `read taps see the app's original` catch a broken
rewrite chain; `React renderer injected` failing means the transcript capability is dead and every
check below it will read as having found nothing rather than explaining why. After an extension
update, the badge's colour alone answers "is anything broken", and the panel is there for when the
answer is yes.
