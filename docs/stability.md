# What 1.x keeps stable

Rigline's four packages — `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin` — release together, at one version, under semantic versioning. Within 1.x,
everything this page lists as kept keeps working. A plugin written against 1.2 loads on 1.9. A file
you wrote for 1.2 means the same thing on 1.9, and a command you scripted still runs. Only a 2.0 may
break any of it. Until 1.0.0 ships, an alpha may break any of it too.

Two kinds of change are not breaks, and the changelog names each. Fixing a bug is not, even where
something relied on it: a check that was meant to refuse something and did not gets fixed in a 1.x
release. Nor is closing a hole: if a plugin can reach something `ctx` was never meant to give it, a
1.x release may close it.

What Rigline cannot promise is Claude Code. It updates about weekly and owes us nothing. What we
promise instead is how Rigline behaves when it changes. A plugin that declared something Claude Code
removed is refused by name, never left half-working. If it declared that optional, or only placed an
element at it, it loses just that: the install says what went, and the plugin loads. Every other
plugin keeps loading. And `rigline restore` puts the extension back to its own bytes, and keeps
Rigline out until you put it back.

## For a plugin

**Kept within 1.x:**

- **The manifest.** `rigline.json` at `api: 1`, where every key keeps its meaning. A minor release
  may add a key, at any depth, or a value an existing key accepts. A plugin that uses one needs that
  release or later, and an older one refuses it by name, except for two things it names and does
  without: an anchor under `uses.optional` that it does not know, and a place for an element that it
  does not have.
- **`ctx`.** Every member keeps working as it does for code written against an earlier 1.x. A minor
  release may add a member, or let one accept more values for an argument it already takes; a new
  ability is always a new member. A plugin that reads a member an older release lacks is switched
  off by name, wherever it reads it, so test for one with `"name" in ctx`.
- **`@rigline/plugin-api`**, including `@rigline/plugin-api/ui`. Code written against an earlier 1.x
  keeps compiling and working, provided it handles a value it does not know. The types grow by a new
  export, a new member or union value in what Rigline hands you, and a parameter that accepts more.
  So a `switch` on `ctx.surface` wants a `default`: one that checks it has seen every surface stops
  compiling when a fourth arrives. A prop a minor release adds to a component is ignored by an older
  panel, so it is only ever cosmetic. Implementing Rigline's interfaces yourself, such as a
  `PluginContext` of your own for a test, is not covered, since a minor release adds to them.
- **React.** The panel serves plugins React 19, as four modules a built plugin imports by name:
  `react`, `react/jsx-runtime`, `react-dom` and `@rigline/plugin-api/ui`. Any other bare import
  fails at load. React's stable API stays at that major; its `unstable_*` exports and its internals
  can change in any React release within it. Moving the major is `api: 2`, and so a Rigline 2.0.
- **Anchor names.** A curated name is never removed or renamed. When Claude Code removes what a name
  points at, the name stops resolving, and plugins that require it are refused by name until the
  anchor table catches up or `~/.rigline/anchors.json` repairs it ([anchors.md](anchors.md)).
- **What gets a plugin refused.** No 1.x release adds a reason to refuse a plugin that an earlier
  1.x loaded, other than Claude Code having changed. New checks arrive in a major.

**Not kept, because they belong to Claude Code:**

- **Its identifiers:** the module hashes and class names you reach through `ctx.cls`, message types
  and their fields, and the text a host patch finds. The install checks what you declare, and names
  it when it goes. A field you only read is never declared, so one Claude Code drops reads as
  `undefined`, and handling that is yours.
- **Its panel:** the DOM's structure, order and timing.

**Not kept, because they are yours or a starting point:**

- **`generated.ts`**, your own harvest, regenerated from whatever you have installed.
- **What `create-rigline-plugin` generates.** A workspace you already generated is yours; a later
  release scaffolds new ones differently.

**Not kept, because they are Rigline's own:** `@rigline/plugin-api/internal` and
`@rigline/plugin-api/ui/internal`, through which Rigline's packages share code, and whatever
`@rigline/core` exports to JavaScript. A plugin workspace depends on `@rigline/core` for its
`rigline-engine` command, which is kept as `rigline` is.

## For your machine

**Kept within 1.x:**

- **`~/.rigline/config.yaml`.** Every key keeps its meaning, and a later 1.x reads what an earlier one
  wrote, comments included ([config.md](config.md)). A minor release may add a setting, always as a
  new key; an existing key never takes a new kind of value. An older Rigline names a key it does not
  know under what needs you, and does without it. A layout place beside a piece of Claude Code's
  panel stops resolving if Claude Code removes that piece: the entry stays in the file and is
  reported, and its elements go back to where their authors put them.
