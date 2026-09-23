# Milestone 8: the companion extension

Archaeology for the milestone that stopped a Claude Code update silently reverting Rigline. Opened
2026-09-21 when phase 5 outgrew its entry; 8a shipped in `1.0.0-alpha.8` and was read live on
`alpha.9`; 8b, 8c and `ready` shipped in `1.0.0-alpha.10`. The argument is D76 to D85 in
[decisions.md](decisions.md); the reference is [companion.md](companion.md). Nothing here is
load-bearing.

## The problem

An update installs a fresh directory and deletes the old one, so on the next reload the loader is
gone: no badge, no plugins, no error, weekly. It was the last silent failure in the project. The fix
already existed as `rigline watch`, and nobody was running it. What was missing was a process that is
running when the update lands, and VS Code is the one program that definitely is.

## The fork it opened on

*Does the companion embed the engine, or acquire it?* Embedding was shorter and would have worked.
It lost for D69's reason one layer up: two engines on one machine, `rigline update` able to move
only one, and a payload on disk that depends on which ran last, which is D75's condition
manufactured weekly. So the companion became a second retrieval layer (D80). That repaired D76's
weak point too, since a sideloaded VSIX that never needs updating does not mind that VS Code will not
update it.

That shape cost two things, and both were built before anything else: finding a Node and its npm
from inside Electron, and a lock so two retrieval layers cannot install over each other. A draft
that refused to fetch an engine when none was present was withdrawn, because that refusal left the
companion unable to do the one job it exists for.

Marketplace policy, the risk phase 5 had been carrying, turned out not to exist; the live constraint
is Anthropic's (D76, D77).

## The phases

**8a**: acquire, watch, spawn, re-inject, with a status item and a failure notification. Read live on
`alpha.9` from `npm i -g rigline` and `rigline vscode-setup` on a Windows laptop.

**8b**: the reload offer, for a window that came up over an unpatched directory (D82). Read live:
the offer appeared, the webview reload restored the decorations, dismissing left it on the status
bar, the window variant appeared over a host patch, and a real replacement under a running window
stayed silent.

**8c**: *Rigline: Show Plugins*, read-only, settled with Leo (D84). Enable, disable and settings in
the extension were declined: a second place plugin state could be read from is a synchronisation
problem with no owner. Read live on 2026-09-23.

**`ready`** (D85): a patched arrival used to land back on the same `ok` as steady state, so nothing
said whether it was safe yet to accept VS Code's restart prompt. Found by accepting it too early.
Its live read waits for the next Claude Code update ([plan.md](plan.md)).

## What the live reads found that no test could

Every one of these is the same shape: an artefact never exercised, or a signal answering a question
other than the one asked of it.

- **`vscode-setup` had never worked on Windows.** VS Code ships its CLI as `code.cmd`, and Node
  refuses to spawn a batch file directly. Every test injected the spawn.
- **The built bundle had never been loaded.** `activates.test.ts` exists because of it.
- **`install` exits 0 when no Claude Code is installed**, so a companion installed first went green
  over nothing.
- **`extensionUri` is frozen at what this host loaded.** The `moved` branch could never fire for an
  update; ninety seconds and three polls produced nothing. Watching the directory on disk fixed it
  (D76 amended).
- **The exit code was answering two questions.** A bundled host patch put every successful update in
  `attention`, so the companion reported `install failed` and never reached the reload offer. The
  bytes now decide the reload and the exit code only says whether a person is wanted, and the
  engine's output, which had been going to a stream VS Code keeps no log of, is piped into the
  output channel.
- **The one machine where the companion was inert** was the profile trap: installed into the default
  profile, invisible to a window on another.

## The panel wedge

Twice on 2026-09-22 a panel stopped accepting prompts within seconds of the companion running
`install` against the directory the window was live on, with nothing logged until a window reload
fixed it. No mechanism was found, and two guesses at one had already been wrong. `install` now writes
only files that differ. Three retests the same day, including a genuine version swap under a live
window, were clean. All three rewrote payload files under a webview whose modules were already
resident, which may not be what the originals did. Left as watched rather than chased, per Leo.
