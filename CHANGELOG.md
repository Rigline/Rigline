# Changelog

All four published packages — `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin` — share this file and one version number, so an entry names the package
only where the change is specific to one.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the line is `1.0.0-alpha.*`,
anything may change between releases.

## Unreleased

### Changed

- The companion's output shows each line's time in your own time zone, with its offset, where it
  showed UTC.
- `rigline update` and the companion stay on the engine you have when a newer one needs a newer Node
  than the one running them, and say which Node it needs: `rigline update` exits 1, and the
  companion reads *needs you*. They moved to it, and an engine that cannot start would have left the
  companion unable to update itself.
- `rigline --version` refuses anything after it, as every other command does, where it ignored it.
- The companion's `rigline.nodePath` setting stays on the machine it was set on. Settings Sync
  carried it to other machines, where a path from a Mac left a Windows machine with *no Node*.
- `rigline help` prints the usage, and `rigline help COMMAND` or `rigline COMMAND --help` prints
  that command's part of it, where each said the command was unknown. The usage lists the commands
  you use before the ones for writing plugins.

### Fixed

- `pnpm create rigline-plugin`, and `npm create rigline-plugin` on macOS and Linux, scaffold a
  workspace again. They exited 0 having written nothing.
- **For plugin authors:** `rigline dev` installs each build, as `rigline add` would, before it
  re-injects. Outside Rigline's own repository it re-injected the copy an earlier `add` had made, so
  the panel never showed what you had just built. It also stops at the first Ctrl-C.
- A `refine` in `~/.rigline/anchors.json` that is not a valid selector no longer takes Rigline's
  pill, menu and elements down with it. One whose brackets or quotes do not close is dropped at
  install, with a sentence saying so; one the panel still cannot parse leaves that anchor
  unresolved, and only the plugins needing it are refused, by name.
- An `anchors.json` override that changes only an anchor's `refine` is no longer reported as
  "changes nothing", which says to delete it. It reads "changes what the anchor matches".
- *Diagnostics* in Rigline's menu no longer disappears when Claude Code renames something it does
  not need. The probe required three anchors and eight message types, most of them unused, and any
  one moving refused it just as the pill turned red; it now requires nothing of Claude Code, and
  `rigline list` says what it reads where present.
- session-id takes the messaging address only from what `ListAgents` and `SendMessage` return. It
  took it from any tool's output that quoted the sentence, so a Read or a Grep of such text changed
  the address it offered. It now declares `tools` rather than the `io_message` message.
- time-marks no longer says "Today" over yesterday's rows in a panel left open past midnight.
- `rigline install` run in a directory holding a `generated.ts` it did not write — somebody else's,
  or a new plugin workspace's placeholder before `pnpm codegen` — failed after injecting, with
  advice that would have overwritten the file. It now leaves such a file alone.
- An install or restore stopped part-way — the machine turned off, say — could leave Claude Code's
  bundle or Rigline's backup of it cut short, and the next run could then make the cut-short copy
  the one `rigline restore` returns to, or write it over Claude Code's bundle. Every write into
  Claude Code's directory is now whole or not made at all, and a copy an earlier version left cut
  short is recognised and repaired from the whole one.
- The same holds for `~/.rigline/config.yaml`, `sources.json` and `baseline.json`. A
  `baseline.json` that cannot be read no longer fails every `install` and `check` until somebody
  deletes it: it is noted, and the next install records a new one.
- One broken Claude Code directory no longer stops `rigline check` and `rigline status` with a stack
  trace, or `rigline install` at the first write the filesystem refuses: that version is named with
  what is wrong, and every other is dealt with. A directory missing a file is said to be damaged or
  not fully deleted, with what mends it, where it was said to be mid-update, which never came true.
  `rigline restore` passes over a directory holding nothing of Rigline's rather than failing it, and
  `install --ext` and `check --ext` name a directory that does not exist.
- `rigline add`, `rigline dev` and `rigline remove` refuse a plugin in `~/.rigline/plugins` that is
  a link — a working tree an author linked in — naming the link and its target, where `add` and
  `dev` replaced the link with a copy. `rigline remove`'s usage now says what it does: it deletes a
  plugin from `~/.rigline/plugins` however it got there.
- **For plugin authors:** the manifest schema's `$id` is
  `https://cdn.jsdelivr.net/npm/@rigline/plugin-api@1/schema/manifest.json`, the newest 1.x schema,
  which is what `api: 1` means. It named a domain that is not Rigline's.
- **For plugin authors:** a new workspace's publishing steps work with a security key, the only
  second factor npm still enrols. They approve a staged release on npmjs.com or with
  `npm stage approve <id>`, and publish the first version with `npm publish`, where they said
  `pnpm stage approve` and `pnpm publish --otp`, both of which need a typed code. Its workflows use
  `actions/checkout` and `actions/setup-node` at v7.
- `rigline --help` and `rigline doctor` point at *Diagnostics*, then *Copy report*, in Rigline's
  menu, where they named a `RIG` badge that is gone; `rigline restore` says any command that
  injects puts Rigline back, not only `install`; and the README and support page say the companion
  needs VS Code 1.90 or newer.
- **For plugin authors:** `rigline install`, `rigline check` and `rigline dev` say in their plain
  report when a plugin calls something it never declared, which will disable it when it runs. It
  was behind `--verbose`, where the docs said it was not; a declaration never called, and the other
  notes about a plugin's source, stay there.
- `rigline check` exits 1 over an installed Claude Code version Rigline is not injected into,
  unless `rigline restore` is holding Rigline out, which it says instead; and `rigline update` exits
  1 when adding the companion to a profile failed. The stability page now says which
  commands exit 1 when something needs you, and that the reports — `list`, `status`, `doctor`,
  `diff` and a bare `layout` — exit 0 whenever they produced their report.
