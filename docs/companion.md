# The companion extension

The VS Code extension that puts Rigline back after Claude Code updates and saves what the panel
changes. The argument is D76 and D80 to D85, D99, D100 and D143 in [decisions.md](decisions.md);
what the milestone that built it turned on is [history-m8.md](history-m8.md). This is the shape, for
somebody about to change it.

## What it is

A second retrieval layer (D80). It acquires `@rigline/core` into `<RIGLINE_HOME>/engine` exactly as
`rigline` does, and spawns that engine for every piece of work, unless `rigline.enginePath` names
another (D94, below). It never harvests, injects or reads a manifest, and it never carries a copy of
the engine: one engine owns bytes, and everything else acquires it. So the companion cannot disagree
with the CLI. New engines, anchor tables and plugins arrive underneath it, and the companion follows
them itself, from the VSIX the engine carries (D99, below).

It is part of Rigline, not an option on it (D143). `rigline install` puts it into every profile that
has Claude Code, every injection a person runs keeps it there and current, and somebody who does not
want it does not want Rigline: `rigline uninstall` is how they leave. It is sideloaded rather than
listed (D76).

## The package

`packages/vscode`, private, built to `rigline.vsix`, which `scripts/bundle-assets.mjs` copies into
core's `dist/bundled`. `rigline install` therefore installs the companion the engine was built with
and fetches nothing.

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
  imports `rigline/engine`, which its own build resolves to the wrapper's source. It is the only project allowed to
  declare `rigline` (D80 amends D69). The VSIX therefore freezes a snapshot of acquisition until it
  next updates itself, and a companion whose acquisition fails never gets that far, which is why
  acquisition is the one part of Rigline to keep small (D99). It passes its version from the manifest
  VS Code read, because inside a VSIX the wrapper's own lookup finds no manifest.

## Finding Node

The extension host's `process.execPath` is Electron, with no npm beside it. So `node.ts` takes the
`rigline.nodePath` setting, else `node` on `PATH`, and then asks that Node what it is: one hidden
run, at home, with ten seconds to answer, printing its own `process.execPath` and version. What was
found may be a version manager's shim (volta, asdf, mise, nodenv, scoop, snap) or Homebrew's
symlink, with no npm beside it, so the binary it names is the one the wrapper takes the npm beside
and every spawn runs. That is D73's rule, with a different starting point.

A Node below the floor is refused by name, and the status reads *Rigline: Node too old*. The floor
is the wrapper's `engines.node`, which `build-manifest.mjs` writes into the companion's manifest,
where VS Code and vsce read only `engines.vscode`. With no Node, or one that does not answer, the
status reads *Rigline: no Node*. Both messages name the setting, which is machine-scoped, as
`rigline.enginePath` is, so Settings Sync does not carry one machine's path to another.
`ELECTRON_RUN_AS_NODE` supplies an interpreter, not an npm, and does not help.

## Running a checkout's engine

`rigline.enginePath` names an engine entry, and while it is set the companion spawns that for every
run, Show Plugins and Save, and never calls `updateEngine` or `ensureEngine` (D94). It is how a
machine developing Rigline stops the companion re-injecting the released engine's payload over the
checkout's on every extension-host start, and how engine work reached through the companion is tried
before a release. Point it at `packages/core/dist/engine/bin.js`; `pnpm rigline install` prints the
line whenever it puts a companion into a profile. Then `pnpm build` and a reload is the whole loop.
From a checkout the carried VSIX is the checkout's build, so `pnpm rigline install` is also how a
change to the companion reaches this machine: it reinstalls the companion only when its source
changed (D143).

It is machine-scoped, so Settings Sync does not carry it, but a profile's settings are its own: it
has to be set in every profile the companion is installed in, since each of those companions writes
the same Claude Code directories. `install` puts the companion in every profile that has Claude
Code, so that is each of those. A companion with the setting set adds itself to no other profile,
because one it added would start without the setting (D100). A path that is not there is *Rigline:
failed*, naming the setting, never a quiet fall back to the acquired engine.

