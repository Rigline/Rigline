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

Unresolved, and it is 8a's first real design question rather than something to settle here. The
shape of the answer is a lock file in `<RIGLINE_HOME>`, where the loser of the race waits or reports
that an update is already running, and never a second npm writing the same prefix. What must not
happen is two npm installs interleaving into one directory, which is how `engine` ends up in the
state the wrapper's README already tells people to delete.

Worth noting that the *injection* half needs no locking: it is rebuild-from-backup and idempotent, so
two processes injecting produce the same bytes. Only acquisition races.

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

The mechanism is `code --install-extension <path>.vsix`, which needs the `code` CLI on `PATH`.
Reliable on Windows; on macOS it is a thing the user has to have added from the Command Palette. It
is also plural: a machine may have VS Code, Insiders, and forks, each with its own CLI and its own
extensions directory.

**The refusal is the answer, not a workaround.** Where no CLI is found, say so, name the one-line
Command Palette alternative, and print the VSIX path. What we will *not* do is write into
`~/.vscode/extensions` and register the extension ourselves: that is patching VS Code's own state to
install a patcher, which is a worse act than the one Rigline already commits and a considerably less
defensible one. Left as a refusal until somebody has a better idea.

## Phases

### 8a: it re-injects, unattended

The whole of the value. A companion that acquires an engine, watches, spawns it, and re-injects —
with no UI beyond a status item and the failure notification.

It opens with the two costs above, because both are load-bearing and neither is visible from a test
that runs in Node: finding a Node and its npm from inside the extension host, and a lock so the CLI
and the companion cannot install over each other. Then the acquisition-code question, once the shape
is real enough to choose against.

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

### 8c: the surface

Enable, disable and settings, per the original phase 5 sketch. Deliberately last: it is the part with
no unique claim on being in an extension — `rigline disable NAME` already does it from a terminal —
and building it first would be building the easy half of the milestone instead of the point of it.

Worth deciding when it starts, not now: whether the plugin list belongs in a VS Code settings UI at
all, given `config.json` is the source of truth and a second editor for one file is a
synchronisation problem nobody asked for.

## Decisions to record

D76 (the shape and the channel), D77 (the compliance position), D78 (the signature-verification
premise) and **D80 (the companion is a second retrieval layer)** are recorded. What this milestone
will add:

- **How acquisition code is shared** between the wrapper and the companion, once 8a shows whether
  `rigline`'s internals import cleanly without its CLI surface.
- **Where the engine lock lives and what the loser does**, once the race has been provoked rather
  than reasoned about.
- **Whether `extensionUri` is passed down or re-derived**, once it is known whether the engine's
  locate step wants a hint or an override.

## Deferred, with triggers

- **Auto-update of the companion itself.** A sideloaded VSIX does not auto-update, and under D80 it
  barely needs to: the engine and the plugins move underneath a shell that changes only when the
  scheduling does. `rigline update` moves it for anybody who has the CLI. Revisit only if the VSIX
  turns out to change more often than expected, or if the Anthropic conversation (D77) resolves in a
  way that makes a registry listing wanted.
- **Forks other than VS Code.** Cursor, Windsurf and VSCodium have their own extensions directories
  and their own CLIs, and are plausibly where this is most wanted. Not in scope until one person
  asks, and cheap to add when they do, because the only fork-specific part is which CLI to call.
