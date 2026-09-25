# The companion extension

The VS Code extension that puts Rigline back after Claude Code updates. The argument is D76 and D80
to D85 in [decisions.md](decisions.md); what the milestone that built it turned on is
[history-m8.md](history-m8.md). This is the shape, for somebody about to change it.

## What it is

A second retrieval layer (D80). It acquires `@rigline/core` into `<RIGLINE_HOME>/engine` exactly as
`rigline` does, and spawns that engine for every piece of work, unless `rigline.enginePath` names
another (D94, below). It never harvests, injects or reads a manifest, and it never carries a copy of
the engine: one engine owns bytes, and everything else acquires it. So the companion cannot disagree with the CLI, and the VSIX needs a new release only
when the *scheduling* changes. New engines, anchor tables and plugins arrive underneath it.

It is optional. `rigline install` after each update is the whole of Rigline, and declining the
companion must cost nothing (D80). It is sideloaded rather than listed (D76).

## The package

`packages/vscode`, private, built to `rigline.vsix`, which `scripts/bundle-assets.mjs` copies into
core's `dist/bundled`. `rigline vscode-setup` therefore installs the companion the engine was built
with and fetches nothing.

- **`extension.ts` is the only module that imports `vscode`.** It adapts the editor to `Editor`
  (`editor.ts`) and calls into plain TypeScript with injected dependencies, which is how a package
  whose acceptance is a live read still has tier 1 tests.
  [activates.test.ts](../packages/vscode/test/activates.test.ts) loads the *built* bundle with a
  stubbed `vscode` and calls `activate`.
- **The bundle is CommonJS.** VS Code's support for an ESM `main` is recent and conditional, and a
  sideloaded extension that fails to load is simply absent rather than diagnosed.
- **The manifest is generated into `dist/`** by `build-manifest.mjs`. A VS Code `name` must be
  unqualified and `rigline` is already the CLI's, so the extension manifest cannot be this package's
  own `package.json`; its version comes from the workspace manifest and cannot drift.
- **Acquisition is the wrapper's code, bundled.** The package takes `rigline` as `workspace:*` and
  imports `rigline/engine`, the one subpath the wrapper exports. It is the only project allowed to
  declare `rigline` (D80 amends D69). The VSIX therefore freezes a snapshot of acquisition, which is
  why acquisition is the one part of Rigline to keep small. It passes its version from the manifest
  VS Code read, because inside a VSIX the wrapper's own lookup finds no manifest.

## Finding Node

The extension host's `process.execPath` is Electron, with no npm beside it. So `node.ts` takes the
`rigline.nodePath` setting, else `node` on `PATH`, and the wrapper then takes the npm beside *that*
Node. That is D73's rule, with a different starting point. With no Node, the status reads
*Rigline: no Node* and the message names the setting. `ELECTRON_RUN_AS_NODE` supplies an
interpreter, not an npm, and does not help.

## Running a checkout's engine

`rigline.enginePath` names an engine entry, and while it is set the companion spawns that for every
run, Show Plugins and Save, and never calls `updateEngine` or `ensureEngine` (D94). It is how a
machine developing Rigline stops the companion re-injecting the released engine's payload over the
checkout's on every extension-host start, and how engine work reached through the companion is tried
before a release. Point it at `packages/core/dist/engine/bin.js`; `vscode-setup` run from a checkout
prints the line. Then `pnpm build` and a reload is the whole loop.

It is machine-scoped, so Settings Sync does not carry it, but a profile's settings are its own: it
has to be set in every profile the companion is installed in, since each of those companions writes
the same Claude Code directories. A path that is not there is *Rigline:
failed*, naming the setting, never a quiet fall back to the acquired engine. Every status carries
*(dev)* while it is set, with the entry in the tooltip and on the output channel's `engine:` line.
Clear it to read against the released engine.

## The home lock

The CLI and the companion both write `<RIGLINE_HOME>/engine`, so `withHomeLock`
([lock.ts](../packages/cli/src/lock.ts)) takes `<RIGLINE_HOME>/.lock` by exclusive create, writing
the holder's pid, start time and name into it. A lock is stolen only when its process is gone *and*
it is old. It wraps `installEngine` rather than any command, held across the npm run, because a
first run installs an engine whatever verb was typed. It covers the whole home, because `update`
moves plugins in the same run. Injection stays outside, since rebuild-from-backup is idempotent. A
contended lock is a reported outcome, and the companion carries on with the engine already there.

Plugin-level races between two engines writing different plugin directories are left until they
bite.

## Watching

What is watched is the **set of `anthropic.claude-code-*` directories on disk**, in the directory
the companion itself is installed in. It is polled every thirty seconds, with
`extensions.onDidChange` as a hint that shortens the wait and is never relied on. It is never
`extensionUri`, which is where *this* host loaded the extension from and stays fixed until the host
restarts (D76, amended). A reinstall of a version already there, or a `restore`, changes no name and
is picked up at the next `start`.

Reactions are serialised: a run in flight drops its follower, because the work is idempotent. A new
directory is left alone until it has stopped moving (D81): sizes and modification times of three
files, two seconds apart, ten tries, and a directory that never settles stays outstanding for the
next poll. A directory going away is logged and reacted to not at all (D85).

## A run

A run is a `start`, on activation, or a `moved`, when a directory arrives. It finds Node, moves the
engine if the tag has (the release-age gate applies, D48), stamps the bytes, runs `install` with its
output piped into the **Rigline** output channel a line at a time, and then decides.

