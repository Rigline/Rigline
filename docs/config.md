# Your settings

Rigline keeps what you decide in one file, `~/.rigline/config.yaml`. You can edit it by hand, or
let a command do it: `rigline disable`, `rigline enable` and `rigline layout` change it for you. A
command edits the
file in place, so your comments, blank lines and the order you wrote things in all survive. Nothing
you change takes effect until the next `rigline install` (the commands run one for you), and then a
reload of the panel.

    # Rigline's settings. Edit freely: rigline's commands keep your comments.
    # https://github.com/Rigline/Rigline/blob/main/docs/config.md

    # Too noisy for me.
    disabled:
      - time-marks

`$RIGLINE_HOME` moves the whole directory, if you keep your dotfiles somewhere else.

## Switching a plugin off

`disabled` lists plugins that do not load. A plugin you switch off stays installed, and `rigline
list` still shows it, marked as switched off. This is the only way to decline one of the plugins
Rigline ships with: they live inside the engine, so there is nothing to delete, and an update would
put them back.

A name nothing has installed is reported by `install` rather than ignored, since it is usually a
typo.

## Where things go in the panel

Some plugins put things in the panel: a pill in the composer's footer, a line in the row under the
composer's controls. Each of those is an *element*. Its plugin decides where it goes, and whether it
starts switched off. Rigline has two of its own, named like any other: `rigline/edit`, which starts
editing the layout in place, and `rigline/reload`, which picks up the saved layout; both start in
`rigRow`. `layout` is where you overrule that:

    layout:
      rigRow:
        - session-id/address
        - session-id/full-id
      off:
        - session-id/short-id

Each key is a place, and under it are the elements you have put there, in the order you want them,
each named `plugin/element`. A place is one of:

- `rigRow`, Rigline's row at the foot of the composer box, which is only there while something is
  in it.
- `before`, `after` or `inside` one of the app's controls, by its anchor name: `before footerSpacer`
  is the composer footer, beside Rigline's own pill.
- `off`, for an element you do not want to see.

An element can only go where its plugin allows. `rigline layout` lists every element by place, marks
those your layout put there, and says where else each may go:

    rigRow
      session-id/address   Messaging address  yours
      session-id/full-id   Full session id    yours
    off
      session-id/short-id  Session id         yours; can also go before footerSpacer, rigRow

Leave an element out and it stays where its plugin puts it, and so does everything a plugin you
install later brings. In a place, the elements you list come first, in your order, and anything else
that belongs there follows.

The same changes from the command line, each of which edits the file and re-injects:

    rigline layout place session-id/address rigRow           # to the end of that place
    rigline layout place session-id/short-id off
    rigline layout place session-id/short-id default         # back where its plugin puts it
    rigline layout order rigRow session-id/full-id session-id/address
    rigline layout reset                                     # everything back to its plugin's place

A place of two words, like `before footerSpacer`, needs no quotes. `order` replaces what you have
listed in that place; an element you leave out of it goes back where its plugin puts it.

An entry that does not work — a misspelt place, a plugin you have removed, a place its element cannot
go — is named by `rigline install` and `rigline check`. The element stays where its plugin puts it,
and the entry stays in the file, so a plugin you remove and add back finds its place waiting. An
element listed under two places goes to the first, and the second is reported.

## Which VS Code profiles get the companion

If you installed the companion extension with `rigline vscode-setup`, it goes into every VS Code
profile that has Claude Code, and it adds itself to any profile that gets Claude Code later. The
`companion` block changes that:

    companion:
      skipProfiles:
        - Kokai
      everyProfile: false

- `skipProfiles` lists profiles, by the name VS Code's profile switcher shows, that are never given
  the companion. The default profile is `Default`. Renaming a profile takes it off the list.
- `everyProfile: false` keeps the companion to the default profile, or the one you name with
  `vscode-setup --profile`, and it is never added anywhere by itself.

The same from the command line:

    rigline vscode-setup --remove --profile Kokai   # out of that profile, and onto skipProfiles
    rigline vscode-setup --profile Kokai            # back in, and off skipProfiles

Uninstalling the companion from a profile in VS Code's Extensions view does not last: it is put back
the next time it looks. Disable it there instead, which VS Code keeps, or list the profile here.

## Mistakes

A file that is not valid YAML stops every command that reads it, naming the file and the line, and
changes nothing. So does a `disabled` that is not a list of names, a `layout` that is not places
with lists under them, or a `companion` block whose `everyProfile` is not true or false or whose
`skipProfiles` is not a list. A key with nothing after it, like `disabled:`, is an empty list, not a
mistake.

## The other files here

`~/.rigline/sources.json` records where `rigline add` brought each plugin from — the npm package,
its pinned version and the hash of what was downloaded — and is what `rigline update` reads. It is
Rigline's record, not a setting, so it is not meant for editing. A plugin you copied into
`~/.rigline/plugins/` yourself has no entry, and `update` leaves it alone.

`~/.rigline/anchors.json` repairs an anchor without waiting for a release; [anchors.md](anchors.md)
says when you need one.

`~/.rigline/drift.txt` lists what changed inside Claude Code the last time `rigline install` found
anything had: the names plugins are built against, gone and new. It is there for working out why a
plugin stopped after a Claude Code update. Each install rewrites it, or removes it when nothing
moved.

`~/.rigline/token` is a random value `rigline install` makes once and never changes. It goes into
the panel, so a save made from the panel can show it came from one of your own. Leave it alone. If
it is deleted, the next `install` makes a new one, and a panel still open from before needs
reloading before it can save.

`~/.rigline/.lock` and `~/.rigline/inject.lock` are there only while a command is running: the
first while an engine is being installed, the second while one is injecting. A command that finds
one waits for it, and says who holds it if it gives up. One left behind by a command that was
killed is taken over once it is old.

Before `sources.json` and `config.yaml` there was `~/.rigline/config.json`. The first command that needs it splits it
into them and removes it. If one turns up again beside them, an older Rigline wrote it: it is not
read, the commands say so, and it can be deleted.
