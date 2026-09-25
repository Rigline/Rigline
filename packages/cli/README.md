# rigline

The command for [Rigline](https://github.com/Rigline/Rigline), a plugin layer for the Claude Code
VS Code extension.

Rigline injects a small loader into the installed extension's webview, gives plugins a
capability-scoped context to write against, and harvests the identifiers those plugins depend on
from whichever extension version you have installed — so an extension update is a diff to read
rather than a breakage to chase.

**This modifies files belonging to Anthropic's extension, on your machine, and that is your call to
make.** [Anthropic compliance](https://github.com/Rigline/Rigline/blob/main/docs/anthropic-compliance.md)
is a straight account of what Rigline does and does not do — no credentials, no network calls, no
rerouting of Claude usage, no redistribution — and how we read Anthropic's terms. `rigline restore`
puts every install back to Anthropic's own bytes and needs nothing but Node.

## Install

    npm install -g rigline
    rigline install

The first command you run fetches the engine, [`@rigline/core`](https://www.npmjs.com/package/@rigline/core),
into `~/.rigline/engine` and runs it from there. It takes a few seconds and needs the registry;
after that nothing reaches the network unless you ask it to. If that directory is ever in a bad
state, delete it and run any command again.

`install` finds every installed version of the extension, harvests it, bakes the discovered plugins
into a payload and injects the loader. It keeps a byte-faithful backup of each bundle it touches,
and `rigline restore` puts everything back using nothing but Node and the backup.

The extension updates about weekly and an update installs a fresh directory, which silently reverts
the injection. Run `install` again afterwards; a window that is already open keeps running the old
directory until *Developer: Reload Window*.

**That is the whole of Rigline, and it needs nothing else.** Everything below is optional.

## Optional: let an extension do the remembering

    rigline vscode-setup

If running `install` after every update is a chore, this installs a companion extension that does it
for you — into every VS Code found on your `PATH`, Insiders, VSCodium, Cursor and Windsurf included,
from a VSIX that ships inside the engine. Nothing is downloaded, and the companion moves when the
engine does. It injects as it goes, so it is a step *instead of* `install` rather than after it.

From then on it watches for the extension update and re-injects behind it, so there is nothing to
remember after one. It goes into every VS Code profile that has Claude Code, and into any profile
that gets Claude Code later; the `companion` settings in
[`~/.rigline/config.yaml`](https://github.com/Rigline/Rigline/blob/main/docs/config.md) keep it out
of the profiles you name.

**Decline it and lose nothing.** `install` remains complete on its own, and is the right answer if
you would rather not add an extension, cannot install one, or simply prefer running the thing
yourself. `rigline vscode-setup --remove` goes back to that — it takes the companion out and leaves
your injection alone, and `rigline restore` is what undoes the injection itself.

## Commands

    rigline install    inject every version, bake plugins, report drift, record the baseline
    rigline check      the same report, writing nothing
    rigline status     per version: vanilla or patched, by backup
    rigline restore    every version back to the extension's own bytes

    rigline add SPEC   install a plugin from a directory or npm, and re-inject
    rigline remove N   delete a plugin rigline installed, and re-inject
    rigline disable N  switch a plugin off, and re-inject
    rigline enable N   switch it back on, and re-inject
    rigline update     move the engine and every npm plugin to what its tag resolves to
    rigline list       every plugin, in load order: version, origin, source, switch, what it can do
    rigline layout     where each plugin's elements are; place, order or reset them, and re-inject

    rigline build      build a plugin to one browser ES module
    rigline dev        rebuild and re-inject as you edit
    rigline codegen    write the harvested identifier types for a plugin workspace
    rigline diff A B   identifier drift between two extension directories
    rigline doctor     install state per version, as a pasteable report

    rigline --version  this command's version and the installed engine's
    rigline --help     the whole surface, from the engine

`add` never runs a package manager for a plugin: a published plugin is one bundled ES module and a
manifest, so there is nothing to resolve. A version must reach a minimum age (a day, by default)
before `add` or `update` will take it, and a withheld version is named rather than skipped in
silence. `update` applies the same rule to the engine, and says which version it moved from so
going back is one command.

## How it is put together

`rigline` is a small retrieval layer. It fetches bytes — a plugin tarball, the engine — checks them,
and hands them over; `@rigline/core` does everything else and answers every verb above. The split is
not decoration: a process cannot replace the package it is running out of, so whatever performs an
update has to sit above the thing being updated.

**It belongs in no project's dependencies.** If you are writing plugins, your workspace declares
`@rigline/core` and runs `rigline-engine`; `npm create rigline-plugin` scaffolds it that way. A
project that can declare dependencies does not need a delivery mechanism.

## Writing a plugin

    npm create rigline-plugin

[The authoring guide](https://github.com/Rigline/Rigline/blob/main/docs/authoring.md) is the long
form. [Anchors](https://github.com/Rigline/Rigline/blob/main/docs/anchors.md) is what to read when
an extension update breaks a plugin and you would rather not wait for a release.

[Changelog](https://github.com/Rigline/Rigline/blob/main/CHANGELOG.md) — every package in this
workspace shares it, and one version number.

MIT.
