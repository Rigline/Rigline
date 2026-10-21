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

`pnpm rigline <command>` runs what you just built: it is a root script forwarding to
`rigline-engine`, the bin `@rigline/core` carries. **This checkout does not use the published
`rigline` package**, and should not — that is the retrieval layer a user installs, and running it
here would fetch an engine from the registry rather than driving the one in front of you. Every verb
reads the same either way; `update` is the one the wrapper alone has, so it has no meaning here.

Every push to `main` and every pull request runs `lint`, `typecheck`, `build` and `test` on Node
22.12.0, 24 and 26, and once each on Windows and macOS at 22.12.0. The corpus those tests read real
bundles
from lives outside the repository, so the browser tier and the corpus-backed tests skip in CI and
run only here; [docs/verification.md](docs/verification.md) says which question belongs to which
tier.

## Installing into your extension

Rigline patches whatever version(s) of the Claude Code extension you already have installed —
it finds them itself, so there's nothing to point it at.

    pnpm rigline install

This injects the loader and bakes in the first-party plugins from `plugins/`; *Diagnostics*, in
Rigline's menu behind the `RIG` pill, confirms it worked. It also puts this checkout's build of the
companion into every VS Code profile that has Claude Code, which on its own does not keep your build
running: [Running the checkout](#running-the-checkout) is the whole setup. Then reload:

- **Developer: Reload Webviews** (Command Palette) if only the webview payload changed — this
  affects the current window only, but ends any Claude Code turn that's in flight in it.
- **Developer: Reload Window** if the install output says a host patch changed, or that it put a
  companion in — this reloads the whole window.

Check what's currently patched at any time with:

    pnpm rigline status

which reports, per installed version, whether it's vanilla or patched (judged against a backup
Rigline keeps, not against VS Code's own state).

### If the panel goes blank

That means something in the injected code threw during the webview's static import. Restore
immediately (see below), reload, then open the webview's developer tools console to see what
failed before trying again.

## The checkout or the release

Your machine runs one Rigline at a time, this checkout's build or the published release, and the
setting `rigline.enginePath` decides which. The companion re-injects at every window start with the
engine that setting names, or the released one where it is unset, so what you ran at a terminal lasts
only until a window starts in a profile that disagrees. Left alone, the release keeps itself current
and the checkout stays at your last build. To test a change you want the checkout, and to know it is
the one running. [docs/companion.md](docs/companion.md) has why each step below is needed.

### Running the checkout

1. `git pull`, `pnpm install`, `pnpm build`. Not `pnpm -r build`: only the root script copies the
   bundle that `install` injects.
2. `pnpm rigline install`. It injects every Claude Code version on disk, and puts this build of the
   companion into every VS Code profile that has Claude Code.
3. In **every** profile that has Claude Code, set `rigline.enginePath` in the user settings to the
   absolute path of this checkout's `packages/core/dist/engine/bin.js`. `install` prints the line
   whenever it adds the companion to a profile.
4. *Developer: Reload Window* if `install` put a companion in or changed a host patch, otherwise
   *Developer: Reload Webviews*.

From then on the loop is `pnpm build` and a reload. Run `pnpm rigline install` again after changing
`packages/vscode`, or after giving another profile Claude Code.

It is live when the status bar reads *Rigline (dev)* in the window you are testing in, the
**Rigline** output channel's `engine:` line names this checkout, and
`~/.vscode/extensions/anthropic.claude-code-<version>-<platform>/webview/rigline/post.js` is
byte-identical to `packages/core/dist/bundled/post.js` (`cmp`, or `fc /b` on Windows). A version
number proves nothing: a build carries whatever version the manifests held when it was built, which
is a release's, so `check` and `doctor` read the same for either.

What puts the release back over your build, silently, while every check passes:

- **A profile without the setting.** A window starting in it runs the released engine's `install`.
  Profiles are not isolation, since every profile's companion writes the same Claude Code
  directories; for a setup kept apart, use a second VS Code with its own `--extensions-dir`.
- **The global `rigline`.** From any directory it injects with the released engine, and makes the
  companion in every profile the released one. Use `pnpm rigline`.
- **A worktree's install.** There is one live extension, so an `install` from a worktree and one
  from the main checkout overwrite each other, and the next window start re-injects whichever
  checkout `rigline.enginePath` names. Point it at the one you are testing.

And three that cost only a moment:

- **A Claude Code update** installs a fresh, unpatched directory. The companion injects it with your
  build, but a window that was open keeps the old directory until *Developer: Reload Window*.
- **`generated.ts`.** `install` rewrites the root one from the newest Claude Code installed. `git
  checkout -- generated.ts` unless you mean to move the harness, which is
  [verification.md](docs/verification.md)'s *Adding a version to the corpus*.
- **An argument with a space** cannot go through `pnpm rigline`, whose shim loses the quoting. Run
  `node packages/core/dist/engine/bin.js` with the same arguments.

The setting is machine-scoped, so Settings Sync does not carry it: each machine you develop on is
set up on its own, naming its own checkout.

### Running the release

1. `npm i -g rigline@latest`. Nothing updates the global `rigline`, and it will not run an engine
   from another major.
2. Remove `rigline.enginePath` from every profile that has it.
3. `rigline update`, from your home directory, since in a checkout it rewrites the checkout's
   `generated.ts`. It moves the engine to the newest release once that is a day old (`--now` takes
   it sooner), moves any plugin installed from npm, makes the companion in every profile the
   released one, and injects.
4. *Developer: Reload Window* in every open window.

It is live when the status bar reads *Rigline* with no *(dev)*, and `rigline --version` names the
engine `npm view @rigline/core version` does. From then on the companion moves the engine at the
first window start after a release is a day old. Plugins from npm move only when you run
`rigline update`.

## Uninstalling

    pnpm rigline restore

This puts every installed version back to the extension's own original bytes, byte-for-byte. It
doesn't need VS Code or the extension to be working, so it's also the recovery path from a blank
panel or a broken extension host. Reload afterwards (Developer: Reload Window is always safe).

Note that installing an *update* to the Claude Code extension itself removes the old, patched
directory and installs a fresh, unpatched one — so an extension update silently uninstalls Rigline
for you. Run `install` again after updating.

## Workflow

Work happens on `main`; [docs/ci.md](docs/ci.md) has the branching rule for release lines. Commit at each checkpoint rather than
accumulating a large, hard-to-review tree.

## Releasing

Not something a contributor needs, but it is written down rather than held by one person:
[docs/releasing.md](docs/releasing.md) has the whole path. In short, CI stages to npm over OIDC
and a maintainer approves with 2FA; nothing publishes straight from a push, and no npm credential
lives in this repository.
