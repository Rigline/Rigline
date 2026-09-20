# Phase 6: a plugin contributes its own diagnostics

The working doc for [phase 6](plan.md). It settles the fork that phase opens with, the three
questions the plan left to it, and what moves where. Anything that survives the phase is promoted
to [decisions.md](decisions.md) and the internals docs; this file condenses to `history-m6.md` when
the phase closes.

Nothing here is built yet. The fork wants agreement first.

## The fork: does the host hand a check any state?

The plan's recommendation is a closure the host hands nothing — `ctx.check(name, fn)`, `fn` taking
no arguments and returning a verdict and a line of detail — and therefore no `uses` key. Taken, and
the reason is sharper than "a plugin already knows whether it is working".

A declaration exists to be checked against the identifier tables. That is what `gaps` is, it is what
`capabilityViolation` asks before injecting and before importing, and it is why a declaration can
refuse a plugin by name. A check names no identifier. Whatever it reaches for, it reaches for
through a `ctx` that was already scoped when it was built, so a `uses.checks` key could never
produce a gap and would only ever answer yes. A key whose validation is a constant is not a
declaration; it is a label, and the manifest is not where labels go.

The one thing a declaration would buy is a line in `rigline list`, so somebody can tell before
installing whether a plugin will appear in the panel. Not owed. `describeUses` says what a plugin
reaches into the app for, which is the thing worth reading before you trust it; whether it also
reports on itself is answered by opening the panel, which is where you were going anyway.

### The asymmetry, stated so nobody unifies it later

There are two contributors and they cannot share a path. A plugin contributes through `ctx`, and
gets nothing. A capability module contributes through the kernel, and gets the `Kernel` — because
that is what a capability module is for, and its check is a reading of state it already owns. The
mount module's check is a sentence about `diagnostics.mounts`, which it writes.

That is not an exception to the fork's answer; it is the fork's answer applied twice. What a
contributor is handed follows from where it sits in the trust model. Host code is inside, and
already reaches everything. A plugin is outside, and a check is not the thing that changes that.

### `ctx.check` is undeclared, like `ctx.surface`

`surface` is on every `ctx` without a declaration because knowing which surface you are on grants
nothing. `check` joins it, and is the first undeclared member that does something rather than being
a value. The rule that keeps the precedent honest, and that a later undeclared member must also
satisfy: **an undeclared member may not widen what a plugin can reach.** `check` hands the host a
function; it takes nothing back.

    check(name: string, run: () => CheckVerdict): Teardown;

    interface CheckVerdict {
      readonly verdict: "pass" | "fail" | "n/a";
      readonly detail?: string;
    }

`Teardown` for consistency with everything else on `ctx`, and so the kernel's `own()` retires a
plugin's checks when it is disabled — a disabled plugin's self-report is exactly the thing not to
keep showing.

## Question 1: when the host runs a check

**Pull, on the renderer's cadence, which is the probe's existing one second.** The host owns the
registry and runs every check; the renderer decides when to ask. `ctx.check` registers a function
and nothing else; there is no `report()` a plugin must remember to call.

The probe today is a hybrid — event-driven `report()` for what changes on an event, a one-second
poll for what only diagnostics know — and the pull half is the half worth keeping. Push makes a
plugin responsible for a lifecycle: register a check, then remember to report after every state
change that could alter its verdict. Forgetting one leaves a line that is stale rather than absent,
which is the failure P8 refuses, and it is invisible precisely because a stale `pass` looks like a
fresh one. Pull cannot be stale: the verdict is computed at the moment it is read.

It also puts the cost where somebody can see it. Under push a plugin reporting from a message
handler does work on every message forever; under pull it does work when the panel asks.

Two things follow.

