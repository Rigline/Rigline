# Your settings

Rigline keeps what you decide in one file, `~/.rigline/config.yaml`. You can edit it by hand, or
let a command do it: `rigline disable` and `rigline enable` change it for you. A command edits the
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
starts switched off. `layout` is where you overrule that:

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

An element can only go where its plugin allows. The plugin's `rigline.json` lists its elements under
`elements`, with the places each may take.

Leave an element out and it stays where its plugin puts it, and so does everything a plugin you
install later brings. In a place, the elements you list come first, in your order, and anything else
that belongs there follows.

An entry that does not work — a misspelt place, a plugin you have removed, a place its element cannot
go — is named by `rigline install` and `rigline check`. The element stays where its plugin puts it,
and the entry stays in the file, so a plugin you remove and add back finds its place waiting. An
element listed under two places goes to the first, and the second is reported.

## Mistakes

A file that is not valid YAML stops every command that reads it, naming the file and the line, and
changes nothing. So does a `disabled` that is not a list of names, or a `layout` that is not places
with lists under them. A key with nothing after it, like `disabled:`, is an empty list, not a
mistake.

## The other files here

`~/.rigline/sources.json` records where `rigline add` brought each plugin from — the npm package,
its pinned version and the hash of what was downloaded — and is what `rigline update` reads. It is
Rigline's record, not a setting, so it is not meant for editing. A plugin you copied into
`~/.rigline/plugins/` yourself has no entry, and `update` leaves it alone.

`~/.rigline/anchors.json` repairs an anchor without waiting for a release; [anchors.md](anchors.md)
says when you need one.

Before these two files there was `~/.rigline/config.json`. The first command that needs it splits it
into them and removes it. If one turns up again beside them, an older Rigline wrote it: it is not
read, the commands say so, and it can be deleted.
