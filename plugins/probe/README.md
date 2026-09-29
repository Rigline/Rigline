# probe

Rigline's diagnostics, under *Diagnostics* in Rigline's menu — the menu behind the `RIG` pill. It is
loaded as an ordinary plugin, with the same manifest, `ctx` and capability enforcement as any other,
so its own checks passing is evidence that the host's plugin machinery works end to end rather than
a special case exempted from the rules it checks.

## What it shows

Every contributor's checks, grouped: the host's own under `rigline` — the kernel and each capability
module — then each plugin under its name, so the report reads as which part is broken rather than as
one list. Each line is `pass`, `fail` or `n/a` with a one-line detail. `n/a` is a real state, not a
lesser failure: a check that cannot apply on this surface, or has had no chance to yet — no session,
no tool run, no tab renamed.

The failing count on the `RIG` pill is the host's, read from the same registry, so the pill and the
menu cannot disagree.

*Copy report* puts a report on the clipboard for a bug report: the extension and engine versions,
the checks, the load status of every plugin, the host's counters and peaks, and the previous run's
tail. `rigline doctor` is its other half, the install state read from disk.

## What it checks itself

The few things nothing else is placed to check, because they mean doing something to the bus and
looking at what came back:

- **read taps are immutable** — a tap is handed a frozen payload.
- **rewrite chain composes in order** — two rewriters on `rename_tab`, the second seeing the first's
  change, with nothing left on the wire.
- **read taps see the app's original** — a tap never sees another plugin's rewrite.
- **rewrite bookkeeping** — the host's record of those rewrites agrees.
- **transcript decorator registered** — a decorator that draws nothing, which keeps rows being
  identified and timed so the host's transcript check means something on a panel with no other.

It requires nothing of Claude Code: the messages, the rewrite and the transcript are optional, so an
update that moves one leaves the diagnostics up and the check that needed it reading `n/a`.

## Reading a failure

Every check names what broke. `every plugin loaded`, under `rigline`, names each plugin refused and
why. A rewrite check failing means the outbound chain is broken for every plugin that rewrites.
`React renderer injected` failing means the transcript capability is dead, and every check that
reads rows will say it found nothing rather than why.
