# M8: the companion extension — the update stops reverting

The working document for the milestone that stops an extension update silently undoing Rigline.
Durable rules live in [decisions.md](decisions.md); this file owns the shape, the phases and their
acceptance criteria, and it supersedes "Phase 5, later" in [plan.md](plan.md).

## The problem

Claude Code updates about weekly. VS Code installs a fresh versioned directory, deletes the old one,
and nothing tells a process outside the extension host. The new directory has none of our bytes in
it, so on the next window reload the loader is gone: no badge, no plugins, no error. Everything
looks fine and nothing of ours is there.

That is the last silent failure in the project, and it is the one P8 was written about. Every other
layer got its loud failure — a refused anchor names itself, a plugin's throw names the plugin, a
stale payload is stamped with the engine that wrote it (D75). This one recurs weekly, is invisible
by construction, and is noticed only when the user happens to look for a feature.

**The fix already exists and nobody is running it.** `rigline watch` polls the extensions directory,
notices the set of installed directories changing, re-runs the flow and re-injects. Core's
`update/watch.ts` is built and tested. What is missing is not capability — it is a process that is
running when the update lands, which today means a terminal somebody remembered to leave open.

The companion extension is that process, hosted by the one program that is definitely running when
VS Code updates a VS Code extension.

## The fork everything derives from: the companion is a second retrieval layer

Settled with Leo, 2026-09-21. The companion is what `rigline` is, in a different shell: acquisition,
not engine. It installs and updates `@rigline/core` under `<RIGLINE_HOME>/engine` over npm, and runs
that engine to do every piece of work. It is a peer of the `rigline` package, not a client of it.

The alternative was a VSIX that embeds `@rigline/core` and injects from inside the extension host.
Core is a library and exports everything needed, so it would have worked and been shorter. It is
wrong for D69's reason, one layer up: a VSIX carrying its own copy puts a second engine on the
machine, `rigline update` can move only one of them, and the injection on disk then depends on which
engine last ran. D75 exists because a stale payload is indistinguishable from a current one by
looking at it; embedding core manufactures exactly that condition, weekly, with two candidates and
no way to tell which wrote what.

One engine owns bytes. Everything else acquires it.

**This is what repairs D76's weakest point.** Sideloading's known cost is that VS Code does not
auto-update a VSIX installed by hand. If the companion is a retrieval layer, that stops mattering:
the shell is stable and the engine moves underneath it, so the VSIX needs republishing only when the
*scheduling* changes, which is close to never. A user gets new engine behaviour, new anchor tables
and updated plugins without the VSIX moving at all — the same bargain `rigline` already makes, and
the reason not being on a marketplace costs so little.

Three more things fall out:

- **The companion cannot disagree with the CLI**, because they drive the same program. `rigline
  check` from a terminal describes exactly what the companion would do.
- **The VSIX stays genuinely thin** — activation, a watcher, an acquisition step, a prompt, a status
  item. No harvest, no anchor table, no payload, nothing version-derived.
- **It works without the `rigline` package.** The VSIX is a complete Rigline for somebody who never
  opens a terminal, which is a better story than "install the CLI first, then the extension."

The earlier draft of this document had the companion refuse when no engine was present, on the
grounds that an extension quietly fetching code from npm is what a reviewer would object to. That is
withdrawn. It is the same act `rigline` performs on first run, by a user who installed a VSIX called
Rigline and can read what it says it does; and refusing would mean the companion could not be the
thing that keeps an install current, which is the whole of its job. It says what it is fetching and
reports the result — loud, not silent (P8) — rather than declining to fetch.

Two costs this shape creates, both real and neither fatal. They are the next two sections.

## Cost one: there is no npm beside the extension host

`findNpmCli` locates npm beside the running Node and deliberately never takes the shim on `PATH`,
because under corepack, volta or fnm that shim is not necessarily the npm belonging to this Node
(D73). In the extension host `process.execPath` is VS Code's Electron binary. There is no
`node_modules/npm` beside `Code.exe` and no `../lib/node_modules/npm` either, so the wrapper's
function finds nothing and would refuse every time.

**D73's rule survives; what changes is where the pairing starts.** The rule is that npm must belong
to the Node that will run it — not that `PATH` is untouchable. The wrapper starts from the Node it
is already running and needs no search. The companion is not running a Node at all, so it has to
find one first, and then take the npm beside *that*, which preserves the pairing rather than
breaking it.

So: resolve `node` on `PATH`, then `findNpmCli` against the resolved path, unchanged. A setting
overrides the choice for anybody whose Node is somewhere a VS Code process does not see — which is
common enough on macOS, where a GUI-launched application inherits a login shell's `PATH` only
sometimes. Absent both, the companion refuses by name, says it could not find Node, and prints the
one command that does the job from a terminal. That refusal is fine because it is loud and
actionable; the withdrawn one was not, because it had no repair a user could reach.

`ELECTRON_RUN_AS_NODE=1` makes VS Code's own binary behave as Node and is tempting as a fallback. It
does not help: it supplies an interpreter, not an npm, and the npm it would then run is whichever
one we found anyway. Recorded so it is not re-proposed.

