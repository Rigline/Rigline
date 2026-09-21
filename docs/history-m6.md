# Phase 6: a plugin contributes its own diagnostics

Archaeology for the phase that made a diagnostic check a thing anybody can contribute. Built
2026-09-20, closed on a live read 2026-09-21.

The argument is [decisions.md](decisions.md) D63 to D68; the reference is [host.md](host.md) for the
registry and the module contract, [verification.md](verification.md) for where the tier sits, and
[authoring.md](authoring.md) for writing one. Nothing here is load-bearing — it is what the phase
turned on and what it cost, for whoever wonders why the shape is this shape.

## The fork it opened on

*Does the host hand a check any state?* Answering it settled both halves — whether a check is
declared in the manifest, and what it may reach.

It does not. `ctx.check(name, run)` is a closure taking nothing, and declares nothing, because a
declaration exists to be checked against the identifier tables: a check names no identifier, so a
`uses.checks` key could never produce a gap and would only ever answer yes. The plan had argued this
from "a plugin already knows whether it is working"; the load-bearing version is narrower and is
what D63 records.

The asymmetry that fell out and is not to be unified: a capability module contributes through the
kernel and is handed the `Kernel`, because it is host code reading state it already owns. What a
contributor is handed follows from where it sits in the trust model.

## The three questions the phase section left open

**When the host runs a check** — pull, on the renderer's cadence (D64). No `report()` anybody must
remember to call, so a verdict cannot go stale, and a stale `pass` is indistinguishable from a fresh
one. The cost lands on the contributor as *a check reads, it does not compute*.

**What a throwing one does** — fails its own line, plugin stays loaded (D65). The one plugin callback
the host calls without `guard`, because a broken sentence about a feature is not evidence against the
feature.

**How the panel orders contributors** — `core` first, then registry order, fixed rather than derived
from the verdicts (D66). Sorting failures to the top would rearrange a report while somebody reads it.

## What moved

Nine lines to the kernel, nine to the capability modules, six left in the probe — the ones that are
an experiment rather than a reading, which nothing else is in a position to run.

Three of the moves were generalisations rather than transplants, and are better for it. *Mount
survives re-render* and *mounts keep registry order* were assertions about the probe's own badge and
its one anchor; the mount service knows every mount, and `positioned` is its own predicate for where
a node belongs, so one check replaced both and covers all of them. *Stylesheet applied* became every
sheet every plugin asked for.

The probe's `ORDER` array and its "no data yet" placeholder both retired: under pull, order is
registration order and a check with nothing to say returns `n/a` with its own reason.

## The first-party plugins as the acceptance test

session-id, time-marks and worktree-prefix went through `ctx.check` exactly as a stranger's plugin
would — the probe is a bad witness, since it reads `globalThis.__rigline` directly and no other
plugin may. Each turned out to have a failure that was silent, which is the whole of what the phase
was for.

time-marks is the one that justified it: loaded, toggled on, stylesheet applied, decorator
registered, every row undecorated because the three-way join came apart — and the panel would have
said `time-marks loaded` and nothing else.

Writing those seven checks is also what found the duplication: two of them were core's question asked
from a worse position. session-id's real check is the *messaging address*, not the session id, because
the id comes from the host and the address is its own bounded regex over someone else's wording.

## What the live reads found that a green suite had not

Three faults across two reads, none visible to any tier below — the harness boots a panel with
fixture plugins and reads it once, and neither the boot instant nor the session list was a thing it
looked at.

- **A check with no "not yet" state fails at boot.** `RIG 3` for a second, then green. The split is by
  who can answer: whether an anchor *ever* appeared is the host's question, since it owns the watch
  and has a clock, so it waits; a plugin's check says `n/a` until it is handed something (D67).
- **session-id had claimed all three surfaces** for an output that is entirely a composer-footer
  badge. Its manifest now says so — but the host should not have needed the manifest to be right, and
  `ctx.watch` now reads the `surfaces` the anchor table has recorded since it was written (D68).
- **A green session list was still sweeping.** 27/s, roughly one per React commit, hunting transcript
  rows on a surface whose row anchor is measured as editor and sidebar. `decorateTranscript` reads
  its anchor the same way now. The tell worth keeping: the check two lines above already said *the
  session list renders no transcript* while the machinery ran anyway — a correct `n/a` describes what
  a capability found, not what it was doing to find it.

## The two numbers the plan had been holding

Read on 2.1.278, across both surfaces, and both are settled.

`replaced` 0, `moved` 0, `lost` 0, over 328 active mounts and 144,548 commits, with `multiple` and
`abandoned` empty. **This did not retire `replaceLost`, and the rule that said it would was wrong** —
zero is the absence of the trigger, not of the need. Nothing detached because nothing moved, the
provoking conditions are session-specific, and a transcript row React rebuilds takes its anchor with
it so the mount is skipped rather than counted.

The sweep meter peaked at 6/s on the editor with 326 entries, sustained near 2/s. Not hot;
`querySelectorAll` stays.

## Left open

- Whether a check may be `async`. No, for now: an awaited verdict means lines landing at different
  times and a badge count briefly wrong.
- Whether the panel should let a contributor be collapsed. Not until `core` outgrows a screen.
- Whether a check may ask for host state after all. That is a request for a capability, decided by
  name, the way `ctx.copy` would be.
