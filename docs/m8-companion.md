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

## The fork everything derives from: run the engine, do not become one

Two shapes, and the rest of the design follows whichever is chosen, so it is settled first and
separately.

**(a) The companion embeds `@rigline/core`** and injects from inside the extension host. Core is a
library and exports everything needed, so this works and is the shorter path.

**(b) The companion spawns the installed engine** at `<RIGLINE_HOME>/engine`, the same bin
`rigline` drives.

**(b), and the reason is D69 one layer up.** A VSIX that embeds core puts a second engine on the
machine. `rigline update` moves `<RIGLINE_HOME>/engine`; it cannot move a copy sealed inside an
extension VSIX, so the two drift the moment either is updated — and then the injection on disk
depends on which of them last ran. D75 exists because a stale payload is indistinguishable from a
current one by looking at it; embedding core manufactures exactly that condition, weekly, with no
way to tell which engine wrote what.

One engine owns bytes. The companion is a scheduler for it, not a second copy of it.

Three things fall out, and each is worth more than it looks:

- **`rigline update` updates the companion's behaviour** without republishing the VSIX, because the
  behaviour is the engine's. The VSIX moves only when the *scheduling* changes, which is rarely.
- **The companion cannot disagree with the CLI**, because they are the same program. `rigline check`
  from a terminal describes what the companion would do.
- **The VSIX stays genuinely thin** — activation, a watcher, a prompt, a status item. No harvest, no
  anchor table, no payload, nothing version-derived.

The cost is that the companion must locate and spawn Node, and must handle the engine being absent.
Both are answered below, and the second one is answered by D76: the VSIX is installed *by* `rigline`,
so an engine necessarily exists. A VSIX sideloaded by hand without one refuses by name and says
which command to run — it does not bootstrap, because an extension that silently installs an engine
from npm is the thing a reviewer would be right to object to.

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

`rigline` installs the VSIX and `rigline update` moves it, which is the loop the wrapper already owns
for the engine (D69, D76). The VSIX ships inside `@rigline/core`'s `dist/bundled` the way the four
first-party plugins do (D71), so there is no second fetch and no second packaging decision.

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

The whole of the value. A companion that watches, spawns the engine, and re-injects — with no UI
beyond a status item and the failure notification.

Acceptance: install Claude Code over itself on a machine with the companion running, reload the
window, and Rigline is there. Confirmed by reading, live, on a real update rather than a simulated
one — the same bar phase 6 was held to, and for the same reason: every green harness in this project
has at some point described a thing that was not happening.

Also acceptance: with the engine absent, the companion refuses by name and says which command to
run, and the extension host is otherwise unaffected.

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

D76 (the shape and the channel), D77 (the compliance position) and D78 (the signature-verification
premise) are recorded. What this milestone will add:

- **The companion spawns the engine rather than embedding core**, with the version-skew argument
  above. Owed once 8a proves the spawn works on a real machine.
- **Whether `extensionUri` is passed down or re-derived**, once it is known whether the engine's
  locate step wants a hint or an override.

## Deferred, with triggers

- **Auto-update of the companion itself.** A sideloaded VSIX does not auto-update; `rigline update`
  moves it instead. That is sufficient and keeps the channel decision (D76) intact. Revisit only if
  the Anthropic conversation (D77) resolves in a way that makes a registry listing wanted.
- **Forks other than VS Code.** Cursor, Windsurf and VSCodium have their own extensions directories
  and their own CLIs, and are plausibly where this is most wanted. Not in scope until one person
  asks, and cheap to add when they do, because the only fork-specific part is which CLI to call.