- A layout place in `config.yaml` that Rigline does not know — a typo, or a place a later Rigline
  added — is named under *Needs you*, and the command exits 1, as an unknown key already was. It
  was only noted, while the elements under it went back to their defaults.
- `rigline doctor --out` and `rigline codegen --out` make the directory they write into, where they
  stopped with a stack trace. An `anchors.json` or `rigline.json` saved with a byte order mark, as
  PowerShell 5 and Notepad save them, is read, where it was refused over a character nobody could
  see. An engine missing one of its own packages says how to mend it, where Node printed
  `ERR_MODULE_NOT_FOUND`, and "no Claude Code extension is installed" says where it looked.
- **For plugin authors:** a manifest key, capability or `api` this Rigline does not know says the
  plugin may have been written for a later Rigline, as an unknown `config.yaml` key does.
- `rigline install --ext DIR` injects DIR and changes nothing else. It recorded DIR as the baseline
  the next install compares against, rewrote a `generated.ts` in the directory you ran it from, and
  undid a `rigline restore`, so the companion put Rigline back into the extension you had restored.
- session-id stops offering a messaging address after *Reload Claude*, which starts a new Claude
  process with a new address under the same session, unless Claude Code said its addresses outlive
  a restart. It reads `launch_claude` to see the restart, declared optional, so a Claude Code
  without it leaves the plugin as it was.
- `rigline status` and `rigline doctor` say when a `rigline restore` is holding Rigline out.
  `status` lists the newest version first, as `install` and `check` do, and a version Rigline never
  injected reads "not injected" rather than "unknown, no backup". `rigline restore` with no Claude
  Code installed says so.
- The engine, started by a Node older than it supports, says which Node it needs and stops, where
  it failed part-way through the command with an error naming nothing.
- So does `rigline` itself, before it installs or runs anything, naming the Node it was started by.
- The companion runs the Node behind a version manager's shim — volta, asdf, mise, nodenv, scoop or
  snap — and behind Homebrew's `node`. It ran the shim and found no npm beside it, so it never
  updated the engine or itself while the status stayed green, and on a machine with no engine yet
  it installed nothing. A Node older than Rigline supports is named in the status, *Rigline: Node
  too old*, rather than failing part-way through.
