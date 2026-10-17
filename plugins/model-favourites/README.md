# model-favourites

Your usual model and effort combinations, one click each, and a pill for your default.

## What it shows

- **Your favourites as one pill**, in the row under the composer's controls. Favourites next to each
  other on one model share its segment, named by the version it resolves to now, and each has a
  segment of its own after it: `Opus 5.5 │ xhigh │ low │ Sonnet 5.5 │ medium`. A click on a
  favourite switches to it, model and effort together; a click on a model switches to the favourite
  beside it.
  - A model is highlighted while it is live, and a favourite while it is exactly what is live. A
    model lit with none of its favourites means it is live at an effort that is not one of them.
  - A favourite your install does not offer, or with an effort its model does not take, is dimmed,
    and its tooltip says which.
  - With none set, a dimmed *No favourites* opens the settings tab.
- **Your default**, a pill that starts off: the model and effort it sets, highlighted while it is
  live. A click switches to it. With no default set it reads *No default*, and opens Rigline's
  settings tab, where the default is chosen.
- **Model favourites…** in Rigline's menu, which opens the settings tab.

A click does what Claude Code's own model picker does, through the picker itself, so the picker
shows the change and Claude Code saves the model and effort to your settings as it does when you
use it. If Claude Code refuses, the segment flashes *refused*, its tooltip gives the reason, and
Claude Code says why in its own notification.

Both pills are elements, so they can be switched on or off and moved from Rigline's menu or with
`rigline layout`. The default goes in the row or in the composer footer.

## The settings tab

*Model favourites* in Rigline's settings screen holds the list. Reorder and remove them there, add
one by choosing a model and then its effort, or add what is live in one click. A favourite of a
model with effort levels needs one, so it never leaves the effort wherever it happened to be. The
screen's Save writes the list.

The default is not set here. It is Rigline's own setting, on Rigline's tab, because Rigline's gate
compares against it too; this tab shows it and has a button there.

## In `config.yaml`

    settings:
      model-favourites:
        favourites:
          - { model: opus, effort: xhigh }
          - { model: opus, effort: low }
          - { model: sonnet, effort: medium }

Each favourite has the shape of Rigline's `model.default`: a `model`, as Claude Code names it, and
`effort` for a model with effort levels or `thinkingLevel` for one without, never both, and
`ultracode` if you want it. `opus` follows the latest Opus; a pinned id stays put. An entry that is
not one of these is kept, listed in the tab as unreadable, and draws no segment.

## What it depends on

- **`models`**: `ctx.onModelState`, which models your install offers, what is live, and your
  default, all as Claude Code's own picker holds them.
- **`modelChoice`**: `ctx.applyChoice`, which applies a favourite on your click, through the
  picker's own controls.
- **`menu`** and **`settingsTab`**: the menu entry and the tab.

How both model capabilities work is D120 in `docs/decisions.md`, and the default is D139.
