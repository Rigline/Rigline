# Rigline

*Renamed from Prototype on 2026-09-14 — nothing was published under the old name. See the status log
in [docs/plan.md](docs/plan.md) for why.*

A plugin layer for the Claude Code VS Code extension. Rigline injects a small loader into the
installed extension's webview, gives plugins a capability-scoped context to write against, and
harvests the identifiers plugins depend on from whichever extension version is installed, so an
extension update is a diff to read rather than a breakage to chase.

Named for the line a rigger threads through gear that's already built and standing, to add
something new without touching the rigging itself.

## Status

1.0 is under construction. [docs/plan.md](docs/plan.md) has the architecture, the phases and where
things stand; [docs/decisions.md](docs/decisions.md) has the principles and decisions behind them.

## Layout

    packages/core         @rigline/core: harvest, codegen, inject, plugin discovery, update flow
    packages/cli          rigline: the command-line surface over core
    packages/host         the injected loader, pre.js and post.js
    packages/plugin-api   @rigline/plugin-api: what a plugin is written against
    plugins/              first-party plugins
    fixtures/             plugins that exist to be refused, used by tests only
    docs/                 plan, decisions, topic docs, archive

## Developing

pnpm 12 and Node 26.

    pnpm install
    pnpm build
    pnpm test
    pnpm typecheck
    pnpm lint

See [CONTRIBUTING.md](CONTRIBUTING.md) for installing (and uninstalling) Rigline against your own
copy of the extension.