- When VS Code removed an old Claude Code version while Rigline was installing into it, Rigline
  could leave a directory behind holding only its own files, and from then on every install, the
  companion's at each window start included, said it needed you. `rigline install` and `rigline
  restore` now remove that directory, and `rigline check` passes over it.
- `rigline` finds the npm that comes with Homebrew's `node` on macOS. It looked where other Node
  installs keep npm, so its first run failed to install the engine and every later `rigline update`
  said `engine: FAILED`. The command it suggests when there is no npm now quotes the engine's
  directory, so it works for a home directory with a space in it.
- The companion's *needs you* says why in its tooltip — what the engine listed, or that a
  `rigline restore` is holding Rigline out — and clicking it, or any status wanting you, shows the
  Rigline output. It said to read an output it gave no way to open.
- The companion's status reads *reload to apply* as soon as it offers a reload, where it stayed
  green over an unpatched panel until the notification was answered, which one left in the
  notification centre never is. Taking the reload from that notification and from the one a click
  on the status put up reloads once.
- `rigline`, refusing an engine of another major version, names both steps, as the companion
  does: `npm i -g rigline@latest`, then `rigline vscode-setup` if you use the companion.
- The companion's *no Node* message says to reload the window after setting `rigline.nodePath`,
  which is read when a window starts. Its README installs it with `rigline vscode-setup`, and lists
  `rigline.enginePath` and *Rigline: Show Plugins*.
- `rigline`'s README lists `watch` and `vscode-setup`, gives `npm create rigline-plugin` the
  directory it needs, and says `remove` deletes whatever is in `~/.rigline/plugins` under that name.
- On macOS and Linux, the companion no longer runs the engine in the directory VS Code was started
  from. After `code .` in a plugin workspace, it took that workspace's `generated.ts` for its
  record of Claude Code's identifiers, rewrote it after each Claude Code update, and said it needed
  you.
- On Windows, an engine that crashed while injecting could leave its lock held for good, once
  Windows gave its process id to some other process, and every install from then on waited and
  refused. A lock held ten minutes is now taken whatever its process id says.
- `rigline add` refuses a plugin package holding two files that are one file on Windows or macOS,
  such as `Index.js` and `index.js`, or a name Windows cannot hold, such as `con.js` or one ending in
  a dot. Such a plugin installed on one platform and broke on another.
- **For plugin authors:** a manifest whose `entry` is a test file, or under `node_modules` or a
  dot-directory, is refused by name. Rigline never copies those, so it passed every check and then
  failed to load.
- `rigline list` says when it cannot read a plugin's record in `~/.rigline/sources.json`, as the
  other commands do, where it showed that plugin as placed by hand with no reason.
- **For plugin authors:** `rigline build` and `rigline dev` find rolldown in the plugin's workspace.
  They looked only beside the engine, which `rigline` installs without it, so they always failed and
  said to add rolldown to a workspace that already had it.
- **For plugin authors:** `rigline codegen --check` reads a `generated.ts` checked out with Windows
  line endings as up to date, and `rigline install` no longer rewrites one over line endings alone
  and then says it needs you. Both compared bytes, so on Windows the file was always out of date.
- **For plugin authors:** `create-rigline-plugin` scaffolds a `.gitattributes`, so git keeps LF in
  the repository and each platform's own endings in a checkout, as Rigline's own repository does.
- **For plugin authors:** an ambiguous anchor in the anchor table no longer fails `rigline codegen`
  in your workspace. It is noted, with the two ways it gets repaired, and plugins using it are
  refused on that Claude Code version as before. It failed, and said to edit a file your workspace
  does not have.
- **For plugin authors:** a scaffolded workspace's `pnpm typecheck` covers the plugin's tests,
  which it left out, so a type error in a test passed CI. The release workflow's dry run says it
  staged nothing and lists what it would have, where its summary said the versions awaited
  approval.
- `rigline layout` says where else an element can go as "before footerSpacer or in rigRow", where it
  said "can also go rigRow". `layout place` offers `default` when it refuses a place, and `layout
  order` no longer does, since it refuses `default`.

## 1.0.0-alpha.13 — 2026-09-27

### Added

- `rigline` says when a newer `rigline` is out. Nothing updates the command itself, so when the
  engine it installed is newer, every command starts with one line on stderr — `rigline 1.0.3 is out,
  and this is 1.0.1: npm i -g rigline@1.0.3` — and `rigline --version` says it too. It asks nothing
  of the registry to know.
- **For plugin authors:** `rigline install --verbose` names any of Claude Code's classes spelled out
  in a script or stylesheet your plugin ships, such as `modelPill_gGYT1w`, and says what to reach
  it through instead. Such a name changes whenever Claude Code rebuilds, and outside the stylesheet
  handed to `ctx.style` nothing else would tell you.

### Changed

- **Install the new `rigline` before using this engine**: `npm i -g rigline@latest`. Fetching
  plugins moved from `rigline` into the engine, so fixes to `add` and `update` now arrive with an
  engine update rather than a new `rigline`. An older `rigline` cannot `add` from npm, or update a
  plugin from npm, with this engine.
- `rigline update` always ends with an install, and its report, where before it installed only
  when the engine or a plugin had moved. An install that changes nothing writes nothing.
- `rigline add NAME` takes a directory called `NAME` holding a `rigline.json` when there is one
  where you run it, and goes to npm otherwise. Before, a bare name always went to npm.
- **For plugin authors:** `ctx.style(css)` disables the plugin when the stylesheet names one of
  Claude Code's classes the manifest does not declare, or selects on the `class` attribute at all.
  Build the selector from `ctx.anchor()` or `ctx.cls()` and declare what you use; your own class
  names are unaffected. The error names the class and what to declare.
- **For plugin authors:** using something the manifest does not declare disables the plugin even
  when the plugin catches the error, and anything it registers afterwards is undone at once. Before,
  a caught error left the plugin running without what it had asked for, and nothing said so.
- **For plugin authors:** `@rigline/plugin-api` exports only what a plugin is written against: the
  context and the types it hands you, `definePlugin`, `store` and `storeFrom`, the manifest types, and
  the anchor names. What Rigline's own packages share — the manifest validator, the capability
  contracts, `ANCHORS`, the parsers — moved to `@rigline/plugin-api/internal`, which may change in
  any release.
- **For plugin authors:** reading a member of `ctx` that this Rigline does not have switches the
  plugin off, naming the member, wherever it happens — a timer included. Test for a member a later
  Rigline added with `"name" in ctx`. A `setup` that returns a promise switches the plugin off too:
  register everything before it returns. `ctx.style` refuses an `@import`, whose sheet nothing can
  check. `Pill` passes only `aria-*` attributes on to its element.
- **For plugin authors:** the anchor `worktreeBanner` is now `worktreeBannerName`, which is what it
  always pointed at: the worktree's name inside the banner, not the banner.
- **For plugin authors:** an element goes only where the anchor table marks a slot, which so far is
  `before` or `after` `footerSpacer`. A placement anywhere else is reported and left empty, where
  before any single element would do — including the model pill, where an element makes the
  composer footer fight itself.
- A `rigline.json` key that this version of Rigline does not know now refuses the plugin, naming the
  key, where before a key at the top level or in a `patches` entry was ignored. A plugin written for
  a later Rigline is refused rather than loaded without what it needs. `$schema` is still allowed.
- `rigline list --json` prints `{ "v": 1, "plugins": [...] }` rather than a bare array, in a shape
  now kept for the whole of 1.x; [docs/stability.md](docs/stability.md) lists the fields. `origin`
  is `bundled`, `home` or `checkout`, where it was a label or a path, and `dir` has the path.
  `source` holds the kind, and for npm the package, version and tag, where it was the whole record.
  `managed` is gone: it is `origin: "home"`.
- `rigline status` and `rigline restore` refuse an argument they do not take, as every other
  command does. Before, they ignored it.
- A key in `~/.rigline/config.yaml` that Rigline does not know is named under what needs you,
  where before it was ignored. It is a typo, or a setting from a later Rigline.
- After `rigline restore`, Rigline stays out until you put it back, and the companion reads *needs
  you* meanwhile. Before, the companion injected again at the next window reload, so the recovery
  from a blank panel lasted one reload. Any command you run that injects puts it back: `rigline
  install`, or `rigline disable NAME` to leave out the plugin at fault.
- `rigline vscode-setup` and `rigline update` install the companion into VS Code alone, since VS
  Code's own extensions are the only ones Rigline injects. A companion already in another editor —
  Insiders, VSCodium, Cursor or Windsurf — or in a portable VS Code or a remote window now reads
  *Rigline: not in this editor* and does nothing. Before, it injected VS Code's Claude Code from
  there and could show green over a panel it never touched. Uninstall it from those whenever you
  like.
- The companion needs VS Code 1.90 or newer, where it said 1.75. It could not fetch the engine on
  anything older than 1.82, and Claude Code itself needs 1.94.

### Removed

- `rigline install --payload`, which nothing a person does needs.
- **For plugin authors:** the anchors `branchPill`, `repoPill` and `focusNavTab`. Each named
  something other than its description — two confirmation dialogs and the question prompt — and
  no plugin used them. A name is kept for the whole of 1.x once it ships, so they go before it does.

### Fixed

- On Windows, the companion no longer opens a terminal window for a few seconds each time it runs
  Rigline: when a window starts, when Claude Code updates, and on *Show Plugins* and Save.
- A plugin whose `rigline.json` does not hold up no longer stops `rigline install`, `check` or `list`
  for every other plugin. It is left unloaded and named under what needs you, and the rest load.
- `rigline add` from npm, and `rigline update`, say which package and version a plugin came from,
  where they named a temporary directory.
- A transcript row the panel reuses for a different message — which happens to every row once a long
  session passes 600 messages — no longer keeps the previous message's identity, so time-marks no
  longer shows the old message's time on it. A plugin decorating rows sees the message the row
  actually shows.
- A `~/.rigline/config.yaml` that does not hold stops `rigline install` before it writes anything.
  Before, it stopped after the first extension version's payload had been rewritten, leaving that
  version half updated.
- The first `rigline list --json` on a machine is JSON: the line saying the engine is being
  installed goes to stderr.
- A mistyped flag prints one line saying so, where it printed a stack trace.
- `rigline restore` goes on past a Claude Code directory VS Code did not finish deleting, and names
  it. Before, it stopped there and left every version after it patched.
- `rigline restore` no longer blanks a working panel when a version's backup is missing. It takes
  Rigline's two lines out of the bundle itself, and leaves Rigline's files wherever the bundle still
  loads them. `rigline install` no longer records a bundle that carries Rigline as the extension's
  own bytes when the backup is missing.

## 1.0.0-alpha.12 — 2026-09-26

### Added

- The companion extension updates itself. When the engine it runs carries a newer companion, it
  installs that one into its own VS Code profile, and the new version takes over the next time
  extensions restart; it never restarts anything itself. Run `rigline vscode-setup` once more to
  get a companion that does this. A companion pointed at a checkout with `rigline.enginePath` does
  not update itself.
- `rigline doctor` says whether each installed companion is the one the engine carries.
- `--verbose` on `rigline install`, `check` and `watch`, for the detail the shorter report leaves
  out: extension paths, harvest counts, each host patch, and everything that moved since the last
  install.
- `~/.rigline/drift.txt`, the full list of what changed inside Claude Code the last time
  `rigline install` found anything had.
- A `companion` block in `~/.rigline/config.yaml`. `skipProfiles` lists VS Code profiles the
  companion is never put into, and `everyProfile: false` keeps it to the default profile.
  `rigline vscode-setup --remove --profile NAME` takes it out of one profile and adds that profile
  to the list, and `--profile NAME` puts it back.
- `@rigline/plugin-api`: `Pill` takes a `ref` and ARIA attributes, and passes the click event to
  `onClick`, so a pill can open a popup of its own and say so to a screen reader.

### Changed

- `rigline vscode-setup` installs the companion into every VS Code profile that has Claude Code,
  rather than only the default one, and lists each profile it installed into. Before, a workspace
  bound to another profile ran without the companion, and nothing said so. `--remove` takes it out
  of every profile. A `--profile` name that no profile has is refused, naming the ones there are.
- `rigline update` adds the companion to any VS Code profile that has Claude Code without it, in
  every editor where the companion is already installed.
- The companion does the same for its own editor each time a window starts, and says so in its
  output channel. Uninstalling it from a profile through the Extensions view is therefore undone;
  disable it there instead, or list the profile in `companion.skipProfiles`. It adds nothing in a
  remote window, or while `rigline.enginePath` is set.
- `rigline vscode-setup` installs the companion extension outside Settings Sync. Synced, it was
  carried to your other machines, where VS Code looks for it on the Marketplace, and nothing of
  Rigline's is published there. Run `rigline vscode-setup` again to move an existing install over.
- The report from `rigline install`, `check` and every command that re-injects is shorter, and ends
  with what matters: what to reload, then anything that needs you, last. Versions in the same state
  share a line.
- The reload advice matches what the command changed: *Reload Window* when `extension.js` changed,
  *Reload Webviews* when only Rigline's files did, and nothing to reload when nothing changed.
- A plugin whose required host patch does not apply is reported as refused, as the panel already
  treated it, and not listed as loading. An optional host patch that does not apply now needs you,
  as a missing optional dependency does, so the exit code is 1.
- `rigline update` moves every plugin first and injects once, so it prints one report, after what
  moved. A plugin whose update landed is no longer reported as failed because something else in
  the report needs you.
- A `~/.rigline/token` that holds no token is listed under what needs you, since Save in the panel
  copies commands until it is deleted.
- `rigline install` keeps working if Claude Code's build starts writing strings with single quotes
  or backticks. Before, every version would have been refused.
- When Claude Code's React changes in a way Rigline cannot read, only plugins that decorate the
  transcript are refused, each saying what is missing. Every other plugin keeps working. Before,
  `rigline install` stopped at that version of Claude Code, and no plugin loaded there.
- A plugin that declares `transcript` under `uses.optional` now loads and goes without it where this
  version of Claude Code cannot serve it. Before, calling `decorateTranscript` disabled the plugin.
- `@rigline/plugin-api`: `IdentifierTables.react` carries `missing`, and its `version` may be null.
- Rigline keeps working when Claude Code moves to React 19, including plugins that decorate the
  transcript. Before, `rigline install` would have refused that version of Claude Code.
- What moved since the last install now reports react-dom's version rather than the React names
  Rigline checks for. The first install after upgrading Rigline therefore says the React layer
  moved. Nothing in Claude Code did.
- A version of Claude Code that Rigline cannot read, or that is still being written, no longer stops
  `rigline install`, `check` or `watch` for the others. It is left as it was and listed under what
  needs you, with the reason, where before the command ended in a stack trace. `rigline watch` tries
  a version that was still being written again on its next look.

### Fixed

- With more than one VS Code window open, a Claude Code update no longer leaves every window but
  one showing *Rigline: needs you*. Each window's companion ran Rigline at once, and one run's
  writes looked to the other like the update still being written. Rigline now injects one run at a
  time: a command that finds another running waits for it, says so, and then finds everything
  already current.
- The RIG pill now matches the other pills in the composer footer in height and shape, and sits
  level with them. Before, it was smaller, squarer, and sat slightly low.

## 1.0.0-alpha.11 — 2026-09-25

### Added

- **Rigline's menu.** The RIG pill in the composer footer is now Rigline's own, and clicking it
  opens a menu that plugins add to with `ctx.menu(Component)` — a React component, declared as
  `"menu": true` in `uses`. A component that throws disables only its own plugin. The pill still
  shows how many checks are failing, and the diagnostics that used to open from it are now in the
  menu.
- **Menu components.** `MenuItem`, `Submenu` and `MenuNote` in `@rigline/plugin-api/ui` build a
  menu entry that draws in the app's own colours. The menu works from the keyboard across every
  plugin's entries: the arrows move, Enter or Right opens a submenu, Left or Escape goes back, and
  Escape closes the menu without reaching the app. Each plugin's entries sit together, with a
  divider between plugins.
- **Elements.** A plugin declares components under `elements` in `rigline.json` — a title, the
  places each may go and where it goes by default, or `null` for off — and renders each with
  `ctx.element(id, Component)`. A place is beside or inside an element the anchor table names, or
  `rigRow`, a new row at the foot of the composer box, under its controls, which appears only while
  something is in it. A place this version of the extension cannot provide is reported at install
  and on the diagnostics panel, and costs the plugin that element and nothing else.
- **Your layout.** `layout` in `~/.rigline/config.yaml` moves an element to another place its plugin
  allows, orders the elements in a place, or switches one off, and leaves everything you have not
  mentioned where its plugin put it. `rigline install` and `rigline check` name any entry that does
  not work, and leave that element where its plugin puts it. See [docs/config.md](docs/config.md).
- **`rigline layout`** lists every plugin's elements by where they are, marking those your layout
  put there and where else each may go. `rigline layout place ELEMENT WHERE` moves one — `WHERE`
  being a place such as `rigRow` or `before footerSpacer`, `off`, or `default` to undo a move —
  `rigline layout order` sets the order in a place, and `rigline layout reset` empties the layout.
  Each keeps your comments and re-injects. `rigline list` and `rigline add` say when an element has
  been moved or switched off.
- **Arrange the panel from Rigline's menu.** Layout lists every element by where it sits — the
  footer, the Rigline row, or off — and moves one before or after its neighbour, to another place
  its plugin allows, off, or back to its plugin's default, live in the panel behind the menu. Save
  writes the result to `~/.rigline/config.yaml` through the companion extension, keeping your
  comments, and its notification says if that replaced a change made since the panel loaded.
  Without the companion, Copy commands gives you the `rigline layout` commands that do the same.
  Reload saved layout picks up a layout saved from another panel or a terminal without reloading
  anything. `rigline install` now makes `~/.rigline/token` once, which a Save carries so the
  companion knows it came from your own panel; see [docs/config.md](docs/config.md).
- **Edit the layout on the panel itself.** Edit in place, under Layout in Rigline's menu, puts a
  handle over each element. Drag a handle to any place its plugin allows — the places it can go are
  outlined, and a marker shows where it will land — or onto the bar to switch it off. Choosing a
  handle, with a click or with Enter, opens the same moves as the Layout submenu instead. `rigRow`
  shows while you edit, even with nothing in it, and a tray lists the elements that are switched off
  or have nowhere to go in this panel; drag one out to put it somewhere. A bar above the composer
  holds Save, Revert changes and Done, and a save the panel sees land ends the editing.
- **Two buttons of Rigline's own** in the Rigline row under the composer: one starts editing the
  layout in place, the other reloads the saved layout. They are elements like any plugin's —
  `rigline/edit` and `rigline/reload` — so you can move them, reorder them or switch them off the
  same way.
- `Pill` in `@rigline/plugin-api/ui`: a rounded label in the app's own pill colours, like the model
  picker's, and a button when given `onClick`.
- The `composerBox` anchor: the composer's bordered box.
- Stores, for state a plugin keeps outside its components: `store(initial)` and
  `storeFrom(ctx.onSessionId, null)` in `@rigline/plugin-api`, and `useStore` to read one from React
  in `@rigline/plugin-api/ui`. A store made in `setup` catches what the panel replays from boot,
  which an effect in a component runs too late for.
- `rigline.enginePath`, a companion setting for developing Rigline itself. It names an engine for the
  companion to run in place of the released one, so the companion stops putting the released payload
  back over your build every time VS Code starts, and Save runs your code. `rigline vscode-setup` run
  from a checkout prints the line to set, and the status bar reads *Rigline (dev)* while it is set.

### Changed

- **Your settings are now `~/.rigline/config.yaml`**, a YAML file meant to be edited by hand as well
  as by `rigline disable` and `rigline enable`, which keep your comments. Where each plugin came from
  is recorded separately, in `~/.rigline/sources.json`, which is not for editing. The first command
  that needs them splits an existing `~/.rigline/config.json` into the two and removes it. What the
  file holds is in [docs/config.md](docs/config.md).
- **session-id**: the pop-up of identifiers has moved into Rigline's menu, under Session
  identifiers, where choosing one copies it. A plain click on the badge now copies the full session
  id, which used to take alt-click or shift-click.
- **time-marks**: the clock icon in the composer footer is gone; the feature is switched on and off
  from Time markers in Rigline's menu, and remembers the choice as before.
- `rigline build` no longer bundles `react`, `react/jsx-runtime`, `react-dom` or
  `@rigline/plugin-api/ui`. The panel now serves one copy of each — React 19 — that every plugin
  shares, and `rigline install` points a plugin's imports at it, so a plugin that bundled its own
  React should rebuild. `rigline build` also compiles JSX, and builds `src/index.tsx` when there is
  no `src/index.ts`. `@rigline/plugin-api` lists React and React DOM as optional peer dependencies,
  needed only by a plugin that uses `/ui`.
- `create-rigline-plugin` scaffolds a plugin in TSX: its badge is an element declared in
  `rigline.json` and drawn with `Pill`, and the plugin depends on React and React DOM for its types
  and tests.
- `rigline install` and `rigline check` now name a plugin that imports a package it did not bundle
  as refused, since the panel cannot load it, rather than leaving you to find the error in the panel.
- `rigline check` now names a switched-off plugin that is not installed, as `install` already did.
- A plugin can no longer be called `rigline`, the name Rigline's own elements are listed under.
- A plugin that calls `acquireVsCodeApi()` now gets the error VS Code itself gives a second call,
  since the app has already made the first. A plugin reaches the panel's messages through `ctx`.

### Fixed

- A plugin that bundles its own copy of React no longer breaks transcript decorations for every
  plugin in the panel. Rigline now keeps to the app's own renderer, and the diagnostics report says
  when another has loaded.
- The RIG pill no longer flashes a failing check while the panel is resized. Rigline puts its
  decorations back a frame after the app moves them, and a node being put back no longer counts as
  out of place; one still out of place a second later does.
- A button a plugin places in the composer footer no longer sends the prompt when clicked, and
  Enter in a text field a plugin places there no longer sends it either. The footer is inside the
  composer's form, where a button with no `type` submits.

## 1.0.0-alpha.10 — 2026-09-23

### Added

- The companion adds **Rigline: Show Plugins** to the Command Palette, which lists what's
  installed and enabled without needing a terminal. Read-only: changing which plugins are on
  still needs `rigline enable`/`disable`.
- The companion offers a reload when it patched Claude Code too late for this window, and never
  takes one by itself. If the extension host came up over an unpatched extension — a host
  restart, or a window reload that beat the injection — the panel in front of you has no plugins
  until something reloads, and until now nothing said so. It now asks once, saying that the
  reload ends any turn running in the window, and leaves the offer in the status bar if you say
  no; clicking it there asks again rather than reloading. A changed `extension.js` asks for a
  window reload instead, because a webview reload cannot pick one up.

  The ordinary weekly update asks nothing, and deliberately: the patch lands in a directory this
  window has not loaded, so nothing in front of you is stale and there is nothing to offer.
- The companion's status bar reads **Rigline: ready to restart** once it has patched a newly
  installed Claude Code version in the background, and stays that way until you restart, instead
  of settling back to the same look it had before anything happened. A glance now tells you
  whether it has caught up. The window you're in keeps running the old version, so restart
  extensions or reload the window whenever it suits you.

### Fixed

- `rigline install` refuses an extension directory whose files are all present but still being
  written, as well as one with files missing. The half it could not see before is the one that
  matters: a bundle still growing is recorded as the pristine backup, so `restore` afterwards
  returns a fragment and the extension is broken in a way that looks like Rigline broke it — with
  nothing reported at the time or later. It now samples sizes and modification times a quarter of
  a second apart and refuses if anything moved, naming the file and saying an update is probably
  in progress. Every install pays that quarter second.
- `rigline vscode-setup` takes `--profile NAME`, and says which profile it installed into.
  VS Code extensions belong to a profile and the CLI installs into the default one, so if the
  workspace you use is bound to any other profile the companion was installed, listed by
  `code --list-extensions`, present in the extensions directory — and completely invisible to
  your window, with every check agreeing it was there. The report now names profiles as a
  cause, because the one it named before (a second editor answering to the same `code`) is a
  claim somebody using profiles can check, disprove, and be left with nowhere to go.
- `rigline install` no longer exits non-zero just because a plugin changed `extension.js`.
  A host patch is work the run just did, not a problem somebody has to fix, and the reload it
  asks for is already said twice in the report. Since a bundled plugin patches the host, an
  install into a freshly updated extension — which is every weekly update — exited 1 having
  succeeded completely. Nothing else moves: a drifted anchor, a refused override or an
  unresolvable table still want a person and still exit 1.
- The companion stops reporting a successful install as a failure, and offers the reload it
  used to swallow. It read the exit code as the whole story, so the case above painted
  `Rigline: install failed` over a working install and returned before working out whether
  this window needed reloading — which meant the window-reload prompt could never appear in
  the one situation it exists for. It now decides that from the bytes on disk, so it is right
  even against an older engine, and a non-zero exit says `Rigline: needs you` instead.
- The companion puts the engine's own report in its output channel. It ran the engine with
  inherited stdio, which from inside the extension host reaches a stream VS Code keeps no log
  of — so everything the engine said was discarded, including on the runs where the status bar
  then said to go and read it. Whatever `rigline install` would have printed in a terminal now
  appears under Output -> Rigline, a line at a time.
- The companion now notices an extension update while your window is still running, instead of
  waiting for the next reload. It watched the directory VS Code reports for the running
  extension, which is fixed until the extension host restarts — so an update wrote a new
  directory, the companion compared a value that could not have changed, and nothing happened
  until you reloaded. It reads the installed directories from disk now, which is the signal
  `rigline watch` always used, so the patch lands behind the old extension and your next reload
  comes up with Rigline already there.
- `rigline install` writes only what is not already right, and says when it wrote nothing. The
  loader itself was already left alone when the bytes matched; everything beside it — the
  payload, the baked registry, the identifier tables and every installed plugin — was rewritten
  on every run, and `plugins/` was deleted and copied back whole. So re-injecting after an
  extension update rewrote every installed version, including ones that were already exactly
  right and one of which a live panel was reading from. Each file is now compared before it is
  written, plugins are reconciled file by file rather than replaced, and a version that needed
  nothing reports `already current, nothing written`.

## 1.0.0-alpha.9 — 2026-09-22

### Fixed

- `rigline vscode-setup` works on Windows. It never had: Node refuses to `spawn` a `.cmd`
  directly since the BatBadBut fix, and VS Code ships its CLI as `code.cmd`, so the command
  died with `EINVAL` before any editor was touched. A batch file now goes through `cmd.exe`
  the way npm does.
- `rigline vscode-setup` names the editor binary it installed into, and the VSIX. One machine can
  hold several editors that answer to `code` and share nothing else — a second install, a
  remote window, Insiders beside stable — and `--install-extension` will succeed into the one
  you are not looking at, leaving an extension the CLI lists and the editor has never heard
  of. Saying which binary and where the VSIX is turns that from a mystery into a sentence.
- The companion declares that it needs a trusted workspace, and its VS Code floor drops to
  1.75. Saying nothing about workspace trust is itself a choice, and the worst one available:
  VS Code disables an undeclared extension in an untrusted workspace while still listing it as
  installed, so the symptom is an extension that is present, enabled, compatible and entirely
  silent. The floor was a guess at `^1.90.0` and nothing needed it — an output channel, a
  status bar item and `extensions.onDidChange` are all long-standing API.
- The companion's status bar no longer reports success when there is nothing to inject into.
  Installing it before the Claude Code extension left a green `Rigline` badge over a Rigline
  that had done nothing, because the engine's `install` exits 0 when no extension is present
  — correctly, since nothing to do is not an error. The companion now asks the editor rather
  than reading the exit code, and says `Rigline: no Claude Code` until there is something to
  work on.

## 1.0.0-alpha.8 — 2026-09-21

_1.0.0-alpha.7 was tagged and never published: its staging run failed, and a version cut on a red
tree cannot be retried on the same number. Everything below was meant for it._

### Added

- `rigline vscode-setup`, an optional companion extension that watches for a Claude Code update and
  re-injects behind it, so running `rigline install` after every one stops being something you have
  to remember. It goes into every VS Code found on `PATH`, Insiders, VSCodium, Cursor and Windsurf
  included, from a VSIX that ships inside the engine: nothing is downloaded, and the companion moves
  when the engine does. It injects as it goes, so it is a step *instead of* `install` rather than
  after it. **Nothing about `rigline install` changes, and declining the companion costs nothing** —
  the CLI is complete on its own and stays the right answer if you would rather not add an extension
  or cannot install one. `--remove` takes the companion out and leaves your injection alone;
  `rigline restore` is what undoes that. Where no editor command-line tool is on `PATH`, it says so
  and names the Command Palette alternative rather than installing anything itself.

- A plugin policy, at [docs/plugin-policy.md](docs/plugin-policy.md). Rigline modifies Anthropic's
  extension and now publishes a compliance position about what it does and does not do; a plugin
  runs inside that modification, so the policy sets out what is asked of an author — no deception,
  no reaching for credentials, no carrying conversation content off the machine, and host patches
  kept to switching on a capability the extension already has. It also says what is *not* asked,
  because the webview has no network egress, no filesystem and no route into the extension host, and
  what we do not police: there is no source review and no claim of one.
- `create-rigline-plugin` points at that policy — in the generated workspace README and in the
  next-steps output after scaffolding. Both say it applies whether or not you ever publish: a plugin
  you wrote for yourself modifies Anthropic's extension exactly as much as a published one does, and
  a policy filed under "before you publish" is one a personal-plugin author never reads.
- Every published package's README says what Rigline modifies and links the relevant page — the
  compliance account on `rigline` and `@rigline/core`, the plugin policy on `@rigline/plugin-api`
  and `create-rigline-plugin`. The npm page is what somebody reads before installing, and it was
  the one surface saying nothing.
- `rigline add` says the choice is yours. After the capabilities and host patches it lists, it now
  notes that installing a plugin is your call rather than Rigline's, and that Anthropic's terms
  apply to what the plugin does, with a link to the policy. `add` is the only command that installs
  somebody's judgement rather than ours — including your own, on a plugin you wrote for yourself.

### Fixed

- `rigline install` refuses an extension directory that is still being written, instead of recording
  part of it as the backup. Running it while VS Code was mid-update could make a half-written bundle
  the pristine copy `rigline restore` returns to — silently, since the backup then looks like any
  other, and the harvest reads a prefix without saying so. It now names what is missing and says an
  update is probably in progress, before reading or writing anything.
- `rigline update` on a machine with no engine yet no longer refuses the engine as too young and
  then installs it anyway. The release-age gate is about staying on what you have, so it does not
  apply when there is nothing to stay on: a first run takes what the tag resolves to and says
  `engine: installed <version>`, where it used to say `engine: staying on undefined` and then
  contradict itself two lines later. It also re-injects afterwards now, which the contradiction was
  suppressing — so `rigline update` on a fresh machine leaves the extension patched rather than
  untouched.
- `rigline update` with no third-party plugins says the bundled ones move with the engine, rather
  than `no plugins are installed` when four of them are.
- A workspace scaffolded by `create-rigline-plugin` can install the release that scaffolded it.
  `pnpm install`, the first command its README gives, was refusing `@rigline/core` and
  `@rigline/plugin-api` with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` for the first day after any
  release, because the scaffolded workspace applies a release-age gate and the dependency ranges it
  writes have no older version in them to fall back on. It now exempts those two versions by name,
  and nothing else: every other dependency is gated exactly as before.

