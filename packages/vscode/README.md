# Rigline

The companion extension for [Rigline](https://github.com/Rigline/Rigline), a plugin layer for the
Claude Code VS Code extension.

Claude Code updates about weekly. Each update installs a fresh directory and deletes the old one,
which silently reverts Rigline's injection — no badge, no plugins, and no error to tell you. This
extension is the thing that notices and puts it back, so an update stops being something you have to
remember.

It does no work itself. It finds a Node, fetches or updates the Rigline engine
(`@rigline/core`) under `~/.rigline/engine`, and runs that engine — the same one
`rigline` runs from a terminal, so the two can never disagree.

**This modifies files belonging to Anthropic's extension, on your machine, and that is your call to
make.** [Anthropic compliance](https://github.com/Rigline/Rigline/blob/main/docs/anthropic-compliance.md)
is a straight account of what Rigline does and does not do. `rigline restore` puts every install
back to Anthropic's own bytes and needs nothing but Node.

## Installing

    code --install-extension rigline.vsix

Or *Extensions: Install from VSIX…* in the Command Palette, where `code` is not on your `PATH`.
Then reload the window.

**Node has to be on the machine.** VS Code does not ship one, and this extension needs npm to fetch
the engine. If VS Code cannot see yours — common on macOS, where an application launched from the
Dock does not inherit a login shell's `PATH` — set `rigline.nodePath` and reload.

The first run reaches the network once, to fetch the engine. Nothing after that does unless you ask
it to.

## Settings

- **`rigline.nodePath`** — an absolute path to a Node executable. Leave it blank to search `PATH`.
  Worth setting where a GUI-launched VS Code does not inherit a login shell's `PATH`, which is
  common on macOS.
