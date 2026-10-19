# Presets

A preset is a layout in a file. Rigline ships a few, you can save your own, and you can hand one to
somebody else or use one they wrote.

    rigline layout presets           # the ones you have
    rigline layout apply two-rows    # put one in place of your layout
    rigline layout export mine       # save your layout as one
    rigline layout undo              # back to the layout the last apply replaced

A bare word is a name, kept in `~/.rigline/presets`. Anything with a separator or a `.yaml`
extension is a path, so a file somebody sent you is `rigline layout apply ./3dflow.yaml`.

Each of these edits [`~/.rigline/config.yaml`](config.md) and keeps your comments, and `apply` and
`undo` re-inject, so the change is one reload of the panel away.

## Trying one out

`apply` prints what moved, so you can see what the preset did rather than comparing two lists:

    $ rigline layout apply two-rows
    applied two-rows from .../presets/two-rows.yaml
      usage-meter/cost: in rigRow to in rigRow 2
      worktree/short-name: in rigRow to before footerSpacer
      rigline/edit: in rigRow to in rigRow right
    the layout it replaced is in ~/.rigline/previous-layout.yaml; `rigline layout undo` puts it back

So you do not have to save your own layout first. `undo` goes back to whatever the last `apply`
replaced. It is one step, and only `apply` writes it: a `rigline layout reset`, a move you made in
the panel, or a Save since then is not what `undo` puts back.

If you want to keep your layout before trying things, `rigline layout export mine` saves it, and
`rigline layout apply mine` brings it back whenever you like.

## What a preset carries

Only a layout. A preset cannot switch a plugin off, and **applying one never installs anything**.

    # A Rigline layout preset. Apply it with `rigline layout apply <file>`.
    preset:
      description: Context on the first row, what the session is costing on the second.
      plugins:
        3dflow:
          npm: rigline-plugin-3dflow

    layout:
      rigRow:
        - context-meter/bar
      rigRow 2:
        - 3dflow/panel
      off:
        - session-id/full-id

`layout` is exactly what [config.md](config.md) describes, so everything you can write by hand you
can put in a preset, and the places and element names mean the same thing.

`description` is the line `rigline layout presets` shows.

`plugins` is what the preset *says* about the plugins it names, for the ones you may not have. It is
the file's claim, not Rigline's: Rigline repeats it and leaves the decision to you.

    $ rigline layout apply ./3dflow.yaml
    applied 3dflow from ./3dflow.yaml
    3dflow is not installed; the preset says it comes from the npm package "rigline-plugin-3dflow"

Nothing else happens. If you want that plugin, look at it first — it is somebody's code, running in
your panel — and then `rigline add` it yourself. The entry stays in your layout meanwhile, so the
day you add the plugin its elements appear where the preset put them, with nothing more to run. If
you decide against it, the entry is harmless: Rigline says once that the plugin is not installed,
and the rest of the layout works.

## Writing one to share

`rigline layout export <name>` writes what your `config.yaml` holds, which is the elements you have
moved, ordered or switched off — not every element. Anything you never touched stays wherever its
plugin puts it, for you and for whoever applies your preset. That is usually what you want: their
plugins keep their authors' defaults, and a plugin that improves its own default still can.

It also means a preset is not a photograph. Apply one and anything it does not mention goes back to
its plugin's default, which is why `apply` lists what moved.

Export fills in `plugins` for any plugin you installed from npm. A plugin you copied into
`~/.rigline/plugins` yourself has no record of where it came from, so the preset says it is needed
and cannot say where to get it — add a note in the file, or a line in the message you send with it.

Then open the file and write a `description`. The rest is yours to edit: it is ordinary YAML, and
Rigline keeps your comments when it reads one.

## Applying one from the panel

The Rigline row's Edit button has a **Presets** button beside *Reset to defaults*. Pick one and you
are looking at it: nothing is written until you press *Save*, and *Revert changes* puts your own
layout back. That is the easy way to try one, and it costs nothing to change your mind.

Your own presets are listed above the ones Rigline ships. A file Rigline cannot read is listed too,
greyed out, with the reason — so a preset you have just edited by hand says what is wrong with it
where you can see it.

A preset that names elements you have not got says so on its row, because of what a save here does
to them. The panel cannot show a row with nothing in it, so a row holding only those elements is
not on screen, and *Save* writes what is on screen — which drops it. That is the one place the
panel and the terminal differ: `rigline layout apply` keeps the entry and waits for the plugin.
So if a preset names a plugin you mean to add, add it first and then rearrange things in the panel.

New presets reach an open panel through *Reload*, which picks up both your layout and your list. If
you have just run `rigline layout export`, the Rigline pill turns yellow to say so.

## When Rigline refuses a preset

A preset is a file that may have come from anywhere, so Rigline would rather refuse one than do
something other than what it says. It writes nothing and names the problem when a file:

- has no `layout`, which is usually the key misspelt;
- has a key Rigline does not know, at the top level or inside `preset` — a typo, or a setting from a
  later Rigline, which `rigline update` would read;
- names a place Rigline cannot read, such as `rigRow 1` (the first row is `rigRow`);
- is not valid YAML, is not a mapping, or has something other than a list of names under a place;
- is implausibly large, or names a place or an element with control characters in it.

An element whose plugin you have not got is *not* a refusal. That is the whole point of the
`plugins` block.

## The presets Rigline ships

- **minimal** — one footer line, and no rows under the composer.
- **two-rows** — context on the first row, what the session is costing on the second.
- **everything** — every element the bundled plugins have, on, to see what there is.

`rigline layout presets` lists them with anything of your own. A preset of yours with the same name
as a shipped one wins, and the listing says so. To get back to the layout Rigline starts with,
there is no preset to apply: `rigline layout reset` is that, and so is *Reset to defaults* in the
panel. [config.md](config.md) shows what that layout is.

## The files

`~/.rigline/presets/` holds yours, one `.yaml` file each, named without the extension. Put a file
there by hand and it lists like any other.

`~/.rigline/previous-layout.yaml` is what the last `apply` replaced, which `undo` reads. It is an
ordinary preset, so you can read it, copy it, or apply it by path.