A development profile beside release profiles is not isolation. Every profile shares Claude Code's
directories, and `install` injects every version on disk, so each start of a release profile's
window replaces the checkout's payload. For a setup kept apart from a release one, use a second VS
Code instance with its own `--extensions-dir`. Every status carries
*(dev)* while it is set, with the entry in the tooltip and on the output channel's `engine:` line.
Clear it to read against the released engine.

## The home lock

The CLI and the companion both write `<RIGLINE_HOME>/engine`, so `withHomeLock`
([lock.ts](../packages/cli/src/lock.ts)) takes `<RIGLINE_HOME>/.lock` by exclusive create, writing
the holder's pid, start time and name into it. A lock is stolen only when its process is gone *and*
it is old, or once it has been held ten minutes whatever its pid says, since Windows reuses pids
(D105); one whose file cannot be read is judged by the file's age. It wraps `installEngine`
rather than any command, held across the npm run, because a first run installs an engine whatever
verb was typed. A contended lock is a reported outcome, and the companion carries on with the
engine already there.

Injection has a lock of its own, `<RIGLINE_HOME>/inject.lock`, which the engine holds across every
run that injects, checks or restores (D105). Two open windows mean two companions running the engine
on one Claude Code update, and without it one engine's writes landed inside the other's stability
sample and read as an update still in progress. The second engine now waits, says so in its output
channel, and finds every version already current. It is apart from `.lock` so that an injection
never waits on a download.

Plugin-level races between two engines writing different plugin directories are left until they
bite.

## Watching

What is watched is the **set of `anthropic.claude-code-*` directories on disk**, in the directory
the companion itself is installed in. It is polled every thirty seconds, with
`extensions.onDidChange` as a hint that shortens the wait and is never relied on. It is never
`extensionUri`, which is where *this* host loaded the extension from and stays fixed until the host
restarts (D76, amended). A reinstall of a version already there changes no name and is picked up at
the next `start`. A `restore` is not undone there: the next `start` stays out until a person injects
(D111).

Reactions are serialised: a run in flight drops its follower, because the work is idempotent. A new
directory is left alone until it has stopped moving (D81): sizes and modification times of three
files, two seconds apart, ten tries, and a directory that never settles stays outstanding for the
next poll. A directory going away is logged and reacted to not at all (D85).

## A run

A run is a `start`, on activation, or a `moved`, when a directory arrives. It finds Node, moves the
engine if the tag has (the release-age gate and the Node floor apply, D48, D116), stamps the bytes,
runs `install` with its output piped into the **Rigline** output channel a line at a time, and then
decides. Every engine run, this one and the one-off commands', starts in the home directory, since
the engine reads a `generated.ts` where it runs. The extension host works wherever VS Code was
started, which is `/` when macOS's `code` starts it through launchd, and can be a plugin workspace
when VS Code is started from a shell in one.

| outcome | status item |
| --- | --- |
| no Claude Code installed | *Rigline: no Claude Code*, asked of the editor: `install` refuses with 1, and engines have exited 0, so the exit code is not trusted. |
| the engine exits non-zero | *Rigline: needs you*, with what the engine listed under *Needs you*, or the refusal it ended on, in the tooltip. A person is wanted, but it may still have injected, so the reload decision runs anyway. |
| the new engine needs a newer Node | *Rigline: needs you*, having run the engine it has (D116). |
| `moved` | *Rigline: ready to restart*. A new version is patched behind this window (D85). |
| `start` | *Rigline*, green. |
| anything throws | *Rigline: failed*, with the message. A run never rejects, since nobody would see it. |

Clicking any status that wants a person shows the **Rigline** output, which is where each says the
rest. The commonest *needs you* is a `restore` still holding Rigline out (D111), which the tooltip
names.

## Updating itself

