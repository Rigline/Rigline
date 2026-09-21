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

The first command fetches the engine, `@rigline/core`, into `~/.rigline/engine` and runs it from
there; after that nothing reaches the network unless you ask it to. `install` then finds every
installed version of the extension itself, harvests the identifiers from it, and injects the
loader — keeping a byte-faithful backup of every bundle it touches. Then reload the webview from the
Command Palette with *Developer: Reload Webviews*.

Four plugins come with it and are switched on: the **session-id** pill in the composer footer,
**time marks** on transcript rows, the **worktree prefix** on session tab labels, and the `RIG`
badge, which is the diagnostics panel and the thing that tells you whether the rest of it is
working. `rigline list` names them; `rigline disable NAME` switches one off. Writing your own is
[docs/authoring.md](docs/authoring.md).

Run `rigline install` again after the extension updates — an update installs a fresh copy of the
extension beside the old one, which quietly leaves the loader behind. `rigline update` is the other
one: it brings the engine and every plugin you installed from npm up to date, and re-injects behind
both.

## If the panel goes blank

`rigline restore` puts every installed version back to the bytes the extension shipped with. It
needs nothing but Node: not VS Code, not a working extension, and not this repository.

If `rigline` itself is gone or will not run, the undo is a file copy, because the backup of every
bundle sits beside the bundle it came from. Each installed version is a directory under
`~/.vscode/extensions/` named `anthropic.claude-code-<version>`, on every platform, and there may be
more than one — do all of them, then reload the window.

    cd ~/.vscode/extensions/anthropic.claude-code-<version>
    cp webview/index.js.orig webview/index.js
    cp extension.js.orig extension.js          # only if this file is there

The first is the one that matters: `webview/index.js` is what renders the panel.
`extension.js.orig` exists only where a plugin patched the extension host, and there is nothing to
undo when it is absent.

Failing all of that, uninstalling and reinstalling Claude Code from the Extensions view replaces
both files with the originals.

## Layout

    packages/core         @rigline/core: the engine — harvest, codegen, inject, plugin
                          discovery, the install flow, and every verb but `update`
    packages/cli          rigline: the retrieval layer that installs the engine and runs it
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