## 1.0.0-alpha.6 — 2026-09-21

### Changed

- `rigline` is now a small retrieval layer over `@rigline/core`, which it installs into
  `~/.rigline/engine` on first use and runs from there. Every verb works exactly as before and
  `rigline` is still the only command to type — what changes is that the two can move independently,
  and `rigline update` now brings the engine itself up to date alongside your plugins. Installing
  takes a few seconds the first time and needs the registry; after that nothing phones home unless
  you ask it to. If anything goes wrong there, delete `~/.rigline/engine` and run any command again.
- `rigline update` takes `--tag` to follow a preview line for the engine instead of `latest`, and
  re-injects after moving the engine even when no plugin moved.
- `rigline` no longer belongs in a project's dependencies. A plugin workspace declares
  `@rigline/core` and runs `rigline-engine build`, and `create-rigline-plugin` scaffolds it that
  way. An existing workspace keeps working by making the same swap: `@rigline/core` in place of
  `rigline`, and `rigline-engine` in the `build` and `codegen` scripts.

### Added

- `rigline --version` prints the command's own version and the engine's, without installing
  anything or reaching the network — so it still answers when something is already wrong.
- `rigline list --json` emits the same listing as data, for anything driving Rigline rather than
  reading it.
- `@rigline/core` carries a `rigline-engine` command. It is what `rigline` runs, and not a surface
  you are asked to type.

