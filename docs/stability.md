# What 1.x keeps stable

Rigline's four packages — `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin` — release together, at one version, under semantic versioning. Within 1.x,
everything on this page keeps working. A plugin written against 1.2 loads on 1.9. A file you wrote
for 1.2 means the same thing on 1.9, and a command you scripted still runs. Only a 2.0 may break any
of it. Until 1.0.0 ships, an alpha may break any of it too.

Two kinds of change are not breaks, and the changelog names either. Fixing a bug is not, even where
something relied on it: a check that was meant to refuse something and did not gets fixed in a 1.x
release. Nor is closing a hole: if a plugin can reach something `ctx` was never meant to give it, a
1.x release may close it.

What Rigline cannot promise is Claude Code. It updates about weekly and owes us nothing. What we
promise instead is how Rigline behaves when it changes. A plugin that depends on something Claude
Code removed is refused by name, never left half-working. Every other plugin keeps loading. And
`rigline restore` puts the extension back to its own bytes.

## For a plugin

**Kept within 1.x:**

- **The manifest.** `rigline.json` at `api: 1`, where every key keeps its meaning. A minor release
  may add a key, or a value an existing key accepts. A plugin that uses one needs that release or
  later, and an older one refuses the plugin by name.
- **`ctx`.** Every member keeps working as it does for code written against an earlier 1.x. A minor
  release may add a member, or let one accept more values for an argument it already takes; a new
  ability is always a new member. A plugin that reads a member an older release lacks is switched
  off by name, wherever it reads it, so test for one with `"name" in ctx`.
- **`@rigline/plugin-api`**, including `@rigline/plugin-api/ui`. Code written against an earlier 1.x
  keeps compiling and working. Types grow only in ways that keep that true: a new export, a new
  optional field, a parameter that accepts more. A prop a minor release adds to a component is
  ignored by an older panel, so it is only ever cosmetic.
- **React.** The major version the panel serves plugins stays the same. Moving it is `api: 2`, and so
  a Rigline 2.0.
- **Anchor names.** A curated name is never removed or renamed. When Claude Code removes what a name
  points at, the name stops resolving, and plugins that require it are refused by name until the
  anchor table catches up or `~/.rigline/anchors.json` repairs it ([anchors.md](anchors.md)).
- **What gets a plugin refused.** No 1.x release refuses a plugin that an earlier 1.x loaded, for a
  reason about the plugin rather than about Claude Code. New checks arrive in a major.

**Not kept, because they belong to Claude Code:**

- **Its identifiers:** the module hashes and class names you reach through `ctx.cls`, message types
  and their fields, and the text a host patch finds. Declare them, and the install says by name when
  one goes.
- **Its panel:** the DOM's structure, order and timing.

**Not kept, because they are yours or a starting point:**

- **`generated.ts`**, your own harvest, regenerated from whatever you have installed.
- **What `create-rigline-plugin` generates.** A workspace you already generated is yours; a later
  release scaffolds new ones differently.

**Not kept, because they are Rigline's own:** `@rigline/plugin-api/internal` and
`@rigline/plugin-api/ui/internal`, which is how Rigline's packages share code with each other.

## For your machine

**Kept within 1.x:**

- **`~/.rigline/config.yaml`.** Every key keeps its meaning, and a later 1.x reads what an earlier one
  wrote, comments included ([config.md](config.md)). A layout place beside a piece of Claude Code's
  panel stops resolving if Claude Code removes that piece: the entry stays in the file and is
  reported, and its elements go back to where their authors put them.
- **The names in that file that Rigline owns:** the bundled plugins, their elements, and Rigline's
  own elements, `rigline/edit` and `rigline/reload`. A third-party plugin's names are its author's.
- **`~/.rigline/anchors.json`**, in the format [anchors.md](anchors.md) describes.
- **A plugin you put in `~/.rigline/plugins/` yourself**, under the plugin rules above.
- **The commands in the usage, with their flags.** A later 1.x accepts every invocation an earlier
  one did. The exit status is 0 when nothing needs you and 1 when something does.
- **`rigline list --json`.** Fields may be added, but never removed or renamed.
- **Where it runs:** VS Code on Windows, Linux and macOS, with Node 22.12 or newer. A minor release
  may drop a Node version once it has reached end of life, or raise the oldest VS Code the companion
  supports, and the changelog says so.

**Not kept:**

- **The wording of any report.** It is written for a person, and reworded when it could say
  something better. Script against the exit status and `--json`.
- **The rest of `~/.rigline`**: `sources.json`, `baseline.json`, `drift.txt`, `token`, the locks and
  `engine/`. They are Rigline's own bookkeeping.
- **What Rigline puts inside Claude Code's directory, and where.**
- **The commands the usage leaves out**, such as `layout save`, `companion-status` and
  `companion-profiles`. They are how Rigline's own pieces talk to each other.

## Between Rigline's own pieces

- **The wrapper** installs `@rigline/core` and runs its `rigline-engine` bin with your arguments.
  `rigline update` moves the engine and then hands everything else to it. That contract does not
  change within 1.x, which is why a 1.0 wrapper runs every 1.x engine. When a newer wrapper is out,
  it says so.
- **The companion** acquires the engine the same way, and updates itself from the engine it runs.
  How it acquires the engine and asks whether it is current never changes within 1.x; the engine's
  other answers to it carry a version field.
- **The panel's Save link** carries a version field too, so an engine reads, or refuses by name, a
  link from a panel an older one set up.

## A major version

All four packages move together. The wrapper and the companion refuse an engine of another major,
and each says what to run: `npm i -g rigline@latest`, then `rigline vscode-setup`.