Self-update keeps the companion matching its engine between a person's runs, each of which installs
the carried companion wherever a profile has another (D143). After every `start` or `moved` run, and
after the reload offer so it never delays one, the companion runs `companion-status` with its own
directory through the engine that run used (D99). The engine
fingerprints that directory alone against `dist/bundled/rigline.vsix.json`, since every profile
shares the extensions directory. When it is not the carried companion, the companion installs the
carried VSIX with `workbench.extensions.installExtension`, which for a VSIX installs into this
window's profile. The new version takes over at the next extension-host restart, which the
companion never takes: VS Code shows its own restart badge on the Extensions icon and a banner in
the Extensions view, and removes the old directory at a later start.

What it will not do, each read in `selfupdate.ts`:

- **Install at its own version.** VS Code would delete the running companion's directory and
  extract over it. A mismatch at the same version means the fingerprint rule is out of step, and is
  logged.
- **Install a fingerprint twice.** The profile's `globalState` records what was installed, so the
  runs until a restart, and a second window of the profile, leave it.
- **Run with `rigline.enginePath` set.** A checkout build carries the release's version, so every
  build would be a same-version reinstall; `pnpm rigline install` is the developer's path (D94).
- **Install while a `restore` holds.** The engine answers `carried: null` under the mark, so a
  companion still running after `rigline uninstall` does not put itself back (D111, D143).
- **Complain twice.** A failed install is retried each run and logged with the *Install from VSIX…*
  path, and sets *needs you* once per carried fingerprint, only over a green status.

The engine's answer is parsed from stdout alone, since an engine too old for the verb prints its
usage on stderr, and a shape without `v: 1` is logged and ignored. A new major is a manual step: the
wrapper refuses to move the engine across it, and the companion says *needs you*, naming
`npm i -g rigline@latest`, then `rigline install`.

## Adding itself to other profiles

After self-update, the companion runs `companion-profiles` through the same engine, naming its own
editor exactly (D100). Its arguments are:

- `--user-data-dir`, three levels up from `globalStorageUri`. That URI is the default profile's in
  every profile, so it names the directory and never the profile.
- `--extensions-dir`, the parent of its own directory.
- `--cli-node` and `--cli-script`, which are `process.execPath` and `<appRoot>/out/cli.js`: what the
  `code` shim runs, with no `PATH` lookup.

The engine reads `storage.json` and each profile's `extensions.json`, and adds the companion to every
profile that has Claude Code and lacks it, whether or not the companion is in that editor already
(D143). While a `restore` holds it adds none, and says so. It answers `{ v: 1, lines, failed }` on
stdout, which is parsed as `companion-status`'s answer is. Each line goes to the output channel. A
failure says *needs you* once per distinct failure, only over green, and is forgotten after a look
that succeeds.

An open window of the profile added to starts the companion at once, with no restart, and its own
`start` run finds nothing to add. The companion skips its look in a remote window, whose paths are
the remote host's, and while `rigline.enginePath` is set. Every injection a person runs does the
same work, through the ensure step (below).

A VSIX install re-extracts the shared directory every time, so adding the companion to one profile
rewrites the directory another profile's running companion was loaded from. With identical bytes
that is harmless: read live, the install succeeds on Windows and the running window does nothing.
With a different build at the same version it swaps the files under that window, which settles at
its next extension-host restart; nothing refuses over it any more, since the companion is required.

It fights an uninstall made through the Extensions view, which leaves no trace in `extensions.json`.
Disable does not come back, since VS Code keeps the disabled list elsewhere, and a profile where the
companion is disabled has no Save, no status and no re-inject of its own.

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

Once offered, the status item reads *Rigline: reload to apply*, unless the run wants a person, and
clicking it re-opens the same notification (`rigline.reload`, deliberately not on the palette). It
goes stale when the notification goes up rather than when it is answered, since one left alone
waits in the notification centre and never answers. Only one answer acts on an offer, so taking
the reload from both notifications reloads once, and a taken reload clears the item. A payload
that moved under a working loader is never an offer.

## Show Plugins

`rigline.showPlugins`, *Rigline: Show Plugins*, is the one palette command. It resolves the engine
already on disk with `ensureEngine` alone, never `updateEngine`, and pipes the engine's own `list`
into the output channel. It never touches the status item. Plugin state stays in `config.yaml`, and
enable and disable stay in the CLI (D84).

