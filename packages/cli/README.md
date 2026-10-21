# rigline

**Make Claude Code's VS Code panel your own.** [Rigline](https://github.com/Rigline/Rigline) builds
on the panel Claude Code ships with rather than replacing it, and lets you add to it, rearrange it
and switch off what you don't need. Out of the box it keeps your context size and your five-hour and
weekly limits in view, puts your favourite model and effort one click away, stamps the time on every
step, and more. What it doesn't do yet, a plugin can.

<p align="center">
  <img src="https://github.com/Rigline/Rigline/raw/main/docs/media/hero.webp" width="800" alt="Claude Code's panel with Rigline's rows under the composer. The layout is edited in place: the session's cost is dragged onto a new row, the messaging address into the bar to switch it off, and the layout is saved.">
</p>

    npm install -g rigline
    rigline install

Then *Developer: Reload Window* from the Command Palette. It puts itself back after each of Claude
Code's weekly updates, and `rigline restore` returns the extension to the bytes it shipped with,
needing nothing but Node.

> Rigline modifies Anthropic's extension, on your machine.
> [What it does and does not do](https://github.com/Rigline/Rigline/blob/main/docs/anthropic-compliance.md):
> no credentials, no network calls from the panel, no rerouting of Claude usage.

[The repository](https://github.com/Rigline/Rigline#what-you-get) has what comes with it, and how
to make it yours.

## What install does

The first command you run fetches the engine, [`@rigline/core`](https://www.npmjs.com/package/@rigline/core),
into `~/.rigline/engine` and runs it from there. It takes a few seconds and needs the registry. If
that directory is ever in a bad state, delete it and run any command again.

`install` puts Rigline's companion extension into every VS Code profile that has Claude Code, then
finds every installed version of the extension, harvests it, bakes the discovered plugins into a
payload and injects the loader. It keeps a byte-faithful backup of each bundle it touches, and
`rigline restore` puts everything back using nothing but Node and the backup. Reload the window
afterwards, which starts the companion.

**Where it works:** VS Code 1.90 or newer on Windows, Linux and macOS, in a local window, with Node
22.12 or newer. **Not supported yet:** remote windows, other editors built on VS Code, a portable
VS Code, and a custom extensions directory. In any of them, Claude Code's panel stays as it ships.
[Where Rigline works](https://github.com/Rigline/Rigline/blob/main/docs/support.md) lists each, and
how to ask for one.

## The companion

The companion is the part of Rigline that lives in VS Code. The extension updates about weekly, and
an update installs a fresh directory, which reverts the injection; the companion re-injects behind
it, so there is nothing to remember. It also saves what you change in the panel, and moves the
engine once a newer one is a day old, asking npm's registry each time a window starts.

`install` puts it in from a VSIX that ships inside the engine, so nothing is downloaded, through VS
Code's `code` command on your `PATH`. On macOS, add that with *Shell Command: Install 'code' command
in PATH* from the Command Palette. Every command that injects keeps the companion in every profile
that has Claude Code, and current there.

`rigline uninstall` is how you leave: it restores every version, takes the companion out of every
profile, and says what is left to you.

## Commands

    rigline install    the companion where it is missing, then inject every version, bake plugins,
                       report drift, record the baseline
    rigline check      the same report, writing nothing
    rigline status     per version: vanilla or patched, by backup
    rigline restore    every version back to the extension's own bytes
    rigline uninstall  restore, take the companion out of VS Code, and say what is left to you

    rigline add SPEC   install a plugin from a directory or npm, and re-inject
    rigline remove N   delete a plugin from ~/.rigline/plugins, and re-inject
    rigline disable N  switch a plugin off, and re-inject
    rigline enable N   switch it back on, and re-inject
    rigline update     move the engine and every npm plugin to what its tag resolves to
    rigline list       every plugin, in load order: version, origin, source, switch, what it can do
    rigline layout     where each plugin's elements are; place, order or reset them, or apply a
                       preset, and re-inject

    rigline build      build a plugin to one browser ES module
    rigline dev        rebuild and re-inject as you edit
    rigline codegen    write the harvested identifier types for a plugin workspace
    rigline diff A B   identifier drift between two extension directories
    rigline doctor     install state per version, as a pasteable report

    rigline --version  this command's version and the installed engine's
    rigline --help     the whole surface, from the engine

`add` never runs a package manager for a plugin: a published plugin is one bundled ES module and a
manifest, so there is nothing to resolve. A version must be a day old before `add` or `update` will
take it, unless you pass `--now`, and a withheld version is named rather than skipped in silence. `update` applies the same rule to the engine, and says which version it moved from so
going back is one command.

## How it is put together

`rigline` is a small retrieval layer. It installs the engine and runs it, and `@rigline/core` answers
every verb above, fetching plugins included. The split is not decoration: a process cannot replace
the package it is running out of, so `update` moves the engine from here and then hands the rest to
it. Nothing updates `rigline` itself, so when the engine you have is newer, `rigline` says so and
names the command.

**It belongs in no project's dependencies.** If you are writing plugins, your workspace declares
`@rigline/core` and runs `rigline-engine`; `npm create rigline-plugin` scaffolds it that way. A
project that can declare dependencies does not need a delivery mechanism.

## Writing a plugin

    npm create rigline-plugin my-plugin

[The authoring guide](https://github.com/Rigline/Rigline/blob/main/docs/authoring.md) is the long
form. [Anchors](https://github.com/Rigline/Rigline/blob/main/docs/anchors.md) is what to read when
an extension update breaks a plugin and you would rather not wait for a release.

[Changelog](https://github.com/Rigline/Rigline/blob/main/CHANGELOG.md) — every package in this
workspace shares it, and one version number.

MIT.