**A check reads; it does not compute.** One second, for the life of the window, whether or not
anybody has opened the panel — because the badge's failing count is always on screen, and a count
that is only fresh while you are looking at it is worse than no count. So the cadence cannot be
narrowed to panel-open, and the rule has to hold on the other side: a check reads bookkeeping the
plugin already keeps. A check that wants to walk the transcript caches its own answer, which it can,
because its own state is in scope — that is the same premise the closure shape rests on. This goes
in [authoring.md](authoring.md) beside "a rewriter is synchronous".

**The seeded order and the "no data yet" state both retire.** The probe seeds `ORDER` up front so
panel line order never depends on which event fires first; under pull, order is registration order,
which is already deterministic. A check with nothing to say returns `n/a` with its own reason,
rather than sitting on a placeholder the host wrote for it.

The registry is a kernel service alongside mounts, session, tools and transcript, published on the
bridge next to `diagnostics` rather than inside it — `diagnostics` is data, and the recorder
serialises it.

## Question 2: what a throwing check does

**The check fails, with the throw's message as its detail, attributed to the contributor. The plugin
stays loaded.** This is the one plugin callback the host calls that is not wrapped in `guard`, and
it needs saying out loud, because otherwise it reads as an oversight.

`guard` exists because a plugin callback that throws inside the app's message flow or a React commit
has demonstrated that the plugin is broken at its job, and left the host in a state nobody can
reason about. A check that throws has demonstrated that the *diagnostic* is broken. Disabling the
plugin for it would tear down a working feature on the evidence of a broken sentence about that
feature — and the disable is itself a failure the panel then reports, so one bug in the least
important code a plugin has produces two red lines and no feature. That inverts "absent beats
wrong": the working thing goes absent and the wrong thing is what caused it.

Fail is loud and attributable, which is all P8 asks, and it is proportionate.

Three consequences to settle with it.

- **A malformed return is a throw.** Not one of the three verdicts, or not an object: report `fail`
  and say what came back. Same principle — the contributor's mistake, reported, not executed around.
- **Nothing goes into `diagnostics.errors`.** That list feeds core's *no host errors* check, so
  pushing a throwing check into it would render one fault as two failing lines, one of which names
  the wrong layer. The check's own line is the whole report.
- **A check that never returns is not contained**, and cannot be: it is synchronous, and a plugin
  can hang the panel from `setup` or any handler already. Named here so the shape is not mistaken
  for a sandbox.

## Question 3: how the panel orders contributors

**`core` first, then plugins in registry order; within a contributor, registration order.** Group
headers, with `(n failing)` appearing only when n is not zero.

    core
      PASS  pre hook ran before render — #root kids 0 -> 1
      PASS  tables loaded — 2.1.270
      N/A   tools: calls observed — no tool calls yet

    time-marks  (1 failing)
      FAIL  marks are being placed — 14 rows, 0 decorated after 8s

    probe
      PASS  read taps see the app's original — clean

Registry order because the codebase already has exactly one answer to "in what order" — it is how
mounts on a shared anchor are placed and how rewriters compose — and a second ordering rule is a
second thing to hold in your head for no gain.

`core` first because a host failure explains a plugin failure. Tables that did not load refuse every
plugin downstream; reading top-down gives cause before effect, and any order that puts the
consequence above the cause makes the panel argue against itself.

Both of the obvious alternatives lose to one property: the list must not move. Sorting failures to
the top reorders the panel as verdicts change, which slides a line out from under a pointer
mid-click and makes a report you are reading rearrange itself while you read it. Alphabetical is
stable but throws away cause-before-effect and buys nothing.

**`core` is flat, and the capability's name is part of the check's name** — `mount: re-placement`,
`transcript: rows identified and timed`. A group per capability module would be nine headers for
one-to-three lines each, and the prefix carries the same information in the space the header would
have taken. Revisit if `core` outgrows a screen.

## What moves

The probe keeps what is an experiment rather than a verdict: the checks that can only be answered by
registering something and observing what came back. Everything that is a reading of state the host
already holds moves to whoever holds it.