### Fixed

- The probe's copied report no longer says a meter is still busy when it has gone quiet. The "now"
  rate beside each peak was the last second in which anything happened, so a burst at boot went on
  being reported as sustained load for as long as the panel stayed open — on the session list, an
  idle panel claimed 18 tap clones a second. A rate with nothing behind it now reads as zero; the
  peak, which is a fact about the session rather than about this second, is unchanged.

## 1.0.0-alpha.5 — 2026-09-21

### Fixed

- `npm install -g rigline && rigline install` now injects. No published package carried the loader
  or a plugin, so it failed with `payload is missing pre.js` and the only way to get a working
  install was to clone the repository. `@rigline/core` now ships the loader and the four first-party
  plugins, and a new test installs the published tarballs into a clean prefix and runs `install` out
  of it, so this cannot come back unnoticed.

### Added

- session-id, time-marks, worktree-prefix and the `RIG` diagnostics badge are bundled with
  `@rigline/core`, so a fresh install has them. They are discovered where they are rather than
  copied into `~/.rigline/plugins`, which means an update to Rigline is an update to them; your own
  plugin of the same name installs over one and wins, so a broken one can be replaced without
  waiting for a release.
- `rigline disable NAME` and `rigline enable NAME`. This is how you decline a bundled plugin: there
  is nothing to delete, and `rigline remove` now says so and sends you here. Both re-inject, so the
  change takes effect on the next webview reload.
