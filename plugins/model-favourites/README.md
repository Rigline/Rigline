# model-favourites

Your usual model and effort combinations, one click each, and what is live with its version.

## What it shows

- **Favourite chips**, in the row under the composer's controls: one per favourite, reading as the
  version its model resolves to now, such as `Opus 5.5 · high`. A click switches to it, model and
  effort together.
  - The one that is live is highlighted.
  - The one that is also your default, Rigline's own setting, reads `(default)`.
  - A favourite your install does not offer, or with an effort its model does not take, is dimmed,
    and its tooltip says which.
  - When what is live is none of them, it leads the row in the warning colour, so a change made
    somewhere else does not go unnoticed. Your default is not a warning, favourite or not.
  - With none set, a dimmed *No favourites* opens the settings tab.
- **The live model**, a pill beside the composer's own controls: what is live, with its version.
  - In the warning colour when it is none of your favourites and not your default.
  - Dimmed while a new session is waiting for a model to be chosen, which happens only where you
    have asked Rigline to ask ([config.md](../../docs/config.md#choosing-a-model-before-you-send)).
  - A click switches to your default. With no default set, it opens Rigline's settings tab, where
    the default is chosen.
- **Model favourites…** in Rigline's menu, which opens the settings tab.

Nothing is a warning until you have set something up: with no favourites and no default, there is
nothing to be off.

Both pills are elements, so they can be moved or switched off from Rigline's menu or with `rigline
layout`. The live model also fits in the row.

## The settings tab

*Model favourites* in Rigline's settings screen holds the list. Reorder and remove them there, add
one by choosing a model and then its effort, or add what is live in one click. A favourite of a
model with effort levels needs one, so it never leaves the effort wherever it happened to be. The
screen's Save writes the list.

The default is not set here. It is Rigline's own setting, on Rigline's tab, because Rigline's gate
compares against it too; the tab shows it and has a button there.

## In `config.yaml`

    settings:
      model-favourites:
        favourites:
          - { model: opus, effort: high }
          - { model: sonnet, effort: medium }

Each favourite has the shape of Rigline's `model.default`: a `model`, as Claude Code names it, and
`effort` for a model with effort levels or `thinkingLevel` for one without, never both, and
`ultracode` if you want it. `opus` follows the latest Opus; a pinned id stays put. An entry that is
not one of these is kept, listed in the tab as unreadable, and draws no chip.

## What it depends on

- **`models`**: `ctx.onModelState`, which models your install offers, what is live, and your default.
- **`modelChoice`**: `ctx.applyChoice`, which applies a favourite on your click, through the same
  requests the panel's own pickers send. Claude Code writes the model and effort to your settings
  exactly as it does when you use those pickers.
- **`menu`** and **`settingsTab`**: the menu entry and the tab.

How the model state is derived and how a choice is applied are D120 and D139 in
`docs/decisions.md`.