**To the kernel, under `core`:** pre-hook order, `acquireVsCodeApi` wrapped and called, bus traffic
in both directions, replay buffer sealed, tables loaded, every plugin loaded, no host errors, React
renderer injected, surface.

**To the capability modules, under `core`:** anchor resolution (`anchors`); tool calls observed
(`tools`); session id observed (`session`); rows identified and timed (`transcript`); stylesheets
present (`style`); and from `mount`, four — re-placement and `lost`, watched singletons matching one
element, registry order across every anchor carrying more than one mount, and every active watch
having found an element.

Three of those are generalisations rather than moves, and are better for it. *Mount survives
re-render* and *mounts sharing an anchor keep registry order* are, in the probe, assertions about
the probe's own badge and the one anchor it mounts against; the mount service knows every mount and
every anchor, so it can make the same assertion about all of them. *Stylesheet applied* is the same
shape: the style module knows what every plugin asked for.

**The probe keeps six:** read taps are immutable, the rewrite chain composes in order, read taps see
the app's original, its own rewrite bookkeeping, its own badge still mounted, and its transcript
decorator registered.

The last of those looks like it belongs to the transcript capability and does not. The probe
registers a decorator that draws nothing, and that registration is what keeps the transcript service
sweeping at all — so it is what makes the capability's own *rows identified and timed* check mean
anything on a panel where the plugin that actually draws on rows is switched off. The probe catches
the throw rather than letting it disable the panel, which makes the failure silent from every other
line: `entries` stays at zero, and zero rows is correctly not a fault.

It ends up one contributor among several, with `checks.ts` reduced to the verdict functions for
those five plus the report formatting, and the panel and badge — which are the probe's other job,
and stay its job.

## The first-party plugins contribute, through `ctx.check` and nothing else

The probe is a bad witness for whether the plugin-facing API is any good. It reads
`globalThis.__rigline` directly, which no other plugin may, so a `ctx.check` shaped to suit it would
be shaped to suit the one client that does not need it. session-id, time-marks and worktree-prefix
are the ordinary client, and they go through exactly the API a stranger's plugin goes through: their
own state, their own `ctx`, no diagnostics.

They are worth checking on their own account, because each has a characteristic failure that is
silent today — which is the whole of what this phase is for.

**session-id** — *badge mounted*, and *session id known*. The plugin's own distinction between
"mounted, waiting" and "never mounted" is already written into its placeholder, and the placeholder
is the only thing that currently says which. A check says it in words.

**time-marks** — *marks are being placed*: rows present, rows decorated. This is the one that
justifies the phase on its own. The plugin can be loaded, its toggle on, its stylesheet applied, its
`decorateTranscript` registered, and every row undecorated because the three-way join behind an
entry came apart — and today the panel says `time-marks loaded` and nothing else. `n/a` while the
toggle is off, and it says so, because a plugin the user has switched off is not a plugin that is
failing. Plus *toggle mounted*, its anchor being optional.

**worktree-prefix** — *prefix applied*: whether the rewrite has ever put a marker on a title, `n/a`
when it believes this session is in no worktree, with what it believes as the detail. Its silent
failure is the most complete of the three: its host patch is optional, so an update that stops the
patch applying costs it the list-sessions detection path with no refusal anywhere, and a session
that is genuinely not in a worktree looks identical to one whose detection has gone. The detail line
is what separates them.

The scaffold in `packages/create-plugin/template/` gets one check for the same reason: a plugin
should start with the habit, not acquire it after the first silent failure.

## Order of work

1. The check registry as a kernel service, the contributor grouping, and the kernel's own nine
   checks. The probe's panel renders groups and drops the nine lines it no longer owns, in the same
   step, so the panel is never missing a check.
2. The capability modules' checks, per module, likewise trading probe lines for `core` lines as each
   lands. The `CapabilityModule` interface grows one optional member; a module that contributes none
   is unchanged.