## Cost two: two retrieval layers, one directory

`rigline update` from a terminal and the companion both write `<RIGLINE_HOME>/engine`. They can run
at once — a user running the CLI while the extension is mid-update is not a corner case, it is
Tuesday.

**Settled and built.** `withHomeLock` in [lock.ts](../packages/cli/src/lock.ts) takes
`<RIGLINE_HOME>/.lock` by exclusive create, which is atomic on both platforms and needs no
dependency. The holder's pid, start time and name go in the file, so a waiter can say who it is
waiting for and a person deciding whether to delete it can read it. A lock whose process is gone
*and* whose age is past is taken; a young one is not, because a process that has not yet written its
pid must not be robbed. A stealer unlinks and races for the exclusive create like everybody else, so
two stealers still produce one winner.

**It wraps `installEngine`, not a command.** That is the one act two processes must not interleave,
and every verb can reach it — a first run installs an engine whatever was typed, so a lock around
`update` alone would leave `list` racing it. The lock is held *across* the npm run rather than
around its setup, which is the property the test asserts.

The whole home rather than the engine directory, because `update` moves plugins in the same run and
those collide the same way. The **injection** half is deliberately outside: rebuild-from-backup is
idempotent, so two processes injecting write the same bytes, and holding a lock across the slow half
would serialise it for nothing.

A contended lock **reports rather than throws**, because `updateEngine`'s existing contract already
answers with an outcome and a reason. That turns out to be exactly right for the companion, which
runs unattended and needs a thing to say rather than something to crash on.

Still open, and mild: plugin-level races. `add` and `updatePlugins` write `<RIGLINE_HOME>/plugins`
through the engine, and two engines writing *different* plugin directories is not the corruption
case above. Left until it bites rather than solved speculatively.

## Sharing the acquisition code, not copying it a third time

D69 accepted duplication between `rigline` and core — `UserError` and the `$RIGLINE_HOME` rule as
two files with a test holding them together — as the price of the wrapper declaring no Rigline
dependency. A third copy in the companion is where that price stops being worth paying.

**Settled: the companion takes `rigline` as a `workspace:*` dependency and bundles its acquisition
module.** `packages/vscode` is private and bundled, exactly as `@rigline/host` is, so a workspace
dependency is inlined at build time and nothing has to resolve at runtime.

What decided it is a constraint that only shows up once the packaging is looked at rather than
reasoned about. `rigline` publishes **unbundled** tsc output with `files: ["dist"]`, so it cannot
consume a private workspace package — that is the `@rigline/host` trap m7 opens with, where
`node_modules/host/dist` does not exist in a published install. So "move acquisition into a small
package both consume" costs either a fifth published package, with its own manifest, trusted
publisher and CI rung, or a change to how `rigline` builds. Neither is worth it for one consumer,
and the second is m7's territory reopened mid-milestone.

The companion has no such constraint, because it bundles. So the sharing goes one way: the thing
that bundles imports from the thing that does not.

`rigline` gains a narrow `exports` map — one subpath for the acquisition module, nothing else.
Adding `exports` to a package that has none *narrows* rather than widens: every other subpath becomes
inaccessible, which is the right direction and is why this does not contradict D69. D69 forbids a
*project* taking `rigline` as a dependency to get its bin, and the README still says so; a sibling in
the same repository importing one module to avoid a third copy of `findNpmCli` is not that.

The cost, stated so it is not a surprise: the VSIX carries a snapshot of acquisition logic and can
only update it by republishing. That is not a flaw in the choice — it is D69's own physics, since
acquisition is exactly the layer that cannot update itself. It is also why acquisition is the one
part of Rigline that should stay small enough to be worth freezing.

## What the companion does

**Watches.** `extensions.onDidChange` is the fast path, and the existing poll is the floor. That
event fires when the installed set changes and is documented for install, uninstall, enable and
disable — but it carries no payload, names no extension, and its issue history is a record of it not
firing in cases the documentation claims. So it is treated as a hint that shortens the latency, never
as the signal. A hook that silently does not fire is the failure mode this milestone exists to
remove; it does not get to be the thing we depend on.

**Knows which directory, authoritatively.** `extensions.getExtension("anthropic.claude-code")` hands
back `extensionUri`, which is VS Code stating where it put the thing. The CLI has to scan and infer.
This is the one piece of information the companion has that the engine cannot get for itself, and it
is worth passing down rather than letting the engine re-derive.

**Re-injects, by spawning the engine.** No new logic. The flow, the report and the refusals are the
ones `rigline install` already produces.

**Offers a reload, and never takes one.** In the common case none is needed: the patch lands on disk
while the old extension is still live in memory, so the reload the user was going to do anyway comes
up patched, and the correct behaviour is silence. A prompt is earned only when the new extension is
already loaded — VS Code restarted the extension host, or the user reloaded before we finished. Then
`workbench.action.webview.reloadWebviewAction` is a registered command that reloads live webviews
without a window reload. **Offer it; never fire it unasked.** Reloading webviews ends the in-flight
turn of every Claude session in the window, and a background process that silently kills somebody's
running turn to fix its own cosmetics has misunderstood which of the two matters.

