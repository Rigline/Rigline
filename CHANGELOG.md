# Changelog

All four published packages — `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin` — share this file and one version number, so an entry names the package
only where the change is specific to one.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the line is `1.0.0-alpha.*`,
anything may change between releases.

## Unreleased

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
- Stores, for state a plugin keeps outside its components: `store(initial)` and
  `storeFrom(ctx.onSessionId, null)` in `@rigline/plugin-api`, and `useStore` to read one from React
  in `@rigline/plugin-api/ui`. A store made in `setup` catches what the panel replays from boot,
  which an effect in a component runs too late for.

### Changed

- `rigline build` no longer bundles `react`, `react/jsx-runtime`, `react-dom` or
  `@rigline/plugin-api/ui`. The panel now serves one copy of each — React 19 — that every plugin
  shares, and `rigline install` points a plugin's imports at it, so a plugin that bundled its own
  React should rebuild. `rigline build` also compiles JSX, and builds `src/index.tsx` when there is
  no `src/index.ts`. `@rigline/plugin-api` lists React and React DOM as optional peer dependencies,
  needed only by a plugin that uses `/ui`.
- `rigline install` and `rigline check` now name a plugin that imports a package it did not bundle
  as refused, since the panel cannot load it, rather than leaving you to find the error in the panel.

### Fixed

- A plugin that bundles its own copy of React no longer breaks transcript decorations for every
  plugin in the panel. Rigline now keeps to the app's own renderer, and the diagnostics report says
  when another has loaded.

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
