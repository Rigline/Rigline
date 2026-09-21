# Rigline

[![CI](https://github.com/Rigline/Rigline/actions/workflows/ci.yml/badge.svg)](https://github.com/Rigline/Rigline/actions/workflows/ci.yml)

A plugin layer for the Claude Code VS Code extension. Rigline injects a small loader into the
installed extension's webview, gives plugins a capability-scoped context to write against, and
harvests the identifiers plugins depend on from whichever extension version is installed, so an
extension update is a diff to read rather than a breakage to chase.

Named for the line a rigger threads through gear that's already built and standing, to add
something new without touching the rigging itself.

## Status

1.0 is under construction. [docs/plan.md](docs/plan.md) has the phases and where things stand;
[docs/decisions.md](docs/decisions.md) has the principles and decisions behind them.

Writing a plugin: [docs/authoring.md](docs/authoring.md). Repairing one an extension update broke:
[docs/anchors.md](docs/anchors.md). Working on Rigline itself:
[docs/architecture.md](docs/architecture.md) is the map, and
[CONTRIBUTING.md](CONTRIBUTING.md) is how to run it against your own editor.

## Installing

    npm install -g rigline
    rigline install

`install` finds every installed version of the extension itself, harvests the identifiers from it,
and injects the loader — keeping a byte-faithful backup of every bundle it touches. Then reload the
webview from the Command Palette with *Developer: Reload Webviews*. `rigline restore` puts
everything back, and needs nothing but Node and those backups.

**No plugins are published yet**, so that alone injects a loader with nothing in it and you will see
no change in the panel. Until some are, the way to get the first-party ones — the session-id pill,
time marks, the worktree tab prefix, and the `RIG` diagnostics badge that tells you whether any of
it is working — is to clone this repository and install from the checkout, which
[CONTRIBUTING.md](CONTRIBUTING.md) covers. Writing your own is
[docs/authoring.md](docs/authoring.md).

## Layout

    packages/core         @rigline/core: harvest, codegen, inject, plugin discovery, update flow
    packages/cli          rigline: the command-line surface over core
    packages/host         the injected loader, pre.js and post.js
    packages/plugin-api   @rigline/plugin-api: what a plugin is written against
    packages/create-plugin create-rigline-plugin: the scaffold a plugin author starts from
    packages/harness      Playwright tests over the real webview bundle, headless
    plugins/              first-party plugins
    docs/                 plan, decisions, topic docs, archive

## Developing

pnpm 12, and Node 22.12 or newer; CI runs 22.12.0, 24 and 26, plus Windows at 22.12.0.

    pnpm install
    pnpm build
    pnpm test
    pnpm typecheck
    pnpm lint

See [CONTRIBUTING.md](CONTRIBUTING.md) for installing (and uninstalling) Rigline against your own
copy of the extension.

## Releasing

Four packages go to npm: `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin`. A pushed tag makes CI stage them over OIDC, so no npm token is stored
anywhere, and a person approves afterwards with a second factor — a staged version is one nobody can
install until they do.

    pnpm release <increment>   # lint, typecheck, build, test; then changelog, manifests, tag, push
    # approve the four staged packages at npmjs.com → your profile → Staged Packages
    pnpm release:finish        # dist-tags, and the GitHub release

Which dist-tag a version lands under is derived from the version and what the registry already
holds, never chosen.

[docs/releasing.md](docs/releasing.md) is the full runbook: the one-time npm setup, what to do when
a step fails, and the traps that have already cost time here — `latest` staying pinned to the first
version ever published, and both `pnpm dist-tag` and `pnpm stage approve` demanding a typed
one-time password that a security key cannot give.