## Saving from the panel

The panel's Save is a link, `vscode://rigline.rigline/layout?p=…` or `…/settings?p=…`, and VS Code
hands a person's click on it to the companion's URI handler (D93, D140). The handler answers those
two paths and hands the payload to the engine's `layout save` or `settings save` unread; any other
path logs `ignored a link Rigline does not answer`, which is what an older companion does with a
newer panel's link while the panel's save goes `unconfirmed`. Nothing about the companion is baked:
a person's install refuses without one, and in a profile that still lacks it a link finds nothing,
because the id is held on the Marketplace, and the panel's *unconfirmed* note names `rigline
install` (D93, D143). The handler runs each save through the engine already on disk and never an
update, as Show Plugins does. Saves run one at a time, so a save never waits on its notification:
one left standing in the notification centre would hold every later save, which then never runs and
says nothing. The engine prints the outcome first, and that line is the notification: a warning when
it saved over a change or refused, since a person needs to know either. Everything after it goes to the output channel. Only the link's path is logged, because
its query carries the token.

`onUri` is among the activation events, so a click before startup finishes still reaches the
handler.

## The ensure step

`ensureCompanion`, in `packages/core/src/companion/ensure.ts`, runs before every injection a person
runs: in `reinject`, so `install`, `add`, `remove`, `enable`, `disable`, `update` and `layout`'s
edits, and once at the start of `dev` (D143). It refuses only where a change is needed and cannot be
made, and it comes before the `restore` mark is taken away, so a refusal injects nothing and leaves a
restore holding. The companion's own runs and saves are exempt, since it updates and adds itself,
and so is `install --ext` (D118). VS Code alone, because its extensions directory is the only one
the engine injects; `EDITOR_CLIS` is a table so that other editors are an entry each once the engine
takes a directory (plan.md).

1. **No Claude Code installed:** no step. CI, WSL and a remote host stop here.
2. **Read the profiles** from VS Code's own files, found in the order VS Code itself resolves them
   (`VSCODE_PORTABLE`, then `VSCODE_APPDATA` and `VSCODE_EXTENSIONS`, then the platform's default).
   Each profile's companion is its `extensions.json` entry, with the directory `relativeLocation`
   names. The targets are the profiles with Claude Code, or the default profile alone where none
   lists it or the profiles cannot be read, which the report says.
3. **Judge each target.** For the engine the companion runs, the acquired one, recognised by its own
   path under `<RIGLINE_HOME>/engine`, or a checkout, a target is current when its companion is the
   carried build by D99's fingerprint. For any other engine, such as a plugin author's workspace
   `@rigline/core`, any companion is current, and it installs only where a profile has none:
   replacing would match the companion to an engine it does not run, and self-update would put it
   back. Every target current: inject, having started nothing.
4. **Install where a target is not.** Only now is `code` looked for on `PATH`, and with none it
   refuses, naming the fix: *Shell Command: Install 'code' command in PATH* on macOS, the installer's
   option elsewhere, or *Install from VSIX…* with the path. The carried VSIX goes in with `--force`
   where it replaces a companion, which a downgrade after an engine rollback needs, and without it
   where the profile had none.
5. **Read `extensions.json` again and decide from it**, never from the CLI's exit code: a different
   editor answering to `code` exits 0 having installed somewhere else. Every target current: inject.
   Some: inject, and name the rest under *Needs you*. None: refuse.

What it installed comes before the injection report, and a new companion ends the report with the
window reload it needs to start. From a checkout it also prints the `rigline.enginePath` line, since
a profile it just added the companion to has none yet. `check` runs the first three steps and says
under *Needs you* what the fourth would do, except while a `restore` holds Rigline out.

**A companion somewhere the engine does not inject says so and does nothing else.** It compares its
own extensions directory with `~/.vscode/extensions`, and anywhere else — another editor, a portable
VS Code, a custom `--extensions-dir`, a remote host — it reads *Rigline: not in this editor* and
neither acquires an engine nor injects. It would otherwise inject VS Code's Claude Code from another
editor and report green over a panel it never touched.

In a remote window — WSL, SSH, a container — Claude Code runs on the remote host, from
`~/.vscode-server/extensions`, so its panel is vanilla. Read live in WSL: the local companion does not
run there, VS Code offers *Install in WSL*, and the copy that installs reads *not in this editor*.
**Keep the companion a workspace extension**, which is what a `main` and no `extensionKind` make it.
As a UI extension the local one would run in the remote window, find itself in `~/.vscode/extensions`,
and report green over a remote panel it never touched.

An install passes `--do-not-sync`, which the CLI accepts though its help omits it: Settings Sync
would carry the id to other machines, where VS Code asks the Marketplace for `rigline.rigline`, which
our publisher holds and lists nothing under (D93). A re-install moves an existing one to machine
scope, and an update keeps the scope it finds. A batch-file CLI is spawned through `cmd.exe`, since
Node refuses to spawn one directly. Nothing writes into `~/.vscode/extensions` itself: registering
an extension by patching VS Code's own state is a worse act than the one Rigline already commits.

`vscode-setup` is `install`, kept out of the usage and taking no flags, because a released 1.x
wrapper and companion name it to a person crossing the major, in code nothing updates.

## Leaving

`rigline uninstall` runs `restore`, leaving the mark, then takes the companion out of every profile
that lists it through `code --uninstall-extension`, deciding what went from `extensions.json` read
again, as the ensure step does. With no CLI on `PATH` it names the profiles to clear from the
Extensions view. It ends with what only the person can do: reload every window, `npm uninstall -g
rigline`, and delete `~/.rigline`, in that order. Uninstalling from a profile stops a running
companion only at its window's next extension-host restart, and until then its runs would undo the
uninstall; the mark stops them, since under it `install --companion` injects nothing,
`companion-status` offers nothing and `companion-profiles` adds nothing. Deleting `~/.rigline`
deletes the mark, hence the order.

## The profile trap

VS Code profiles each carry their own extensions, and `code --install-extension` installs into the
**default** profile unless told otherwise. A window on a profile without the companion never offers
it to its host. The tells are:

- The companion is absent from the Extensions view and from *Developer: Show Running Extensions*,
  not merely inert.
- There is no **Rigline** output channel.
- The extension host log never activates `rigline.rigline`.

Rigline reads the profiles (D100), and every person's verb and every companion start add the
companion wherever a profile has Claude Code, so this is left where Rigline cannot see:

- **Profiles it cannot read:** a portable install, a custom `--user-data-dir`, a fork whose entry in
  the table is wrong, or a remote window. `install` then says it looked at the default profile alone,
  and *Install from VSIX…* in the window's own profile is the repair.
- **A companion disabled in a profile.** VS Code keeps the disabled list in the profile's
  `state.vscdb`, which Rigline does not read.
- **Which profile a panel is in.** Nothing tells the panel, and the injected bytes are the same for
  every profile, so a Save in a profile without the companion makes VS Code look the id up on the
  Marketplace and say it was not found, and the panel reads *unconfirmed*.
- **Two writers at once.** A person's verb and a companion's look can install into one profile at
  the same moment. Left until it bites.

For extension commands the CLI refuses a profile name it does not know, with `Profile 'X' not
found.`, and creates nothing; only opening a window with an unknown `--profile` creates one.

## Reading it live

Tier 1 covers the watcher, the run and the reload decision table. Everything else is a live read,
and these reproduce the cases on demand:

- **The offer:** `rigline restore`, then delete `~/.rigline/restored`, then *Developer: Reload
  Window*, brings a window up over an unpatched directory. Without the delete the companion stays
  out, which is what `restore` is for (D111). `rigline disable worktree` first for the
  webview offer; with it enabled an install from vanilla always changes `extension.js`, and the
  window offer appears.
- **Staying out after a restore:** `rigline restore`, then a reload. The panel is vanilla, the status
  reads *needs you*, and the output channel names the restore. `rigline install` puts it back.
- **An arrival:** `code --install-extension anthropic.claude-code@<version> --force` for a version
  whose directory is **not** already on the machine, into the profile the window uses. A version
  already present reuses its path and nothing arrives, which looks exactly like the designed
  silence. Find the `installed:` line in the output channel before reading anything into what
  follows ([verification.md](verification.md)).
- **The engine is a released one**, a day behind this checkout at most (D48), unless
  `rigline.enginePath` is set. Clear it to read what a user gets.
- **Self-update** needs an engine that carries a different companion, and `enginePath` skips it. So
  read it in the isolated VS Code (`c:\dev\knowledge\vscode-extension-internals.md`) with a scratch
  `RIGLINE_HOME` holding this checkout's core and plugin-api, `pnpm pack`ed and npm-installed into
  `engine/`, which at the released version reads as current. Install this build relabelled with an
  older version and a changed description, with `--do-not-sync`. Set `USERPROFILE` to a scratch home
  whose `.vscode/extensions` is the `--extensions-dir`, so the engine's `install` never reaches the
  live extensions. The output channel's log under the user-data dir shows the update; after a
  restart, only the new directory is left and the log says nothing about updating.
- **Profiles** need no window. `VSCODE_APPDATA` and `VSCODE_EXTENSIONS` move both the engine's
  table and the CLI onto scratch directories.
  - Put the isolated VS Code's `bin` first on `PATH`.
  - Set `USERPROFILE` and `RIGLINE_HOME` to scratch directories, so the injection that follows finds
    no Claude Code.
  - Make profiles by writing `userDataProfiles` into the scratch `storage.json`.
  - Stand in for Claude Code with a VSIX holding only `extension/package.json`, with publisher
    `anthropic` and name `claude-code`, zipped by `tar --format zip`.
  - Then run `install` and `companion-profiles`, and read each profile's `extensions.json` after
    each step. `install` stops after the ensure step with no Claude Code to inject, so give the
    scratch home a fixture extension, and the scratch default profile's `extensions.json` an entry
    for `anthropic.claude-code`.

  What a window adds is only whether an open window reacts, and that was read once, for D100.
- **A panel that stops accepting prompts** after a write under a live window was seen twice and has
  not recurred in three retests. If it does, open *Developer: Open Webview Developer Tools* before
  reloading: a reload destroys the only evidence.

## Not available, so not to be re-proposed

- **The webview telling the companion it is patched.** The payload's `postMessage` reaches Claude
  Code's host code, not ours. A link reaches the companion only when a person clicks it (D93), so
  nothing can tell the companion anything unprompted. Nor through a VS Code command: the webview has
  no `vscode` API at all and the engine is a child process, so nothing of ours runs in an extension
  host to call one. `c:\dev\knowledge\vscode-extension-internals.md` has what `executeCommand` does
  between extensions, and why the panel reaching the companion would hand every plugin the same
  channel.
- **A two-way channel between the panel and the companion**, or a virtual one made of two one-way
  halves. A URI handler cannot reply: `handleUri` returns nothing, and the opener is a click. The
  reverse half would have to push into the webview, which needs either an egress the CSP does not
  have or a patch that forwards a message — and a patch is an equal-length byte substitution and
  never code, which is a **published guarantee** about what a hostile plugin cannot do (D25, D79),
  not a preference. So the reverse half stays a file the panel re-reads under a fresh query (D93),
  polled on focus rather than pushed (D126).

  The limitation is also load-bearing, which is the part worth not forgetting: because a link
  reaches the companion only on a click, every write from the panel *is* a person's gesture by
  construction. A proper channel would remove the structural reason for that and leave P9's
  "a person caused it" to be re-established in software. The cost of the channel is not only
  building it.
- **Asking which directory is running.** `extensions.all` describes what is installed; the
  `start`/`moved` split is what answers the question instead.
- **Embedding the engine in the VSIX** (D80), and **`ELECTRON_RUN_AS_NODE`** (above).
