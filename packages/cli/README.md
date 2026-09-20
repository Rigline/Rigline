# rigline

The command-line surface for [Rigline](https://github.com/Rigline/Rigline), a plugin layer for the
Claude Code VS Code extension.

Rigline injects a small loader into the installed extension's webview, gives plugins a
capability-scoped context to write against, and harvests the identifiers those plugins depend on
from whichever extension version you have installed — so an extension update is a diff to read
rather than a breakage to chase.

## Install

    npm install -g rigline
    rigline install

`install` finds every installed version of the extension, harvests it, bakes the discovered plugins
into a payload and injects the loader. It keeps a byte-faithful backup of each bundle it touches,
and `rigline restore` puts everything back using nothing but Node and the backup.

The extension updates about weekly and an update installs a fresh directory, which silently reverts
the injection. Run `install` again afterwards; a window that is already open keeps running the old
directory until *Developer: Reload Window*.

## Commands

    rigline install    inject every version, bake plugins, report drift, record the baseline
    rigline check      the same report, writing nothing
    rigline status     per version: vanilla or patched, by backup
    rigline restore    every version back to the extension's own bytes

    rigline add SPEC   install a plugin from a directory or npm, and re-inject
    rigline remove N   delete a plugin rigline installed, and re-inject
    rigline update     move each npm plugin to what its tag resolves to
    rigline list       every plugin, in load order: origin, source, switch, what it can do

    rigline build      build a plugin to one browser ES module
    rigline dev        rebuild and re-inject as you edit
    rigline codegen    write the harvested identifier types for a plugin workspace
    rigline diff A B   identifier drift between two extension directories
    rigline doctor     install state per version, as a pasteable report

`add` never runs a package manager: a published plugin is one bundled ES module and a manifest, so
there is nothing to resolve. A version must reach a minimum age (a day, by default) before `add` or
`update` will take it, and a withheld version is named rather than skipped in silence.

## Writing a plugin

    npm create rigline-plugin

[The authoring guide](https://github.com/Rigline/Rigline/blob/main/docs/authoring.md) is the long
form. [Anchors](https://github.com/Rigline/Rigline/blob/main/docs/anchors.md) is what to read when
an extension update breaks a plugin and you would rather not wait for a release.

[Changelog](https://github.com/Rigline/Rigline/blob/main/CHANGELOG.md) — every package in this
workspace shares it, and one version number.

MIT.
