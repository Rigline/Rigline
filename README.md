# Rigline

[![CI](https://github.com/Rigline/Rigline/actions/workflows/ci.yml/badge.svg)](https://github.com/Rigline/Rigline/actions/workflows/ci.yml)

A plugin layer for the Claude Code VS Code extension. Rigline injects a small loader into the
installed extension's webview, gives plugins a capability-scoped context to write against, and
harvests the identifiers plugins depend on from whichever extension version is installed, so an
extension update is a diff to read rather than a breakage to chase.

Named for the line a rigger threads through gear that's already built and standing, to add
something new without touching the rigging itself.

> ### Anthropic compliance
>
> Rigline modifies files belonging to Anthropic's Claude Code extension, on the machine of the
> person who installed both. **[docs/anthropic-compliance.md](docs/anthropic-compliance.md)** is a
> straight account of what it does to that extension, what it does not do — no credentials, no
> network calls from the panel, no rerouting of Claude usage, no redistribution — and how we read
> Anthropic's terms, including the clause that comes closest to biting.
>
> **If you are from Anthropic, please get in touch.** We would like to discuss making Rigline
> something you are comfortable with, and if you would rather it stopped, it will.

## Status

Rigline is stable. Within 2.x, a plugin, a file you wrote and a command you scripted keep working
as [docs/stability.md](docs/stability.md) describes, and [docs/support.md](docs/support.md) says
where Rigline runs. [docs/plan.md](docs/plan.md) has what comes next, and
[docs/decisions.md](docs/decisions.md) the principles and decisions behind it.

Writing a plugin: [docs/authoring.md](docs/authoring.md). Repairing one an extension update broke:
[docs/anchors.md](docs/anchors.md). Working on Rigline itself:
[docs/architecture.md](docs/architecture.md) is the map, and
[CONTRIBUTING.md](CONTRIBUTING.md) is how to run it against your own editor. Reporting a
vulnerability, or a plugin that breaks the plugin policy: [SECURITY.md](SECURITY.md).

## Installing

    npm install -g rigline
    rigline install

The first `rigline` command you run fetches the engine, `@rigline/core`, into `~/.rigline/engine`
and runs it from there. `install` then puts Rigline's companion extension into every VS Code
profile that has Claude Code, and injects the loader into every installed version of the extension:
it harvests the identifiers from each, and keeps a byte-faithful backup of every bundle it touches.
Then reload the window from the Command Palette with *Developer: Reload Window*, which the report
asks for. That starts the companion, and the first install also patches the extension host, which
only a window reload starts again.

The companion is the part of Rigline that lives in VS Code. It re-injects after every extension
update, saves what you change in the panel, and asks npm's registry for a newer engine each time a
window starts, moving to one once it is a day old. Putting it in needs VS Code's `code` command on
your `PATH`; on macOS, add it with *Shell Command: Install 'code' command in PATH* from the Command
Palette.

*Diagnostics*, in the menu behind the `RIG` pill, tells you whether all of it is working. These
plugins come with it and are switched on: the **session-id** pill in the composer footer, **time
marks** on transcript rows, the **worktree prefix** on session tab labels, the **context meter**
and the **usage meter**, for the session's cost and your plan's limits, under the composer, **model
favourites**, your usual model and effort one click away, and the **probe**, which
tests Rigline's plugin API live and adds its lines to *Diagnostics*. `rigline list` names them;
`rigline disable NAME` switches one off. `rigline layout` shows
where each plugin's pills sit in the panel, and moves, orders or hides them. Every setting is in one
file you can also edit by hand, described in [docs/config.md](docs/config.md). Writing your own
plugin is [docs/authoring.md](docs/authoring.md).

`rigline update` brings the engine and every plugin you installed from npm up to date, and
re-injects behind both. Every command that injects also puts the companion into any profile with
Claude Code that lacks it, and brings it up to date where it is behind.

## Where it works

VS Code 1.90 or newer on Windows, Linux and macOS, in a local window, with Node 22.12 or newer.

**Not supported yet:** remote windows, other editors built on VS Code, a portable VS Code, and a
custom extensions directory. In any of them, Claude Code's panel stays as it ships.
[docs/support.md](docs/support.md) lists each, and how to ask for one.

## If the panel goes blank

`rigline restore` puts every installed version back to the bytes the extension shipped with. It
needs nothing but Node: not VS Code, not a working extension, and not this repository.

Rigline then stays out, however often the window reloads or Claude Code updates, until you put it
back: the companion does not undo a restore. To find what blanked the panel, switch off the plugin
you suspect with `rigline disable NAME`, which puts the rest back, or run `rigline install` for all
of them.

If `rigline` itself is gone or will not run, the undo is a file copy, because the backup of every
bundle sits beside the bundle it came from. First make an empty file at `~/.rigline/restored`: it is
what tells the companion Rigline is meant to be out, and without it the companion puts Rigline back
at the next window. Each installed version is a directory under `~/.vscode/extensions/` named
`anthropic.claude-code-<version>-<platform>`, such as `anthropic.claude-code-2.1.283-win32-x64`,
and there may be more than one — do all of them, then reload the window.

    touch ~/.rigline/restored
    cd ~/.vscode/extensions/anthropic.claude-code-<version>-<platform>
    cp webview/index.js.orig webview/index.js
    cp extension.js.orig extension.js          # only if this file is there

The first is the one that matters: `webview/index.js` is what renders the panel.
`extension.js.orig` exists only where a plugin patched the extension host, and there is nothing to
undo when it is absent.

Failing all of that, uninstalling and reinstalling Claude Code from the Extensions view replaces
both files with the originals.

## Uninstalling

    rigline uninstall

It restores every installed version, takes the companion out of every VS Code profile, and then
says what is left to you, in order: reload every VS Code window, `npm uninstall -g rigline`, and
delete `~/.rigline`, which holds your settings, any plugin you added, and the engine. Reload before
deleting: a companion still running in a window that has not reloaded is kept out by a file in
`~/.rigline`.

## Layout

    packages/core         @rigline/core: the engine — harvest, codegen, inject, plugin
                          discovery, the install flow, and every verb (of `update`, the
                          plugins' half)
    packages/cli          rigline: the retrieval layer that installs the engine and runs it,
                          and moves it for `update`
    packages/vscode       the companion extension, which re-injects after an update and saves
                          what the panel changes
    packages/host         the injected loader, pre.js and post.js
    packages/plugin-api   @rigline/plugin-api: what a plugin is written against
    packages/create-plugin create-rigline-plugin: the scaffold a plugin author starts from
    packages/harness      Playwright tests over the real webview bundle, headless
    plugins/              first-party plugins
    docs/                 plan, decisions, topic docs, archive

## Developing

pnpm 12, and Node 22.12 or newer; CI runs 22.12.0, 24 and 26, plus Windows and macOS at 22.12.0.

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
