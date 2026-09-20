# Contributing to Rigline

This covers building the project and trying it against your own installed copy of the Claude Code
VS Code extension. For how the system is put together, start with
[docs/architecture.md](docs/architecture.md); [docs/plan.md](docs/plan.md) says where the work is
and [docs/decisions.md](docs/decisions.md) why the shape is this shape. The remaining topic docs are
indexed in [CLAUDE.md](CLAUDE.md).

## Prerequisites

- Node 22.12+ — 26 is what it is developed, released and run against an editor on
- pnpm 12+
- The [Claude Code VS Code extension](https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code)
  installed, if you want to try Rigline against a real editor

## Build

    pnpm install
    pnpm build
    pnpm test
    pnpm typecheck
    pnpm lint

`rigline` is on npm, but `pnpm install` links this checkout's own build as a workspace bin, so
`pnpm rigline <command>` runs what you just built rather than what is published — no path needed.

Every push to `main` and every pull request runs `lint`, `typecheck`, `build` and `test` on Node
22.12.0, 24 and 26, and once more on Windows at 22.12.0. The corpus those tests read real bundles
from lives outside the repository, so the browser tier and the corpus-backed tests skip in CI and
run only here; [docs/verification.md](docs/verification.md) says which question belongs to which
tier.

## Installing into your extension

Rigline patches whatever version(s) of the Claude Code extension you already have installed —
it finds them itself, so there's nothing to point it at.

    pnpm rigline install

This injects the loader and bakes in the first-party plugins (session id, worktree prefix, time
marks, and a probe plugin that adds a `RIG` badge you can use to confirm it worked). Then reload:

- **Developer: Reload Webviews** (Command Palette) if only the webview payload changed — this
  affects the current window only, but ends any Claude Code turn that's in flight in it.
- **Developer: Reload Window** if the install output says a host patch changed — this reloads the
  whole window.

Check what's currently patched at any time with:

    pnpm rigline status

which reports, per installed version, whether it's vanilla or patched (judged against a backup
Rigline keeps, not against VS Code's own state).

### If the panel goes blank

That means something in the injected code threw during the webview's static import. Restore
immediately (see below), reload, then open the webview's developer tools console to see what
failed before trying again.

## Uninstalling

    pnpm rigline restore

This puts every installed version back to the extension's own original bytes, byte-for-byte. It
doesn't need VS Code or the extension to be working, so it's also the recovery path from a blank
panel or a broken extension host. Reload afterwards (Developer: Reload Window is always safe).

Note that installing an *update* to the Claude Code extension itself removes the old, patched
directory and installs a fresh, unpatched one — so an extension update silently uninstalls Rigline
for you. Run `install` again after updating.

## Workflow

Work happens on `main`; there's no branching model yet. Commit at each checkpoint rather than
accumulating a large, hard-to-review tree.

## Releasing

Not something a contributor needs, but it is written down rather than held by one person:
[docs/releasing.md](docs/releasing.md) has the whole path. In short, CI stages to npm over OIDC
and a maintainer approves with 2FA; nothing publishes straight from a push, and no npm credential
lives in this repository.