A changed `extension.js` is different: a host patch needs a window reload and cannot be resolved by
reloading webviews. That prompt says so, and stays dismissible.

**Says what it did, quietly.** Failures are loud, success is silent. A status item reflects the last
flow's verdict; anything in `attention` is a notification naming what needs a person.

**Built 2026-09-23 (D85) — quiet is not the same as invisible.** Live read: Leo waited
for the status item to say a newly landed Claude Code version was patched, saw nothing, and accepted
VS Code's own "Restart Extensions" prompt before the companion had actually finished. That produced
the window-reload offer below — working as designed, since 8b already names "the user reloaded before
we finished" as one of the two triggers for it — but there was no way to tell in advance that waiting
a little longer would have avoided needing it. A `moved` reaction's success reverts the status item to
the same `ok` icon and text a window with nothing new to do ever shows, so "it already happened" and
"still waiting" look identical unless you catch the `working` spinner mid-flight.

The fix stays inside "quiet, not silent": no notification, `attention` keeps the only interrupt. A
`moved` reaction that actually changed bytes (`reason.arriving.length > 0`) lands the status item on a
new `ready` health instead of reverting to `ok`, so it stays visibly different from steady state and a
glance answers "has it caught up yet" without requiring you to have watched the transition happen. A
`moved` that changed nothing (a directory only went away) or a `start` that finds nothing changed still
lands on plain `ok` — there is genuinely nothing new to flag there. No command on click, the same as
`ok`/`idle`/`attention`: there is no outstanding offer behind it to re-show, only information. It
clears itself the ordinary way — the next real activation (an actual restart) runs the flow fresh and
leaves it wherever that run's own result puts it.

Built same-day, in [acquire.ts](../packages/vscode/src/acquire.ts): the discriminator is
`reason.kind === "moved" && reason.arriving.length > 0`, checked once, at the same place the plain
`ok` status was already being set.

**Never breaks the editor.** A companion that throws on activation is worse than no companion,
because it takes a working extension host down with it. Everything is inside a boundary that reports
and survives, on the same reasoning `watch.ts` already carries for a harvest that raced a
half-written directory.

## Installation, and the soft spot

