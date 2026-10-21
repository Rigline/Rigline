# Your settings

Rigline keeps what you decide in one file, `~/.rigline/config.yaml`. The usual way to change it is
from the panel: **Settings…** in the RIG menu opens a screen with a tab for Rigline and one for each
plugin that has settings, and its Save writes this file. You can also edit it by hand, or let a
command do it: `rigline disable`, `rigline enable` and `rigline layout` change it for you. The panel
and the commands edit the file in place, so your comments, blank lines and the order you wrote
things in all survive. A change made by hand or by a command takes effect at the next `rigline
install` (the commands run one for you), and then a reload of the panel; one saved from the panel
reaches the panel that saved it without a reload.

<p align="center">
  <img src="media/settings.png" width="800" alt="Rigline's settings screen over the panel: a rail of tabs, Rigline's first and then one per plugin, with the Rigline tab open on the default model and when to ask for one.">
</p>

    # Rigline's settings. Edit freely: rigline's commands keep your comments.
    # https://github.com/Rigline/Rigline/blob/main/docs/config.md

    # Too noisy for me.
    disabled:
      - time-marks

`$RIGLINE_HOME` moves the whole directory, if you keep your dotfiles somewhere else. Set it where VS
Code sees it as well as your terminal: a VS Code started from a dock or a launcher does not read
your shell's profile, and its companion would then keep a home of its own, with its own engine and
settings, and no sight of a `rigline restore` you ran.

## Switching a plugin off

`disabled` lists plugins that do not load. A plugin you switch off stays installed, and `rigline
list` still shows it, marked as switched off. This is the only way to decline one of the plugins
Rigline ships with: they live inside the engine, so there is nothing to delete, and an update would
put them back.

A name nothing has installed is reported by `install` rather than ignored, since it is usually a
typo.

## A plugin's own settings

`settings` holds a block per plugin, under the plugin's name, and what goes inside is the plugin's
own business — Rigline passes it through without reading it. The plugin's README says what it
takes.

    settings:
      model-favourites:
        # Edited on its tab in the settings screen, or written here; either way it is this list.
        favourites:
          - { model: opus, effort: high }
          - { model: haiku }

A plugin with settings worth changing has a tab in the settings screen, and some can also save
from a click on whatever they draw, such as a star on a row. Either way that writes only
that plugin's block and leaves the rest of the file as you wrote it, comments included, the same as
a `rigline layout` edit does. It goes through the companion extension, which `rigline install` puts
into VS Code. A plugin can only ever write its own block, never another plugin's.

A key Rigline does not understand inside a plugin's block is **kept and passed on**, unlike one at
the top level: Rigline never knows a plugin's own settings, so it cannot tell a typo from a key a
newer version of that plugin added. That means a hand edit is never quietly dropped, and it also
means a misspelling here is yours to spot.

Settings for a plugin you have switched off, or removed, stay in the file and come back with it.
Only the plugin itself ever has to make sense of them, and it is asked to cope with whatever it
finds — a key it has never heard of, or one it expects that is missing.

A block big enough to be a nuisance is dropped at install time with a line saying so, which costs
that plugin its settings; the limit is far above anything a person would type. Saving from the
panel has a much smaller limit than that, because a save travels as a link, so a plugin keeping
bulk data under its own key can read it and cannot save it back from the panel. It says so rather
than failing after you have done the work.

## Choosing a model before you send

Claude Code's model and effort are settings, not part of a session: change them once and every
session after uses the change, until somebody notices. `model` can make the panel ask instead. Both
are on the Rigline tab of the settings screen.

    model:
      default: { model: opus, effort: high }
      requireChoice: always

`requireChoice` says when a prompt waits for a model to be chosen in a new session:

- `off`, the default: nothing waits.
- `unlessDefault`: only while what is live is not your `default`.
- `always`: every new session asks.

A session you resume carries the choice it started with, so it never asks. While a new one waits, a
line above the composer says so, naming what is live with its version, so you know before you press
Enter whether it will send. Its button keeps what is live, and sends what you have typed if you have
typed anything. Your typing is never blocked and nothing you typed is lost. Choosing in Claude
Code's own model or effort picker counts, as does a plugin's shortcut such as a favourite.

`default` is the model you usually want, and the effort with it if you name one. `unlessDefault`
compares against it, and plugins can offer it as a one-click choice, so it is worth setting whatever
you choose for `requireChoice`. It names a model as Claude Code does — `opus` follows the latest Opus,
where a pinned version stays put — and it takes `effort` for a model with effort levels or
`thinkingLevel` for one without, never both.

## Where things go in the panel

`layout` says where each pill and meter goes, when you want it somewhere other than where its plugin
puts it:

    layout:
      rigRow:
        - session-id/address
        - session-id/full-id
      off:
        - session-id/short-id

Dragging things in the panel writes this for you. [layout.md](layout.md) has every place an element
can go, the layout Rigline starts with, and the `rigline layout` commands; a layout kept in a file of
its own is a preset, which [presets.md](presets.md) covers.

## Mistakes

A file that is not valid YAML stops every command that reads it, naming the file and the line, and
changes nothing. So does a `disabled` that is not a list of names, a `layout` that is not places
with lists under them, or a `model` block whose `default` names no model. A key with nothing
after it, like `disabled:`, is an empty list, not a mistake.

A key Rigline does not know does nothing, and `rigline install` and `rigline check` name it under
what needs you. So does a `requireChoice` it does not know, which reads as `off`. It is a typo, like `disable:`, or a setting from a later Rigline than the one you
are running, which `rigline update` fixes. A later Rigline only adds settings as new keys, never by
changing what an existing one takes, so an older one reads the rest of the file as you meant it.

## The other files here

`~/.rigline/sources.json` records where `rigline add` brought each plugin from — the npm package,
its pinned version and the hash of what was downloaded — and is what `rigline update` reads. It is
Rigline's record, not a setting, so it is not meant for editing. A plugin you copied into
`~/.rigline/plugins/` yourself has no entry, and `update` leaves it alone.

`~/.rigline/presets/` holds the layout presets you have saved or been sent, and
`~/.rigline/previous-layout.yaml` is what the last `rigline layout apply` replaced, which `rigline
layout undo` reads. Both are described in [presets.md](presets.md).

`~/.rigline/anchors.json` repairs an anchor without waiting for a release; [anchors.md](anchors.md)
says when you need one.

`~/.rigline/drift.txt` lists what changed inside Claude Code the last time `rigline install` found
anything had: the names plugins are built against, gone and new. It is there for working out why a
plugin stopped after a Claude Code update, and its first line says which update. An install that
finds something moved rewrites it; one that finds nothing leaves it.

`~/.rigline/token` is a random value `rigline install` makes once and never changes. It goes into
the panel, so a save made from the panel can show it came from one of your own. Leave it alone. If
it is deleted, the next `install` makes a new one, and a panel still open from before needs
reloading before it can save.

`~/.rigline/.lock` and `~/.rigline/inject.lock` are there only while a command is running: the
first while an engine is being installed, the second while one is injecting. A command that finds
one waits for it, and says who holds it if it gives up. One left behind by a command that was
killed is taken over once it is old.

`~/.rigline/restored` is left by `rigline restore` and `rigline uninstall`, and keeps the companion
from putting Rigline back. The next command you run that injects removes it: `install`, or any of
the commands that change your plugins or layout.