- `rigline list` shows each plugin's version and says which of the bundled ones you are overriding.
- The injected payload records the version of Rigline that wrote it, so `rigline doctor` can say
  whether what is installed in the extension is what your Rigline would write now, `rigline check`
  says which version is running a payload left by an older one, and the probe's copied report names
  it. An upgrade that you forgot to follow with `rigline install` used to look identical to one you
  did.

### Changed

- `rigline` no longer depends on rolldown, which it only ever used for `rigline build`. The download
  is about 20 MB smaller. A plugin workspace scaffolded by `create-rigline-plugin` now declares
  rolldown itself; an existing one needs `pnpm add -D rolldown`, and `rigline build` says so by name
  if it is missing.

## 1.0.0-alpha.4 — 2026-09-21

### Added

- `ctx.check(name, run)`: a plugin contributes its own line to the diagnostics panel, grouped under
  its own name. It declares nothing, and the host hands it nothing — your own state answers it. The
  host calls it about once a second, so read state you already keep rather than computing an answer.
  A check that throws shows as a failing line naming your plugin and never disables it.
- The panel groups every line by who contributed it: the host's own under `core`, then each plugin.
  A plugin that has quietly stopped working can now say so, where before the badge stayed green.
- Scaffolded plugins ship with a check, so a new plugin starts with one rather than adding it after
  the first silent failure.
