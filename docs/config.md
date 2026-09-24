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

## Mistakes

A file that is not valid YAML stops every command that reads it, naming the file and the line, and
changes nothing. So does a `disabled` that is not a list of names. `disabled:` with nothing after it
is an empty list, not a mistake.

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