Two routes in, and neither is the other's prerequisite. `rigline` installs the VSIX and `rigline
update` moves it, for somebody who already has the CLI; the VSIX ships inside `@rigline/core`'s
`dist/bundled` the way the four first-party plugins do (D71), so there is no second fetch and no
second packaging decision. Equally, a person can install the VSIX alone and never type a command —
it acquires its own engine, so there is nothing to install first.

The second route is worth protecting. It is the one for a user who does not live in a terminal, and
the shape settled above is what makes it possible.

**Where `code` points depends on where you run it, and that is right rather than surprising.** Run
from WSL, the `code` on `PATH` is the Windows binary — and it installs into the *WSL remote*
extension host, `~/.vscode-server/extensions`, not into Windows. Which is what you want: a session
run from WSL has its extensions there. So one machine can hold two companions that never see each
other, and `vscode-setup` is per-environment rather than per-machine. Verified on 1.0.0-alpha.8;
`--remove` empties `extensions.json` and leaves the directory for VS Code to collect, so a directory
still sitting there is not a failed removal.

The mechanism is `code --install-extension <path>.vsix`, which needs the `code` CLI on `PATH`.
Reliable on Windows; on macOS it is a thing the user has to have added from the Command Palette. It
is also plural: a machine may have VS Code, Insiders, and forks, each with its own CLI and its own
extensions directory.

**The refusal is the answer, not a workaround.** Where no CLI is found, say so, name the one-line
Command Palette alternative, and print the VSIX path. What we will *not* do is write into
`~/.vscode/extensions` and register the extension ourselves: that is patching VS Code's own state to
install a patcher, which is a worse act than the one Rigline already commits and a considerably less
defensible one. Left as a refusal until somebody has a better idea.

## `rigline vscode-setup`

A command, not a file path. Somebody who has run `npm i -g rigline` already has the VSIX — it is in
the engine's `dist/bundled` beside the payload and the plugins (D71) — so installing the companion
is a verb, and asking a person to find a file on disk and type `code --install-extension` is a
worse answer to a question we can already answer for them.

    rigline vscode-setup            # install the companion into every VS Code found, and inject
    rigline vscode-setup --remove   # take it out again, leaving the injection alone

**It injects as well, so it is a step instead of `install` rather than after it.** That is `add`'s
rule (D55, D56): a command that changes what is installed re-injects, so the user is one reload away
rather than one reload and a command they have to know about. It matters more here than anywhere
else, because the companion injects on *activation* and activates only after the reload — by which
time the panel may already have rendered from an unpatched bundle. Without it the first reload is
the one that does not work, on the single path that exists so nobody has to think about reloading.

**None of which makes the companion required.** The verb `install` is untouched and remains the
whole of Rigline on its own; this milestone adds a second path for people who would rather not
remember, and D80 records that declining it has to keep costing nothing.

`--remove` deliberately does not restore. Taking the companion out is a statement about who drives
the injection, not about whether there should be one; `rigline restore` is the verb for that and
saying so is better than guessing.

**It goes in the engine, and the wrapper forwards it.** `rigline` holds no verb list (D69), so a
new engine verb reaches a user through an engine update with no wrapper release — which is that
decision paying for itself the first time it is asked to. The engine is also where it belongs on the
merits: it is the half that knows about installs and the half that carries `dist/bundled`.

Nothing is downloaded. The VSIX ships inside the engine, is the version that engine was built with,
and moves when the engine moves — so `rigline update` bringing a new engine brings a companion that
matches it, and the two cannot disagree about what they are.

**Every editor it can find, not one.** A machine may have VS Code, Insiders, VSCodium, Cursor and
Windsurf, each with its own CLI and its own extensions directory, and a user with two of them
running Claude Code wants the companion in both. So the command looks for each known CLI on `PATH`,
reports what it found, installs into each, and says which. Finding none is the refusal below rather
than a failure to work around.

`--force` is passed, so re-running is a no-op rather than a refusal about an already-installed
version, which matters because `rigline update` will want to call this.

## Reading 8a, on a machine that has never seen Rigline

    npm i -g rigline
    rigline vscode-setup

Then *Developer: Reload Window*, and watch the status bar and the **Rigline** output channel. On a
clean machine the sequence is: a Node found on `PATH`, `@rigline/core` fetched from npm into
`~/.rigline/engine`, `install` run, and the status item green.

**No release is needed to read 8a**, as long as the VSIX under test is the one built here: copy
`packages/vscode/rigline.vsix` across and `code --install-extension` it directly. The engine comes
from whatever `@rigline/core@latest` resolves to, which is a published version and not this
checkout's, and that asymmetry is the design rather than a compromise (D80) — the shell installs
once and the engine moves underneath it, so testing against the published engine tests the real
arrangement. What a release *would* add is `rigline vscode-setup` itself, since the published engine
does not carry it yet.

Two prerequisites that are not obvious. **Node must be on the machine**, because VS Code does not
ship one and the companion needs npm; where a GUI-launched VS Code cannot see it, `rigline.nodePath`
is the repair. And the first run **reaches the network**, which is the same cost `rigline` pays and
for the same reason (D73).

## Phases

### 8a: it re-injects, unattended

The whole of the value. A companion that acquires an engine, watches, spawns it, and re-injects —
with no UI beyond a status item and the failure notification.

**Done, and read live on 1.0.0-alpha.9** — `npm i -g rigline` then `rigline vscode-setup` on a
Windows laptop, installing the companion and injecting, with the extension activating afterwards.
That is 8a's acceptance.

Two bugs the live read found that no test could have, both worth knowing because both are the same
shape — the artefact was never exercised, only its source:

- **`spawn EINVAL` on Windows.** VS Code ships its CLI as `code.cmd`, and Node has refused to spawn a
  batch file directly since the BatBadBut fix. `vscode-setup` had therefore never worked on Windows
  at all. Every test injects `run`, so the spawn had no coverage; `editorSpawn` now routes a batch
  file through `cmd.exe` and is tested for its argv.
- **The bundle had never been loaded.** Not once, by anything. `test/activates.test.ts` now copies
  the built `extension.cjs` into a directory with a stubbed `vscode`, requires it as Node will, and
  calls `activate`.

A third was found by reading rather than running: `install` exits 0 when no Claude Code is installed,
so a companion installed *before* the extension read that as success and went green over nothing.
The companion asks the editor now instead of trusting an exit code.

The watcher serialises rather than debounces. An update produces a burst — the event, then a poll,
then often a second event as the old directory is deleted — and a reaction per signal would be an
npm install per signal, each queueing on the last one's lock. A run in flight marks itself and the
follower is dropped, which is safe precisely because the work is idempotent: the follower would only
discover what the leader already has.

It also **waits for the directory to stop moving** before reacting, which is D81 and is the price
the fast path pays. `settleWebviewBackup` makes unrelated live bytes the new pristine backup, so
reacting to a half-written bundle does not fail — it records a fragment as the thing `restore`
restores. Sizes and modification times are sampled two seconds apart and must agree; a directory
that never settles is left to the next poll, and the move stays outstanding so that poll retries
it.

The package is shaped so the untestable part stays one file. `extension.ts` is the only module that
imports `vscode`; it adapts the editor to `Editor` and calls into logic that has never heard of an
editor. Everything else is ordinary TypeScript with injected dependencies, which is how a milestone
whose acceptance is a live read still has 19 tests behind it.

Two packaging facts worth not rediscovering. The bundle is **CommonJS** though the source is
modules: VS Code's support for an ESM `main` is recent and conditional, and a sideloaded extension
that fails to load is simply absent rather than diagnosed, which is the failure this milestone is
against. And the extension manifest is **generated into `dist/`** rather than being this package's
own `package.json`, because a VS Code `name` must be unqualified and `rigline` is already the
workspace's CLI — so the version is derived from the workspace manifest and cannot drift from it.

Acceptance: **on a machine with no Rigline at all**, install the VSIX alone, and it fetches the
engine, injects, and says so. Then install Claude Code over itself with the companion running, reload
the window, and Rigline is still there. Confirmed by reading, live, on a real update rather than a
simulated one — the same bar phase 6 was held to, and for the same reason: every green harness in
this project has at some point described a thing that was not happening.

Also acceptance: with no Node findable, the companion refuses by name, says what it looked for, names
the setting that overrides it, and leaves the extension host otherwise unaffected. And `rigline
update` run from a terminal while the companion is updating leaves one good engine directory, not a
half-written one.

### 8b: the reload, offered

The prompt for the case where the patch lost the race, with the webview reload and the window reload
as separate offers because they are separate needs. Nothing fires unasked.

Acceptance: a forced extension-host restart mid-update produces the offer; accepting it restores the
decorations without a window reload; dismissing it leaves a session's in-flight turn untouched.

**Built, and most of the acceptance read live on 1.0.0-alpha.9.** A window came up over an unpatched
extension and the webview offer appeared; taking it put the decorations back without a window
reload, and declining it took no reload and left the offer on the status bar. The window-reload variant is read too, over a host
patch, with the status on `needs you` as an older engine's exit code makes it.

**The silence on a real replacement is read too, and 8b's acceptance is complete.** Installing a
version whose directory was not already on the machine, under a running window, produced the
`installed:` line, a settle, an injection into the arriving directory, and no notification.
Reaching it needs both of those conditions — a version already present reuses its path, and
`--install-extension` without `--profile` lands in the default profile, which a window on another
profile never sees. Get either wrong and nothing moves, so nothing fires: a silence that looks
exactly like the one being tested for and means nothing at all.

**Triggering it does not need an update to land.** The offer turns on this host having come up over
an unpatched directory, and `restore` followed by *Developer: Reload Window* produces exactly that,
deterministically and in seconds. A forced *Restart Extension Host* mid-update is the same state
arrived at the hard way. Which of the two offers appears is decided by whether a plugin patches
`extension.js`, so `disable worktree-prefix` first for the webview one and `enable` it for the
window one — with it on, an install from vanilla always changes the host and the webview offer is
unreachable.

The engine the companion runs is a released one and so lags this checkout by up to a day (D48).
That is the arrangement to read against rather than a problem to fix (D80), and the reload decision
is taken from the bytes precisely so it holds against an engine that predates it.

#### The discriminator, which everything else derives from

An offer that fires weekly is worth nothing. In the ordinary update the patch lands on disk while
the window is still running the *old* extension directory, so the thing the companion just reacted
to changes nothing about the window it runs in: the webview in front of the user came from the old
directory and is already patched. Reloading it would cost a turn and buy nothing. Silence is the
correct behaviour, and an offer that cannot tell silence from the rare case is a weekly prompt to
kill your own session.

**The companion already holds the fact that separates them, in `WatchReason`.** A reaction is either
`start` — this extension host has just come up, and Claude Code is wherever it already was — or
`moved`, meaning the directory changed *while this host was running*, which is possible only if this
host is running the other one. So:

- `moved` is never an offer. The directory just patched is not the directory this window loaded.
- `start` may be, because the directory just patched is exactly the one this window loaded, and it
  was loaded before we patched it.

A forced extension-host restart mid-update is a new `start` over a directory VS Code has already
replaced and we have not yet patched. The acceptance criterion falls out of the discriminator rather
than being handled beside it.

#### What moved, told by the bytes rather than by the engine

`start` narrows it to a window that *might* be stale; whether it is depends on whether the patch
changed anything. `install` over an already-patched directory rewrites nothing — a refreshed install
is bytes-identical — so a `start` over a healthy install is silent too.

The companion learns this the way it already learns whether a directory has stopped moving: by
statting `webview/index.js` and `extension.js` before the engine runs and again after. The bundle
moving means the loader was absent and is now there; `extension.js` moving is a host patch.
`fingerprint` is the same function, taken apart into its files rather than joined into one string.

**Deliberately an inference rather than a report.** The engine knows both exactly — `VersionReport`
carries `action` and `hostChanged` — and handing them over means a new flag on `install`, which an
engine one release behind does not have, on a companion that acquires whatever
`@rigline/core@latest` resolves to. A shell that refuses to work against an older engine is the
coupling D80 exists to avoid, and it would mean 8b could not be read live without a release. Two
stat calls cost nothing and work against every engine there has been. When something else wants the
structured report, `install --json` can come then and this can switch to it.

#### The gate: an extension that is not running has no webview

`extensions.getExtension(CLAUDE_CODE).isActive`, sampled *after* the install rather than before.
Sampling before misses somebody who opened the panel while the engine was running, which is a
missed prompt over a panel that really is stale; sampling after can offer to somebody who opened it
a moment later and got patched bytes, which costs them a dismissal. Loud over silent, as everywhere
else (P8).

**It buys less than it looks like it does, and that is worth knowing before reading a false
positive as a bug.** Claude Code declares `onStartupFinished`, so it is active in every window from
startup whether or not its panel is open — `isActive` therefore does not mean "a webview exists",
and a `start` over an unpatched directory offers even in a window nobody has opened the panel in.
What the gate still catches is the extension being absent or switched off, and a host that has not
finished starting.

Narrowing it further is not available. VS Code exposes no way to ask whether another extension has
a live webview, and `onWebviewPanel:claudeVSCodePanel` is a serialiser registration rather than a
fact we can read. The false positive is a dismissible notification over a window with no turn to
lose, which is the cheapest thing on this page to be wrong about.

#### The two offers, and which one is asked

Not two buttons on one notification. A webview reload cannot fix a changed `extension.js` and a
window reload fixes both, so which is asked is decided by what moved rather than left to the user:

- `extension.js` moved — *Reload window*. It ends every session in the window, and the message says
  so.
- only the bundle moved — *Reload webviews*, through
  `workbench.action.webview.reloadWebviewAction`. It ends the in-flight turn of every Claude session
  in this window, and the message says that too.

Both are information notifications rather than warnings. Nothing is broken that stays broken — the
next window reload fixes it either way — and spending the warning colour on a cosmetic prompt is how
the real warnings stop being read.

#### What is not offered

A payload that moved under a working loader. An engine update mid-session leaves the webview running
the previous payload, which is a real staleness and still not worth a prompt: the decorations are
there, they work, and the next reload picks up the new ones. The offer is for *Rigline is absent*,
which is what keeps it rare enough to mean anything.

#### Dismissing, and getting back to it

Asked once, never repeated. Dismissing leaves the status item reading `Rigline: reload to apply`,
which is the same offer without the interruption — clicking it opens the notification again rather
than reloading, so there is exactly one place the cost is stated and exactly one path the reload is
taken by. That is D55 and D56's rule applied to the reload itself: somebody who was mid-turn when
the offer arrived should not need to know a command to get back to it.

No Command Palette entry. VS Code already contributes *Developer: Reload Webviews*, and a second one
that happens to also clear Rigline's status item is a worse answer than the status item.

#### What it costs

`Editor` grows from six methods to nine, each a real editor capability: `extensionActive`,
`reloadWebviews`, `reloadWindow`. `ask` grows a level so an offer is not dressed as a warning,
`Health` grows `stale` (and, proposed above, `ready`), and the status item's command is derived
from health in `extension.ts` beside the icons rather than passed through the seam. The decision
itself is a pure function in a new `reload.ts` that has never heard of VS Code, which is how a phase
whose acceptance is a live read still has tests.

#### Two channels that do not exist, recorded so they are not re-proposed

**The webview cannot tell us it is patched.** The injected payload runs in a browser context owned by
Claude Code; its `postMessage` reaches Claude Code's extension host code, not ours, and VS Code has
no cross-extension channel unless the other extension exports an API. A definitive "a patched
webview is live" signal would need a host patch that forwards it, which is a far larger act than the
thing it would decide.

**`extensions.all` cannot be asked which directory is *running*.** It describes what is installed.
The discriminator above is what replaces that question, and it needs nothing VS Code does not
already tell us.

#### Verification

Tier 1: the decision table — every combination of reason, bytes moved and activation, against
offer-or-silence; accepting calls exactly one editor method, once; dismissing calls none and leaves
`stale`; the status click re-offers rather than reloading. `activates.test.ts` gains the command
registration, because a status item whose command does not exist is a click that does nothing and
says nothing.

Tier 4 is the acceptance above, and it is the only tier that can see it.

### 8c: the surface

Enable, disable and settings, per the original phase 5 sketch. Deliberately last: it is the part with
no unique claim on being in an extension — `rigline disable NAME` already does it from a terminal —
and building it first would be building the easy half of the milestone instead of the point of it.

**Settled with Leo, 2026-09-22: read-only, nothing editable (D84).** `config.json` stays the only
place plugin state lives; enable and disable stay CLI-only.

**What's there already, and what's thin on top of it.** The output channel has carried the engine's
whole report, plugin lines included, since 8b's fix to pipe stdout instead of discarding it — every
version block already prints `loading: ...` and `switched off in config: ...`. That satisfies
"visible" but not "findable": a person wanting only the plugin list has to scroll a report that also
carries module counts, anchor resolution and host-patch detail. **8c is one command**,
`rigline.showPlugins` ("Rigline: Show Plugins" on the palette, the one command this package
contributes) — the rest of the shape (D84) is in `extension.ts`, not repeated here. No new `Editor`
method: revealing the channel is UI, so it stays in `extension.ts`, the one file that already touches
`vscode` directly.

Acceptance: the command is on the palette, produces the same listing `rigline list` would from a
terminal, touches nothing on disk, and makes no network call when an engine is already present.

## Decisions to record

D76 (the shape and the channel, amended 2026-09-22 — see below), D77 (the compliance position), D78
(the signature-verification premise), D79 (plugin obligations), D80 (the companion is a second
retrieval layer), D81 (nothing reacts to a directory still being written), D82 (a reload is offered
only after a `start`), D83 (`install` stays synchronous), D84 (the companion's plugin surface stays
read-only) and D85 (the `ready` health, distinguishing a `moved` reaction's success from steady
state) are all recorded. Nothing from this milestone is still waiting on a decision number.

The one open question this list used to carry — whether `extensionUri` is passed down or re-derived
— is answered by the finding below and folded into D76's amendment: re-derived, by scanning the
extensions directory. `extensionUri` cannot see an update land while its own host is the one frozen,
so it keeps the narrower job D82 already gives it: telling the reload decision what *this window*
loaded.

## `extensionUri` is where this host loaded it, not where it is now

Read live on 2026-09-22, and it invalidates a premise this milestone was built on.

With a window open and Claude Code running, `code --install-extension anthropic.claude-code@2.1.269
--force` installed a new versioned directory, pointed `extensions.json` at it and marked the old one
obsolete. The companion, watching for ninety seconds across three poll cycles, reacted not at all.

**`vscode.extensions.getExtension(id).extensionUri` answers a different question than the one asked
of it.** It is where *this extension host* loaded the extension from, and that is fixed until the
host restarts — which is exactly what VS Code's "restart extensions to apply" prompt is offering to
do. So the value `look()` compares cannot change while a window runs, and both signals die with it:
the poll compares it, and `onDidChange` only pokes the same comparison.

**The `moved` branch therefore never fires for an update.** Not rarely — never, while the window
that would react is the window whose host is frozen. Everything that was said about the fast path
shortening the gap to a second describes a code path an update cannot reach.

**What actually happens weekly, then.** The update lands and nothing notices. At the next window
reload Claude Code activates from the new, unpatched directory, so the panel renders without
Rigline; the companion's `start` finds it unpatched, injects, and offers the reload; the user takes
it and Rigline is back. Rigline does recover — the milestone's promise holds — but through the
prompt rather than through silence, every week, with the panel briefly bare.

**The claim to strike** is that the patch lands on disk while the old extension is still live, so
the reload the user was going to do anyway comes up patched. Nothing puts it there in time.

**D82 is strengthened rather than damaged.** It reasoned that a `moved` means this host is running
the other directory, so nothing in this window is stale; that holds, and now for a stronger reason —
`moved` cannot arise from an update at all. The reload offer is no longer the rare case. It is the
weekly mechanism, and it is what makes the recovery work at all.

**The repair, and the irony in it.** The CLI's `update/watch.ts` polls the extensions *directory*
for the set of installed directories, and that sees the new one appear immediately. The companion
was given what looked like a better signal — VS Code stating authoritatively where the extension is
— and the authority is real but about the wrong thing. Scanning the directory is what restores
reacting while the old extension is still live, and `extensionUri` keeps the job it is actually
right for: telling the reload decision what *this window* loaded (D82).

## The exit code says who is wanted; the bytes say what happened

Two questions, and for a while one number was answering both.

`hostChanged` used to put a line in `attention`, which is a non-zero exit (D27). But `check` reports
it false by construction, so it is only ever true from `install` and only ever describes work that
run just did — which is the rule the `payloadEngine` entry beside it already states, and the
opposite of every other entry in the list, each of which names something a person must *repair*.
Since `worktree-prefix` is bundled and enabled, an install from vanilla patches `extension.js`, so
**every weekly update exited 1 having completely succeeded**.

The companion read that as the failure it looked like: `install failed` on the status bar, and an
early return before the reload was ever worked out. The one case 8b's window-reload offer exists for
was the one case that could not reach it.

**So the companion no longer treats the exit code as the whole answer.** It samples the bytes either
way and decides the reload from those (D82), because an engine that refused moved nothing and an
engine that wants a person may still have injected. A non-zero exit keeps the status on `attention`
— a person is wanted and that outranks a reload prompt — and the offer still goes up, because both
are true and the panel is stale whatever else is wrong.

**The engine's own report goes in the output channel.** It used to be run with inherited stdio,
which is right from a terminal and wrong from an extension host: that stream reaches no log VS Code
keeps, so every word the engine said was dropped — on exactly the runs where the status bar then
told somebody to go and read it. The companion spawns it and pipes it now, a line at a time, so the
channel carries the whole flow report and a non-zero exit points at text a person can actually see.

**That is also what keeps 8b readable without a release.** The fix to `attention` is in the engine,
and the companion runs whatever `@rigline/core@latest` resolves to, which will be a version behind
for a day (D48). Reading the bytes means the offer is correct against the engine already on the
machine rather than against the one carrying the fix — which is the property D80 asks for, arrived
at by having got it wrong once.

The residue, stated: with a non-zero exit the status stays `attention`, so a dismissed offer has no
status item to click and is gone until the next run. Two states, one line of status bar, and the
one naming a person who is needed wins.

## The panel wedge: retested, did not recur

Two occurrences on 2026-09-22, both within seconds of the companion running `install` against a
directory the window was live on. The panel stopped accepting a submitted prompt; Claude Code logged
nothing at all from the moment of the install until a window reload, which fixed it each time. No
API request, no error, no entry — so the message never left the webview.

**What was known.** Both times the run reported `refreshed` for the directory the window had loaded,
meaning `webview/index.js` was not rewritten. What *was* rewritten under the live webview is the
payload beside it: `pre.js`, `post.js`, `generated.js`, `registry.js`, and `plugins/`, which is
deleted and recreated rather than overwritten in place. No mechanism by which that wedges a webview
whose modules were imported at boot was ever found, and one had been guessed at twice already in
this milestone and been wrong both times.

**`install` now writes only files that differ**, so a run over a directory that is already correct
touches nothing — an extension update alone no longer reproduces this. **To make the engine write
under a live window on purpose**, change something the payload depends on rather than swapping an
extension version: `pnpm rigline disable NAME` then `enable NAME`, or `rigline dev` rebuilding a
plugin, both rewrite `registry.js` and a plugin directory under whatever the panel is currently
reading. Seconds per attempt, and it isolates the writes from everything else an update does.

**Two more attempts, same day, against this checkout's own live panel: no wedge.** `disable
time-marks` then `enable time-marks` rewrote `registry.js` and `plugins/time-marks/` under the
directory this window was running from; a prompt submitted through that same panel immediately after
was answered normally. Then a closer match to the original trigger: `code --install-extension
anthropic.claude-code@2.1.270 --force` while this window stayed live on 2.1.268 — a genuine version
swap, not a manual plugin toggle. The companion reacted on its own and reinjected across every
tracked version, 2.1.268 (this window's live, already-loaded directory) included — its `registry.js`
was rewritten within the same second as 2.1.270's. Two prompts submitted through this panel
afterward, both answered normally.

Three clean attempts do not retire the mechanism — the two prior occurrences correlated with a write
under a live webview and stand unexplained, not retracted. But all three attempts share something
the original two may not have: the action logged was `refreshed`, not `injected`, meaning Rigline had
already patched that exact version directory before and the window had already booted from it —
so the webview's modules were already resident in memory, and rewriting the files on disk afterward
is a no-op to code that never re-reads them. **The webview panel itself stayed open throughout all
three attempts.** VS Code tears down and recreates a webview panel independently of the extension
host (losing focus, switching editor groups), which re-fetches `webview/index.js` and the payload
from disk fresh — exactly the read that could race the companion's delete-and-recreate of `plugins/`.
None of the three attempts exercised that: closing and reopening the panel, or a brand-new window
booting a version genuinely never seen on this machine, at the moment a write lands. That needs
watching a panel open or a window boot in real time, which is Leo's to trigger and observe rather
than something a background write-and-submit loop can produce.

This downgrades the item from something being actively chased to something watched for recurrence,
per Leo's call: ignore it unless it recurs. If it does, the instrument and the repro above are
already known — **the console comes before the reload.** *Developer: Open Webview Developer Tools*
is where the payload's errors go; reloading to recover destroys the only evidence, which is how both
occurrences were lost.

## The profile trap, which is what the "one machine" mystery was

VS Code profiles each carry their own extension set, and a workspace is bound to one. `code
--install-extension` installs into the **default** profile unless told otherwise. So on a machine
with profiles the command succeeds, `code --list-extensions` lists it, the directory sits under
`.vscode/extensions` with the right `extension.cjs` and manifest, and `extensions.json` carries a
correct entry — while the window shows nothing at all, because that window's profile keeps its own
`extensions.json` under `User/profiles/<id>/`, and the companion is not in it.

Every symptom of a broken artefact, and nothing whatever wrong with the artefact. It looks like an
extension that failed to load; it is an extension that was never offered to the extension host.

**The tells, in order of cheapness.** Nothing in the Extensions view — not present-and-inert, absent
— and nothing in *Developer: Show Running Extensions*. No `Rigline` output channel. And in the
extension host log, other extensions activating while `rigline.rigline` is not among them, which
separates "never scanned" from "scanned and refused".

**`--profile NAME` is the repair, and `vscode-setup` passes it through.** The name is the one in VS
Code's profile switcher. A name that does not match **creates a new empty profile** rather than
failing, so it wants copying rather than typing.

**The report has to name this, because the honest-looking diagnosis is wrong here.** It already
warned that `code` may have been a different install, which for somebody using profiles is a claim
they can check and reject — same editor, same binary, same extensions directory — and having
rejected it they have no next move. Profiles are named explicitly for that reason: a wrong
suggestion confidently made is worse than none, because it spends the reader's trust and then their
afternoon.

It is not inferred. The association between a workspace and its profile lives in VS Code's own
`storage.json`, under a different path for each of the five editors this supports, and reading a
private file to guess what the user could simply be asked is how a command acquires knowledge that
rots. Ask, and say why.

## Deferred, with triggers

- **Auto-update of the companion itself.** A sideloaded VSIX does not auto-update, and under D80 it
  barely needs to: the engine and the plugins move underneath a shell that changes only when the
  scheduling does. `rigline update` moves it for anybody who has the CLI. Revisit only if the VSIX
  turns out to change more often than expected, or if the Anthropic conversation (D77) resolves in a
  way that makes a registry listing wanted.
- **Forks other than VS Code.** Cursor, Windsurf and VSCodium have their own extensions directories
  and their own CLIs, and are plausibly where this is most wanted. Not in scope until one person
  asks, and cheap to add when they do, because the only fork-specific part is which CLI to call.