3. `ctx.check`, the probe reduced to its five, and the three first-party plugins contributing
   through it. They are the acceptance test for the step: if writing those seven checks is
   awkward, the API is wrong, and that is worth finding out before a stranger finds it out.

Modules before `ctx.check` because the plugin-facing API should be shaped against a mechanism that
already works, not co-designed with it.

## What this owes elsewhere, when it lands

- **decisions.md**: the fork's answer, the asymmetry, and the non-`guard` rule for a throwing check.
  D63 onward.
- **[host.md](host.md)**: the capability module contract grows a member; the diagnostics section
  gains the registry; the verification section stops pointing at this phase.
- **[verification.md](verification.md)**: the probe's tier-3 description, which currently describes
  a hand-maintained array.
- **[authoring.md](authoring.md)**: how a plugin writes a check, and *a check reads, it does not
  compute*.
- **`packages/create-plugin/template/`**: one check in the scaffold, so a plugin starts with the
  habit.
- **CHANGELOG.md**: `ctx.check` is a user-visible change to what a plugin can do.

## What the first live read found

Three faults, and they are two mistakes rather than three. Both were invisible to every tier below —
the harness boots a panel with fixture plugins and reads it once, and neither the boot instant nor
the session list is a thing it looks at.

**A check with no "not yet" state is a check that fails at boot.** The badge showed `RIG 3` for a
second before going green. The three were `mount: watches have found their element`,
session-id's *badge is mounted* and time-marks' *toggle is mounted* — all of them asking whether a
decoration is on screen, at an instant before the host had handed anybody an element. The probe's
own badge check did not flash, because it distinguishes *never mounted* from *mounted and gone*,
which is the distinction the other three lacked.

A badge that goes red and corrects itself is worse than one that stays grey. It teaches the reader
that red is noise, which is the same argument that makes a switched-off plugin `n/a` rather than
failing.

**The split is by who can answer, not by adding a timer to each.** Whether an anchor ever appeared is
the host's question — it owns the watch, and it has a clock. Whether a decoration that *was* handed
an element is still on screen is the plugin's. So `watchesFoundVerdict` gets a grace before it
fails, in one place, and the two plugin checks simply say `n/a` until the host has handed them
something. That also retires a duplication: a plugin asking "has my watch ever fired" was asking
core's question in a worse position to answer it.

**session-id had no business being on the session list.** Its whole output is a badge in the composer
footer, and the session list has no composer, so it loaded there to watch an anchor that never
appears and do nothing. Its manifest should have said `surfaces: ["editor", "sidebar"]`, as
time-marks' and worktree-prefix's do. That is the mechanism for *this works in a session window, not
in the session list*, and it already existed.

**But the host should not have needed the manifest to be right.** `ANCHORS` records the surfaces an
anchor renders on — `footerSpacer` has carried `surfaces: ["editor", "sidebar"]` since the table was
written — and `ctx.watch` ignored it. A watch for an anchor this surface does not have now watches
nothing and tears down cleanly, which is what an optional anchor this *extension* does not have
already did (D41). The two are the same answer to the plugin: there is nothing to mount on.

Only where the table says so. `surfaces` absent means *not yet measured*, not *no surfaces*, and
thirteen of the twenty-seven entries are still absent — reading absence as exclusion would silently
switch off every watch that depends on one.

## Open, and not blocking this phase

- **Whether a check may be `async`.** No, for now: pull at one second with an awaited verdict means
  a panel whose lines land at different times and a badge count that is briefly wrong. If something
  genuinely needs it, the answer is the same one the cadence rule gives — do the work elsewhere and
  have the check read the result.
- **Whether the panel should let a contributor be collapsed.** Not until `core` outgrows a screen.
- **Whether a check may ask for host state after all**, which the plan already routes correctly: it
  is a request for a capability, decided by name, the way `ctx.copy` would be.