- **The words in that file that Rigline owns:** the layout's places — `rigRow`, `off`, and `before`,
  `after` or `inside` an anchor's name — and the names of the bundled plugins, their elements, and
  Rigline's own elements, `rigline/edit` and `rigline/reload`. A third-party plugin's names are its
  author's.
- **`~/.rigline/anchors.json`**, in the format [anchors.md](anchors.md) describes.
- **`~/.rigline/sources.json`**, where `rigline add` records each plugin's source. It is Rigline's
  record rather than a setting, but a later 1.x reads what an earlier one wrote.
- **A plugin you put in `~/.rigline/plugins/` yourself**, under the plugin rules above.
- **`$RIGLINE_HOME`**, which moves `~/.rigline` somewhere else. Set it where VS Code sees it too
  ([config.md](config.md)).
- **The commands in the usage, `rigline --help`, with their flags, and `rigline --version`.** A later
  1.x accepts every invocation an earlier one did, and an earlier one refuses a flag it does not know
  rather than ignoring it. The exit status is 0 when nothing needs you and 1 when something does.
- **`rigline list --json`**, which prints JSON and nothing else on stdout, even on the run that
  installs the engine: `{ "v": 1, "plugins": [...] }`, each plugin with
  - `name`, and `version` or null;
  - `origin`, which is `bundled`, `home` for `~/.rigline/plugins`, or `checkout`, and `dir`, where
    it is;
  - `enabled` and `overridesBundled`;
  - `source`: null for a plugin placed by hand, `{ "kind": "npm", name, version, tag }` with `tag`
    null when pinned, or `{ "kind": "path", from }`;
  - `description` or null, `can`, and `patches`, each `{ why, required }`.

  Fields may be added, never removed or renamed, and `origin` and `source.kind` may gain values.
  `can` and `why` are wording, like a report's.
- **The companion's command and settings:** *Rigline: Show Plugins*, `rigline.nodePath` and
  `rigline.enginePath`.
- **The backups beside Claude Code's bundles:** `webview/index.js.orig`, and `extension.js.orig` where
  a plugin patched the extension host. They are the undo when `rigline` itself will not run, as the
  [README](../README.md#if-the-panel-goes-blank) describes.
- **Where it runs:** VS Code on Windows, Linux and macOS, in a local window, with Node 22.12 or
  newer. A minor release may drop a Node version once it has reached end of life, or raise the
  oldest VS Code the companion supports, and the changelog says so.

**Not supported:** remote windows (WSL, SSH, dev containers, Codespaces), other editors built on VS
Code (Insiders, VSCodium, Cursor, Windsurf), a portable VS Code, and a custom extensions directory.
In any of them, Claude Code's panel stays as it ships.

**Not kept:**

- **The wording of any report.** It is written for a person, and reworded when it could say
  something better. Script against the exit status and `--json`.
- **The rest of `~/.rigline`**: `baseline.json`, `drift.txt`, `token`, `restored`, the locks and
  `engine/`. They are Rigline's own bookkeeping.
- **Anything else Rigline puts inside Claude Code's directory**, and where it puts it.
- **The commands and flags the usage leaves out**, such as `layout save`, `install --companion`,
  `companion-status` and `companion-profiles`. They are how Rigline's own pieces talk to each other.

## Between Rigline's own pieces

A wrapper, a companion or an open panel from 1.0 meets every later 1.x, so what each relies on in
the others is kept for the whole major. None of it is yours to use; [architecture.md](architecture.md)
lists it.

- **The wrapper** installs `@rigline/core` and runs its `rigline-engine` bin with your arguments.
  `rigline update` moves the engine and then hands everything else to it. That contract does not
  change within 1.x, which is why a 1.0 wrapper runs every 1.x engine. When a newer wrapper is out,
  it says so.
- **The companion** acquires the engine the same way, and updates itself from the engine it runs.
  What it asks of an engine holds for the major too, so a companion that has not updated itself yet
  works with whichever 1.x engine it has just moved to.
- **The panel's Save link** keeps its address, so an older companion carries a newer panel's save.
  Its payload carries a version, so an engine reads, or refuses by name, a link from a panel an
  older one set up.

## A major version

All four packages move together. The wrapper and the companion refuse an engine of another major,
and each says what to run: `npm i -g rigline@latest`, then `rigline vscode-setup`.
