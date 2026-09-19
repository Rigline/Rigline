# @rigline/core

The Node library behind [Rigline](https://github.com/Rigline/Rigline), a plugin layer for the
Claude Code VS Code extension.

**If you want to use Rigline, install [`rigline`](https://www.npmjs.com/package/rigline) instead.**
This package is the machinery underneath it, published so that a companion extension or another
front end can drive the same flows the CLI does.

    npm install @rigline/core

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
- **Fetch** a plugin from npm: a tarball reader that refuses rather than reproduces, an integrity
  check, and a minimum release age.
- **Diff** two extension directories, so an update is a report naming what moved.

Zero third-party runtime dependencies, which for a package that rewrites an editor's own bundle is
worth something on its own.

## Reading it

[The architecture map](https://github.com/Rigline/Rigline/blob/main/docs/architecture.md) is where
to start: what runs in Node and what in the webview, the one channel between them, the three
registries, and the install and boot pipelines. The decisions each part rests on are recorded in
[decisions.md](https://github.com/Rigline/Rigline/blob/main/docs/decisions.md), and the code cites
them by number.

MIT.
