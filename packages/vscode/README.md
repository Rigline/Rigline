# Rigline

The companion extension for [Rigline](https://github.com/Rigline/Rigline), a plugin layer for the
Claude Code VS Code extension.

Claude Code updates about weekly. Each update installs a fresh directory and deletes the old one,
which silently reverts Rigline's injection — no `RIG` pill, no plugins, and no error to tell you.
This extension is the thing that notices and puts it back, so an update stops being something you
have to remember.

It does no work itself. It finds a Node, fetches or updates the Rigline engine
(`@rigline/core`) under `~/.rigline/engine`, and runs that engine — the same one
`rigline` runs from a terminal, so the two can never disagree.

**This modifies files belonging to Anthropic's extension, on your machine, and that is your call to
make.** [Anthropic compliance](https://github.com/Rigline/Rigline/blob/main/docs/anthropic-compliance.md)
is a straight account of what Rigline does and does not do. `rigline restore` puts every install
back to Anthropic's own bytes and needs nothing but Node, and this extension leaves it that way
until you run `rigline install` or another command that injects.

## Installing

    npm i -g rigline
    rigline vscode-setup

`vscode-setup` installs this extension into every VS Code profile that has Claude Code, and keeps
Settings Sync from carrying it to machines without Rigline. Then reload the window. `rigline
vscode-setup --remove` takes it out again.

**Node 22.12 or newer has to be on the machine.** VS Code does not ship one, and this extension
needs npm to fetch the engine. It runs the Node behind a version manager's shim, such as volta's or
asdf's, and Homebrew's. If VS Code cannot see yours — common on macOS, where an application
launched from the Dock does not inherit a login shell's `PATH` — set `rigline.nodePath` and reload
the window.

The first run fetches the engine from npm. After that it asks the registry for a newer engine each
time a window starts, and moves to one once it is a day old. Nothing else it does reaches the
network.

**Where it works:** VS Code 1.90 or newer on Windows, Linux and macOS, in a local window. **Not
supported yet:** remote windows, other editors built on VS Code, a portable VS Code, and a custom
extensions directory. In any of them it reads *Rigline: not in this editor* and does nothing.
[Where Rigline works](https://github.com/Rigline/Rigline/blob/main/docs/support.md) lists each, and
how to ask for one.

## Settings

- **`rigline.nodePath`** — an absolute path to a Node executable. Leave it blank to search `PATH`.
  Worth setting where a GUI-launched VS Code does not inherit a login shell's `PATH`, which is
  common on macOS. It stays on the machine it was set on.
- **`rigline.enginePath`** — for developing Rigline: an engine entry to run in place of the one
  this extension installs, never updated. `rigline vscode-setup`, run from a checkout, prints the
  line to set. Leave it blank.

## Commands

- **Rigline: Show Plugins** — every plugin, in load order, in the **Rigline** output.

The status bar item says how the last run went. When it wants you, its tooltip says why, and
clicking it shows the **Rigline** output. When it reads *reload to apply*, clicking it offers the
reload again.