- A changelog, and `pnpm release <increment>` to cut and push a version with one command. A pushed
  tag starts the release; `pnpm release:finish` approves it, moves `next` if the release is ahead of
  it, and creates the GitHub release.
- CI on every push and pull request, over Node 22.12.0, 24 and 26 on Linux plus 22.12.0 on Windows.
- Scaffolded plugin workspaces ship a CI workflow alongside the release one, so an author's tests
  run on a pull request rather than first running during a release.
- Dependabot watches the GitHub Actions pins, one grouped pull request a week.

### Fixed

- `ctx.watch` no longer waits for an anchor the extension does not render on the current surface. It
  watches nothing and tears down cleanly, as it already did for an optional anchor the extension has
  not got, so a plugin that spans surfaces is not reported as broken on the one where its decoration
  was never going to appear.
- The diagnostics badge no longer flashes red for a second at startup. A check asking whether a
  decoration is on screen now says "not yet" until the host has had a chance to place one.
- session-id no longer loads on the session list, which has no composer footer for its badge.
- `ctx.decorateTranscript` no longer starts the transcript sweep on a surface that renders no
  transcript rows. The session list had been searching for rows once per React commit, for the life
  of the window, on a page that cannot have any.

## 1.0.0-alpha.2 — 2026-09-20

### Added

- `create-rigline-plugin` scaffolds a workspace that is ready to publish: a release workflow, the
  `rigline-plugin` keyword a plugin is discovered by on npm, and `publishConfig.access`.

### Fixed

- Published to `latest` as well as `next`, correcting a `latest` left pointing at `1.0.0-alpha.0`
  by the bootstrap publish — which `npm create rigline-plugin` resolves, so the documented command
  had been producing a scaffold that a later version already fixed.

## 1.0.0-alpha.1 — 2026-09-19

### Fixed

- The published packages no longer ship source maps referring to sources that are not in the
  tarball.
- The CLI reports its own version from its manifest rather than from a constant that could drift
  out of step with it.

## 1.0.0-alpha.0 — 2026-09-19

First publish: the injector and host runtime, the capability-scoped plugin context, the CLI, and
the scaffolder.
