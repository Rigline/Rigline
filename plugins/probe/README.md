# probe

Live self-tests of Rigline's plugin API. It is loaded as an ordinary plugin, with the same manifest,
`ctx` and capability enforcement as any other, so its checks passing is evidence that the host's
plugin machinery works end to end rather than a special case exempted from the rules it checks.

Its lines appear under its name in *Diagnostics*, in Rigline's menu behind the `RIG` pill, beside
every other contributor's. *Diagnostics* is Rigline's own and is there with the probe switched off;
switching it off takes away these lines and what they cost the panel, and nothing else.

## What it checks

The few things nothing else is placed to check, because they mean doing something to the bus and
looking at what came back:

- **read taps are immutable** — a tap is handed a frozen payload.
- **rewrite chain composes in order** — two rewriters on `rename_tab`, the second seeing the first's
  change, with nothing left on the wire.
- **read taps see the app's original** — a tap never sees another plugin's rewrite.
- **transcript decorator registered** — a decorator that draws nothing, which keeps rows being
  identified and timed so the host's transcript check means something on a panel with no other.

It requires nothing of Claude Code: the messages, the rewrite and the transcript are optional, so an
update that moves one leaves the probe loaded and the check that needed it reading `n/a`.

## What it costs

A copy of every `request` message for its tap, two rewriters on every `rename_tab`, and, where the
panel has transcript rows, a sweep of them on every render for its decorator. `rigline disable
probe` is the way to shed them.

## Reading a failure

A rewrite check failing means the outbound chain is broken for every plugin that rewrites. The
immutability check failing means a tap can change what the next tap sees. The decorator check
failing means the transcript capability could not start, and every check that reads rows will say
it found nothing rather than why.