| outcome | status item |
| --- | --- |
| no Claude Code installed | *Rigline: no Claude Code*. `install` exits 0 with nothing to do, so the exit code is not trusted. |
| the engine exits non-zero | *Rigline: needs you*. A person is wanted, but it may still have injected, so the reload decision runs anyway. |
| `moved` | *Rigline: ready to restart*. A new version is patched behind this window (D85). |
| `start` | *Rigline*, green. |
| anything throws | *Rigline: failed*, with the message. A run never rejects, since nobody would see it. |

## The reload offer

Only after a `start`, only for bytes that moved, and only while Claude Code is active (D82). What
moved is read from stamps of `webview/index.js` and `extension.js` taken either side of the run,
never from the engine's report, so the decision holds against an engine that predates it. A changed
`extension.js` asks for *Reload window*; a changed bundle alone asks for *Reload webviews*. Both
are information notifications, and neither is ever fired unasked, because each ends the in-flight
turn of every Claude session in the window.

In the ordinary update none of this happens: the new directory is patched behind the running
window, and the next reload comes up patched. The offer is for a host that came up over an
unpatched directory, and VS Code's own *Restart Extensions* accepted before the companion finished
is the usual way to get one.

Dismissed, the status item reads *Rigline: reload to apply*, and clicking it re-opens the same
notification (`rigline.reload`, deliberately not on the palette). A payload that moved under a
working loader is never an offer.

## Show Plugins

`rigline.showPlugins`, *Rigline: Show Plugins*, is the one palette command. It resolves the engine
already on disk with `ensureEngine` alone, never `updateEngine`, and pipes the engine's own `list`
into the output channel. It never touches the status item. Plugin state stays in `config.yaml`, and
enable and disable stay in the CLI (D84).

## Saving the panel's layout

The panel's Save is a link, `vscode://rigline.rigline/layout?p=…`, and VS Code hands a person's
click on it to the companion's URI handler (D93). The handler answers one path, `/layout`, and hands
the payload to the engine's `layout save` unread, through the engine already on disk and never an
update, as Show Plugins does. Saves run one at a time, so a save never waits on its notification:
one left standing in the notification centre would hold every later save, which then never runs and
says nothing. The engine prints the outcome first, and that line is the notification: a warning when
it saved over a change or refused, since a person needs to know either. Everything after it goes to the output channel. Only the link's path is logged, because
its query carries the token.

`onUri` is among the activation events, so a click before startup finishes still reaches the
handler, and `install` reads it from the manifest to decide that an installed companion answers.

## `rigline vscode-setup`

An engine verb, forwarded by the wrapper. It installs the bundled VSIX into every editor whose CLI
is on `PATH` (`code`, `code-insiders`, `codium`, `cursor`, `windsurf`), with `--force` so re-running
is a no-op, and then injects, so the first reload after it already works. `--remove` uninstalls and
leaves the injection alone, because `restore` is the verb for that. A batch-file CLI is spawned
through `cmd.exe`, since Node refuses to spawn one directly.

Where no CLI is found, it refuses, names the *Install from VSIX* palette command and prints the
VSIX path. It does not write into `~/.vscode/extensions` itself: registering an extension by
patching VS Code's own state is a worse act than the one Rigline already commits. Run from WSL,
`code` installs into the WSL remote host, so the command works per environment, not per machine.

## The profile trap

VS Code profiles each carry their own extensions, and `code --install-extension` installs into the
**default** profile. On a machine with profiles the install succeeds and the directory and manifest
are right, while a window on another profile never offers the extension to its host. The tells are
that the companion is absent (not merely inert) from the Extensions view and from *Developer: Show
Running Extensions*, that there is no **Rigline** output channel, and that the extension host log
never activates `rigline.rigline`.

`--profile NAME` is the repair, passed through to `code`. Copy the name rather than typing it,
because a name that does not match creates a new empty profile. The profile is asked for rather than
inferred from VS Code's private `storage.json`.

## Reading it live

Tier 1 covers the watcher, the run and the reload decision table. Everything else is a live read,
and these reproduce the cases on demand:

- **The offer:** `rigline restore`, then *Developer: Reload Window*, brings a window up over an
  unpatched directory. `rigline disable worktree-prefix` first for the webview offer; with it
  enabled an install from vanilla always changes `extension.js`, and the window offer appears.
- **An arrival:** `code --install-extension anthropic.claude-code@<version> --force` for a version
  whose directory is **not** already on the machine, into the profile the window uses. A version
  already present reuses its path and nothing arrives, which looks exactly like the designed
  silence. Find the `installed:` line in the output channel before reading anything into what
  follows ([verification.md](verification.md)).
- **The engine is a released one**, a day behind this checkout at most (D48), unless
  `rigline.enginePath` is set. Clear it to read what a user gets.
- **A panel that stops accepting prompts** after a write under a live window was seen twice and has
  not recurred in three retests. If it does, open *Developer: Open Webview Developer Tools* before
  reloading: a reload destroys the only evidence.

## Not available, so not to be re-proposed

- **The webview telling the companion it is patched.** The payload's `postMessage` reaches Claude
  Code's host code, not ours. A link reaches the companion only when a person clicks it (D93), so
  nothing can tell the companion anything unprompted.
- **Asking which directory is running.** `extensions.all` describes what is installed; the
  `start`/`moved` split is what answers the question instead.
- **Embedding the engine in the VSIX** (D80), and **`ELECTRON_RUN_AS_NODE`** (above).
