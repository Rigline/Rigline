# @rigline/core

The Node library behind [Rigline](https://github.com/Rigline/Rigline), a plugin layer for the
Claude Code VS Code extension.

**If you want to use Rigline, install [`rigline`](https://www.npmjs.com/package/rigline) instead.**
It fetches this package for you and runs it; that is the whole of what it does.

This is the engine. It carries the loader that gets injected, the four first-party plugins, and
every command that reads or drives an installed extension. `rigline` is a retrieval layer above it,
because a process cannot replace the package it is running out of.

What it injects into, and on whose terms, is
[Anthropic compliance](https://github.com/Rigline/Rigline/blob/main/docs/anthropic-compliance.md).

    npm install -D @rigline/core

**Declare it if you are writing plugins**, and never `rigline`: a project that can declare
dependencies does not need a delivery mechanism. `npm create rigline-plugin` scaffolds a workspace
that way.

## The command

It carries a bin, `rigline-engine`, which answers every verb `rigline` does except `update` — that
one belongs to the layer above, for the reason this package is separate from it.

    rigline-engine --help

In a plugin workspace it is what `build` and `codegen` run:

    "scripts": {
      "codegen": "rigline-engine codegen",
      "build": "rigline-engine build"
    }

`build` resolves [rolldown](https://www.npmjs.com/package/rolldown) lazily, from wherever the engine
sits, so a workspace that runs it declares rolldown itself.

## What it does

- **Locate** every installed version of the extension, and tell a pristine bundle from a patched one
  by its backup rather than by inspecting it.
- **Harvest** the identifiers a plugin depends on from the installed bundle: CSS-module classes with
  their application counts, the message protocol in four directions, outbound payload fields, host
  replies, and the React internals. Each layer is a module implementing one interface, so adding a
  sixth is a module and a table row.
- **Generate** the identifier types a plugin workspace compiles against, and the runtime tables the
  injected loader reads — byte-stable, so `--check` is a real check.
- **Inject and restore** with byte-faithful I/O, keeping the untouched bundle as the one authority
  on how to undo it.
- **Discover** plugins, validate each manifest as data without executing anything, check what it
  declares against what the installed extension actually contains, and bake a registry.
- **Diff** two extension directories, so an update is a report naming what moved.

Zero third-party runtime dependencies, which for a package that rewrites an editor's own bundle is
worth something on its own.

## Reading it

[The architecture map](https://github.com/Rigline/Rigline/blob/main/docs/architecture.md) is where
to start: what runs in Node and what in the webview, the one channel between them, the three
registries, and the install and boot pipelines. The decisions each part rests on are recorded in
[decisions.md](https://github.com/Rigline/Rigline/blob/main/docs/decisions.md), and the code cites
them by number.

[Changelog](https://github.com/Rigline/Rigline/blob/main/CHANGELOG.md) — every package in this
workspace shares it, and one version number.

MIT.
