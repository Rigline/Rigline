# Rigline 1.0 plan

The working document: what is being built, in what order, and where it stands. Durable rules live
in [decisions.md](decisions.md); this file is about getting to 1.0. Phases 0 to 4b and 6 and
milestone 7 are done, and milestone 8 is built with one live read owed, in **Next session**.
Delivery has its own document, [ci.md](ci.md) — the branching rule, the release commands and the
two workflows.

## What Rigline is

A plugin layer for the Claude Code VS Code extension. A small loader is injected into the installed
extension's webview bundle; plugins are written against a capability-scoped context the loader
provides; and a toolchain harvests the identifiers plugins depend on from whichever extension
version is installed, so an extension update is a diff to read rather than a breakage to chase.

The ambition is a community-maintained system in the spirit of Forge for Minecraft: a
stable-enough API over a host that changes weekly by design, with the fragile parts owned in one
place and the extension points curated.

The user's story is short and the design answers to it: find a plugin, install it, keep it updated
without thinking about it.

**session-id, time-marks and worktree-prefix are why Rigline exists.** They are the gaps that
motivated building a plugin layer at all, not demonstrations of one — the layer is how they get
delivered, and a Rigline a person installs without them is a loader with nothing in it. Read
anything about their distribution, their versioning or what ships by default in that light: they are
the product, and the probe is the instrument that says whether the product is working. The two
plugin-facing documents, [authoring.md](authoring.md) and the scaffold, address a future
contributor; these three address the person the whole thing is for.

## Inputs

- **A bundle corpus** at `c:\dev\kb\vscode-claude-code-versions\<version>\` holding `extension.js`,
  `webview/index.js`, `webview/index.css` and `package.json` per version. The extension deletes
  superseded directories on update, so snapshot a new version there before it goes.

## Physics

Four facts about the host force the shape of everything else.

- The webview CSP has no `connect-src`, so nothing in the webview can read a file or fetch. Plugin
  discovery therefore happens at install time in Node and is baked into a module the loader imports.
- The app calls `acquireVsCodeApi` exactly once, at boot, and every outbound message goes through
  the object it returns. A wrapper installed before boot is the single egress and the only place a
  tap or a rewrite can live.
- The extension host has required `extension.js` before any webview code runs, so a change to the
  host bundle can only happen at install time, and only takes effect after a window reload.
- A throw in a statically imported module fails the whole module graph and the panel renders blank
  with no attribution. Only Rigline's own pre hook may be static; everything else loads dynamically
  in its own try/catch.

## Architecture

### Packages

pnpm workspace, TypeScript throughout, every package a real package with its own tests.

| path | package | what it is |
| --- | --- | --- |
| `packages/core` | `@rigline/core` | Node library: locate installed extensions, harvest identifier layers, generate types and runtime tables, inject and restore, discover plugins and bake the registry, run the install flow, watch for updates, hold the curated anchor table. Ships `dist/bundled` — the payload and the four first-party plugins (D71) — so it is what a published install injects from. The CLI and the companion both run it as a child process (D69, D80). |
| `packages/cli` | `rigline` | The retrieval layer (D69): installs `@rigline/core` under `<RIGLINE_HOME>/engine`, spawns its `rigline-engine` bin, and forwards every verb but the two that are about acquiring bytes — `update` and the remote half of `add`. Answers `--version` itself. Depends on no Rigline package, and belongs in no project's dependencies. |
| `packages/host` | `@rigline/host` (private) | The injected runtime: `pre.js` (bus tap, buffer, rewrite chain, React devtools hook, meters) and `post.js` (kernel plus capability modules), and `runtime/`, the React plugins import (D87). |
| `packages/plugin-api` | `@rigline/plugin-api` | What a plugin is written against: `PluginContext`, the manifest type and JSON schema, `definePlugin`, the anchor names, and the pure helpers shared by host and core (capability contracts, session rule, stream shape, transcript derivations). |
| `packages/create-plugin` | `create-rigline-plugin` | The scaffold: `template/` as real files, copied and substituted. Published, and the only package here whose payload is not code. |
| `packages/vscode` | `@rigline/vscode` (private) | The companion extension (D80): a second retrieval layer that acquires the engine, watches for an extension update and spawns the engine to re-inject. Built to `rigline.vsix`, which ships in core's `dist/bundled`. |
| `packages/harness` | (private) | The Playwright tier: boots the real webview bundle from the corpus with a faked `acquireVsCodeApi` and a replayed bus. |
| `plugins/session-id` | first-party plugin | Session id in the composer footer, and the full id and messaging address as elements that start off; every identifier in Rigline's menu. |
| `plugins/worktree-prefix` | first-party plugin | Worktree prefix on the session tab label; declares the worktree-list host patch. |
| `plugins/time-marks` | first-party plugin | Clock times and pause dividers on transcript rows. |
| `plugins/probe` | first-party plugin | The live integration harness: a check per capability, and the diagnostics in Rigline's menu. |
| `docs/` | | Plan, decisions, topic docs, authoring guide, archive. |

Plugins that exist to be refused (unknown class, unknown field, failed required patch) are module
source strings the harness hands `preparePayload`, not a directory: nothing on disk, so nothing
discovery could install (D17).

Each first-party plugin: `rigline.json`, `package.json`, `src/index.ts`, `src/*.test.ts`,
`README.md`, built by `rigline-engine build` to `dist/index.js`. The distributed form of any plugin is one
browser ES module plus its manifest; the TypeScript and the preset are conveniences.

### Three registries

Three kinds of thing get added over the life of the project: a place in the extension to depend
on, a capability a plugin can use, and a well-known name for a piece of UI. Each gets a registry so
that adding one is a module or a table row.

**Identifier layers** (core). A layer is a module implementing one interface: `harvest(bundles)`,
a `floor` that guards the harvest's own regex rather than judging the extension, `diff(a, b)`, and
a declaration check. The five: CSS-module classes (a module-scoped map, with per-class application
counts); the protocol in four directions, each from its own dispatch-site anchor; outbound payload
fields, intersected across send sites and marked partial where a spread hides keys; host replies,
derived from the request side; and React internals, asserted rather than collected. Codegen, the
stability diff and the install gate iterate the registry; nothing else knows the list.

**Capabilities** (contract in plugin-api, grant in host, check in core). A capability module
carries: its manifest key and schema fragment; its expansion into identifier-layer dependencies;
the sentence `describeUses` prints; the runtime grant that builds its slice of `ctx` for one plugin;
its diagnostics; and its probe check. The `post.js` kernel loads the registry, checks declarations,
builds each plugin's `ctx` by asking every capability module for its slice, and isolates failures.
The eleven: `classes` (raw `cls`), `anchors` (curated), `messages` (`onMessage`), `mount` (`mount`,
`mountAfter`, `mountBefore`, `watch`), `style`, `rewrites` (`rewrite`, `resend`), `tools`
(`onToolUse`, `onToolResult`), `session` (`onSessionId`), `transcript` (`decorateTranscript`),
`menu` (`menu`, D88), and `surface`.

**Anchors** (core table; names flow to plugin-api). The curated map from a stable name to a
module-scoped class and the selector it resolves to: `modelPill` is `{ module: "gGYT1w", local:
"modelPill", kind: "singleton", refine: '[role="combobox"]' }`. Plugins declare and use names; the
install flow validates the table once per extension version; a retired or newly ambiguous anchor is
reported against the table and refuses only the plugins that use it. This is Rigline's mappings
file, in the Forge sense. Raw `cls(module, local)` stays available as the escape hatch, so nobody
is blocked on curation.

### The manifest

`rigline.json`, `api: 1`.

```json
{
  "$schema": "node_modules/@rigline/plugin-api/schema/manifest.json",
  "api": 1,
  "name": "session-id",
  "description": "The panel's session id, in the composer footer.",
  "entry": "dist/index.js",
  "surfaces": ["editor", "sidebar"],
  "uses": {
    "anchors": ["footerSpacer"],
    "classes": { "8RAulQ": ["menu"] },
    "messages": ["io_message"],
    "rewrites": { "rename_tab": ["title"] },
    "tools": true,
    "session": true,
    "style": true,
    "optional": {
      "anchors": ["worktreePill"]
    }
  },
  "patches": []
}
```

**`uses` is a dependency manifest, and that is the whole of its job.** Every key names something
the plugin needs the installed extension to still have, so that an update which retires one refuses
the plugin by name (P2) instead of leaving it subtly broken, and so that `describeUses` can say what
a plugin does when somebody asks. `uses.optional` mirrors it key for key, is checked the same way,
and reports rather than refuses (D41). `patches` stays top-level because it is not a use
of the webview; it changes the extension host. Package metadata (`version`, `homepage`,
`repository`, `license`) comes from `package.json`; the manifest carries only what the installer
needs without executing anything.

### What a plugin can do

Plugins run in the app's realm with full DOM access and can read every message on the bus. That is
the same trust a VS Code extension asks for, and it is documented as such rather than dressed up.
Installing a plugin is the act that says yes and nothing after it asks again (D26).

What the system does add is shape: a read tap is handed a frozen clone and cannot write; a write is
a patch over declared fields of a message the app already chose to send; the app's message reaches
the extension host whatever a plugin does (P4); one plugin's failure never costs another (P3); and
every host patch is reversible from `extension.js.orig` without the user having predicted anything.

### Surviving an extension update

The extension updates roughly weekly and users take it almost immediately, so the failure that
matters is not a spread of old versions to support: it is the window between an update landing and a
plugin's maintainer catching up. Four mechanisms shorten that window, ranked by what they buy.

- **The anchor table and its local override** (D7, D44). The only repair that works without the
  plugin's author: one curated entry, fixed once, repairs every plugin that used the name, and
  `~/.rigline/anchors.json` lets that fix reach users the day it is found rather than the day it is
  published. This is the argument for curating aggressively, and for counting a plugin's raw `cls()`
  calls at install, since those are the dependencies no table fix can reach.
- **Optional declarations** (D41). Turns the loss of one decoration into the loss of one decoration,
  rather than the whole plugin.
- **The install-time check** (D43). The user learns what broke, by identifier, at install; the
  maintainer gets that name in the bug report.
- **Successor suggestions in the diff** (D45). When the maintainer or the curator does sit down, the
  diff already names the likely replacement.

Backward compatibility is deliberately absent from that list (D42): a plugin ships one build, and
per-version variants ask an author to predict a release that does not exist yet.

### Where state lives

The repo commits `generated.ts` **at the workspace root** as the baseline the first-party plugins
compile against — our own harvest, not something published (D40); a plugin author runs `rigline
codegen` in their own repo and commits theirs. It sits at the root so that keeping a harvest out of
the published package is a property of the layout rather than an exclusion rule somebody has to
remember, so that one file serves every plugin in the repo the way the phase 4 template needs (D50),
and so that the default `rigline codegen` output is the same rule for us as for an author. The file
imports nothing. It carries the module augmentation D40 describes, `EXTENSION_VERSION`, and `SCAN`,
the harvest reduced to its layer views, which is the baseline the install flow diffs against (D29).

A user's machine keeps its own state under `~/.rigline/`: `config.yaml` (what a person decides,
D91), `sources.json` (the source each installed plugin came from — both the engine's to write, D74),
`plugins/` (installed third-party plugins), `anchors.json` (local overrides and additions to the
curated anchor table), `baseline.json` (the last harvest), `drift.txt` (what moved at the last
install that found drift, D98), `engine/`, the npm prefix `rigline`
installs `@rigline/core` into (D73), and `.lock`, held while an engine installs so the CLI and the
companion cannot install over each other. A clone of this repo is for developing Rigline, not for using
it.

### Distribution

`@rigline/core`, `@rigline/plugin-api`, the `rigline` CLI and `create-rigline-plugin` are published
to npm; plugins are npm
packages carrying a `rigline.json` and a built entry, installed with `rigline add <spec>`, or a
local directory during development. The version-specific half (identifier tables, registry, resolved
anchors) is derived on the installing machine from the bundle in front of it, so there is no version
matrix to ship, and no published type union doubles as an extension-version pin (D40).

**The four first-party plugins are not among those npm packages**: they ship inside `@rigline/core`
as bundled assets and are discovered in place, versioned with the engine (D71, D72). They are the
product rather than demonstrations of it, so a default install has them, and an update to Rigline is
an update to them. Installing your own of the same name shadows one, which is the escape hatch;
`rigline disable` is the only other way to decline one.

`add` resolves the version, refuses anything younger than the minimum release age unless `--now` is
passed, fetches and integrity-checks the tarball, and extracts it — no package manager runs, because
a plugin is one bundled ES module and a manifest (D47, D48). That half is the wrapper's: it vets the
container and hands the engine a directory, and the engine vets the content and writes the source
record into `sources.json` by kind, pinned version and integrity, which is what lets `update` fetch a
newer one later (D49, D70, D74).

Our own packages publish from CI: OIDC to npm so no credential sits in the repo, `npm stage publish`
into a queue, a human approving with 2FA (D46). That is release hygiene for our packages and the
template's default, not a claim about any plugin. Publishing anything is Leo's step.

## Phases

Each phase ends with a commit and a status-log entry.

### Phase 0: record and scaffold — done 2026-09-13

Archive, plan and decisions in `docs/`; corpus snapshot outside the repo; pnpm workspace with
TypeScript 7, Rolldown, Vitest and Biome.

### Phase 1: core harvest and codegen — done 2026-09-13

The identifier-layer registry and its five layers, every regex derived against the 2.1.270 bundle
and pinned by synthetic fixtures plus the corpus. Codegen (`generated.ts` plus the runtime tables
written per extension directory), byte-stable under `--check`. The extension locator, the
pristine-bundle rules, the stability diff, and the anchor table.

### Phase 2: injector, host kernel, probe — done 2026-09-14

Inject, restore and status with byte-faithful I/O and the backup file as the authority. `pre.js`
and `post.js` as kernel plus capability modules. The probe as a first-party plugin, with a check
per capability — written in the probe itself, which is what phase 6 revisits. The Playwright spike
succeeded and is now `packages/harness`.

### Phase 3: plugins, build preset, install flow, CLI — done 2026-09-14

`uses.optional` and the `ctx.optional` grants (D41). The augmentable identifier interface (D40),
pinned by a test that drives `tsc`. `rigline build` and `rigline dev`. The three plugins in
TypeScript. The install-time declaration check (D43), successor suggestions (D45), the install flow
and its watcher, and the CLI.

Three bodies of work landed after the phase closed and belong to it: anchor ambiguity (D7 amended —
`kind` split three ways, application-site counts, selector resolution, runtime multiplicity), the
composer-footer damper (D54), and observability (D53).

### Phase 4: the community layer — done 2026-09-19

The local anchor override, `~/.rigline/anchors.json` (D44, [anchors.md](anchors.md)). `rigline add`
from a path and from npm, `remove` and `update`: a tar reader of our own, exact versions only, and a
source record per plugin (D47 to D49, D56 to D58). The authoring guide and the
`create-rigline-plugin` template, carrying CI and the publish workflow (D50,
[authoring.md](authoring.md)). The six topic docs, [architecture.md](architecture.md) and its five
siblings. Our own release pipeline, first proven on `1.0.0-alpha.1` (D46,
[releasing.md](releasing.md)).

### Phase 4b: the changelog, and the release pipeline — done 2026-09-20

Delivery outgrew a phase entry. The model, the branching rule, the two workflows and what is still
outstanding live in [ci.md](ci.md); [releasing.md](releasing.md) is the runbook.

### Phase 5: companion VS Code extension — promoted to milestone 8

### Phase 6: a plugin contributes its own diagnostics — done 2026-09-21

A check is contributed rather than written into the probe: the kernel and each capability module
under `core`, and each plugin through `ctx.check` (D63 to D68). Read live on 2.1.278.
[history-m6.md](history-m6.md) is the archaeology; [host.md](host.md),
[verification.md](verification.md) and [authoring.md](authoring.md) are the reference.

## Milestone 7: distribution — done 2026-09-23

`rigline` became a retrieval layer over the `@rigline/core` engine, and the payload and the four
first-party plugins ship inside core (D69 to D75). [history-m7.md](history-m7.md) is the
archaeology and [architecture.md](architecture.md) the reference.

## Milestone 8: the companion extension — built 2026-09-23

A VS Code extension that notices a Claude Code update and re-injects, acquiring and running the
engine rather than embedding it (D76 to D85). [history-m8.md](history-m8.md) is the archaeology and
[companion.md](companion.md) the reference. One live read is owed.

## Plugin UI in React — done 2026-09-25

Plugins write React, rendered in one root Rigline owns (D87, D88): the RIG menu (D89), elements a
plugin declares and a person places (D90 to D92), a Layout submenu that saves through the companion
(D93), editing in place (D95), place names for a person (D96), and Rigline's own Edit and Reload
buttons (D97). [host.md](host.md) and [architecture.md](architecture.md) are the reference,
[authoring.md](authoring.md) the author's guide and [config.md](config.md) the user's. One read is
owed: a Save through a released engine, since every save so far ran this checkout's engine through
`rigline.enginePath`.

## Open questions

The work after milestone 8. None of it is planned yet, and each wants a decision before anything is
built. The first two change what a plugin is written against.

- **Whether a plugin may have the resolved selector**, as `ctx.selector(name)`. `ctx.anchor()` hands
  back a bare class, which serves the two uses D7 names — borrowing a class for your own markup, and
  the host querying for you. It leaves a third: a plugin writing CSS *about* the app's own elements,
  which can only be scoped to the class and so lands on every control wearing the look. Recommended
  but not taken, because it is the first plugin-facing API that hands over something version-derived
  and composable. Until it is settled the authoring guide says: scope a rule to something you
  placed, never to an anchor's bare class.
- **Whether `ctx.style` refuses a selector naming a class the plugin did not declare, or only
  lints.**
- **Anchor governance** (D44): who may add to the table, and what evidence an entry needs. Half of
  the promotion path exists already: an override whose anchor this version resolves without it is
  reported as changing nothing, which is the signal that the shipped table has caught up and the
  entry can go. What is missing is the other end — how an entry gets into the shipped table, and on
  whose say-so.
- **Whether macOS has to be run before 1.0.** Nothing has run there: CI is Linux and one Windows row
  ([ci.md](ci.md)), and every live read has been on Windows.
- **What 1.0 needs.** This plan names milestones, not the bar a 1.0 release has to clear.
- **The protocol between the wrapper, the companion and the engine.** It was never designed: verbs
  and exit codes, `RIGLINE_DEFER_INJECT` (D98), `companion-status` (D99), `companion-profiles`
  (D100) and the Save link (D93), each added where one was needed. The aim is that everything runs
  current versions, which `update` and the companion's self-update keep it at, not two-way
  compatibility paid for in flexibility.
- **The React layer does not survive the app moving to React 19.** React 19's devtools injection no
  longer passes `findFiberByHostInstance`, and the React layer asserts that literal (D11), so the day
  Claude Code ships React 19 the harvest fails and `install` refuses that version outright — every
  plugin, not only the transcript's. The `"__reactFiber$"` key prefix is an unminified literal in
  both majors and is the obvious replacement.

## Deferred, with triggers

- **Per-plugin settings.** time-marks keeps its toggle in `localStorage`, which is right for a value
  only the panel cares about. A `ctx.settings` API earns its place when a value must be editable from
  outside the panel.
- **What a diagnostic check may do**, left open by phase 6. Be `async`: no for now, because lines
  landing at different times make the badge count briefly wrong. Be collapsed per contributor: when
  `core` outgrows a screen. Ask for host state: that is a request for a capability, decided by name.
- **`rigline corpus fetch <version>`**, a Marketplace VSIX into the corpus. Every version so far was
  snapshotted from a live install; the trigger is one that was missed.
- **Line tags for a superseded major** ([ci.md](ci.md)): when a `2.x` branch opens.

- **git as a plugin source.** No publish ceremony and no npm account: GitHub, GitLab and Codeberg
  serve `archive/<ref>.tar.gz`, which the tar reader already handles, with `{kind: "git", url, ref,
  sha}` as the source record D49 left room for. Its one cost is that the built entry must be
  committed at the ref, since an author's build never runs on a user's machine (D33). Revisit D33
  when it is taken.
- **A plugins repository**, the home for a first-party plugin that is not part of the product.
  Triggered by the first such plugin; the git source comes first.
- **Merging layout edits from several sources.** A save from the panel overwrites the file's layout
  and warns when that replaces a change made since the panel loaded (D92). Revisit when that warning
  costs somebody work.
- **Decorations in React.** Per-row transcript decorations stay DOM. Triggered by a decoration DOM
  makes painful; first answer the cost of one portal per row at several hundred rows, and the frame
  in which a new row's node is empty before React renders into it.
- **Menu order in `config.yaml`**, as a list of plugin names beside the layout (D89). Triggered by
  somebody asking to reorder the RIG menu.
- **A JSON Schema for the layout**, generated at install from the installed elements, so an editor
  with a YAML language server completes element and place names. Triggered by hand-edited layouts
  going wrong.
- **The RIG pill as an element** (D97). Triggered by somebody asking to move it; weigh a person
  switching off the one control that always reaches the menu.

## Next session

`1.0.0-alpha.11` is the newest on `latest`, and carries the plugin UI. The work now is the open
questions above. None is planned yet, so the next step is to pick one and settle it.

The reads below are owed and deferred: exercise each when it comes up, not as a gate.

**A Save through a released engine.** On a machine with `alpha.11` installed and
`rigline.enginePath` unset, edit the layout in the panel and Save: the notification should say it
saved, the panel should leave editing, and `~/.rigline/config.yaml` should hold the layout.

**`ready` (D85), on the next Claude Code update.** When the new version lands under a running
window, the status item should go to *Rigline: ready to restart* and stay there until a restart.
Check the output channel for the `installed:` line first, which is what says the update actually
arrived. If you would rather not wait, [companion.md](companion.md)'s *Reading it live* has the
recipe for forcing one. When it reads clean, milestone 8 is done.

**After the next release, `rigline vscode-setup` once on each machine.** The companions installed
now predate self-update (D99) and sync; the one run makes them machine-scoped and able to follow the
engine from then on, and puts one in every profile with Claude Code (D100).

**The companion adding itself (D100), after the next release**, on a machine with
`rigline.enginePath` unset, since a dev companion adds nothing:

1. Make a profile and install Claude Code into it from a window of that profile.
2. Reload a window of a profile that has the companion. Its output channel should say it added the
   companion to the new profile, and the new profile's open window should start the companion
   without a restart.
3. Uninstall the companion there, and the next reload elsewhere puts it back. Disable it, and it
   stays disabled.
4. `rigline update` should print the line when it adds the companion.

Still unread: a remote window, and the directory names of the VS Code forks.

## Status log

One entry per piece of work completed, a sentence long, newest last. The reasoning is in
[decisions.md](decisions.md), the story in the history docs, and the diffs in git.

- 2026-09-13: Phase 0: archive, plan and decisions, the corpus, the workspace.
- 2026-09-13: Phase 1: the five identifier layers and codegen, harvested from 2.1.270.
- 2026-09-14: Phase 2: injector, host kernel and probe; superseded payload directories are deleted.
- 2026-09-14: Distribution is npm with a CI publish pipeline (D46 to D50).
- 2026-09-14: Phase 3: the plugins, the build preset, the install flow and the CLI.
- 2026-09-14: Mounts re-placed on the React commit signal, by position rather than presence (D52).
- 2026-09-14: Anchor ambiguity: `kind` split three ways, and anchors resolve to selectors (D7).
- 2026-09-14: Observability: rates, peaks, and a ring that survives the window (D53).
- 2026-09-14: The composer-footer damper, and footer decorations on `footerSpacer` (D54).
- 2026-09-15: `install` is the one write command and `check` its read-only half (D55).
- 2026-09-18: `rigline list`, and `doctor` cut back to Rigline's own install state (D53).
- 2026-09-18: The template and the authoring guide (D50).
- 2026-09-18: `add` from a path and from npm, `remove` and `update`, over our own tar reader (D56 to
  D58).
- 2026-09-18: The local anchor override, `~/.rigline/anchors.json` (D44).
- 2026-09-19: The six topic docs, and the code brought into line with them.
- 2026-09-19: Line endings left to git (D37).
- 2026-09-19: The release workflow on `Rigline/Rigline`, and all four packages bootstrapped to npm.
- 2026-09-19: `1.0.0-alpha.1` through the pipeline, attested; phase 4 done.
- 2026-09-20: `1.0.0-alpha.2` to `latest`, and the published scaffold driven end to end.
- 2026-09-20: CI on every push and pull request, over three Node rungs and a Windows row (D59).
- 2026-09-20: The template ships CI (D50), and Dependabot watches the action pins (D59).
- 2026-09-20: `CHANGELOG.md`, `pnpm release` and `release:finish` (D60, D61); phase 4b done.
- 2026-09-20: Phase 6 built, and its first live read fixed two checks (D63 to D68).
- 2026-09-21: `1.0.0-alpha.4`, the first release driven end to end (D61).
- 2026-09-21: Phase 6 done, on a live read of both surfaces.
- 2026-09-21: 2.1.278 snapshotted and `generated.ts` regenerated; every plugin survived it.
- 2026-09-21: 7a: core ships the payload and the plugins, and tier 4 installs the tarballs;
  `1.0.0-alpha.5`, read live.
- 2026-09-21: 7b: the wrapper and the engine are separate processes (D69, D70, D73, D74);
  `1.0.0-alpha.6`.
- 2026-09-21: `update` applies the age gate only when an engine is installed.
- 2026-09-21: The scaffold's release-age exclusion (D50), the reply-table check, and the
  `hostBackupIsCurrent` decline (D86).
- 2026-09-21: Phase 5 promoted to milestone 8; compliance position and plugin policy published (D76
  to D79).
- 2026-09-21: `1.0.0-alpha.8`: 8a, `vscode-setup`, the home lock, and `install` refusing an
  unfinished directory (D80, D81, D83). Releases cut from green CI after `alpha.7` was spent.
- 2026-09-22: `1.0.0-alpha.9`, and 8a read live on a laptop.
- 2026-09-22: 8b: the reload offer, and the directory scan that replaced `extensionUri` (D76, D82).
- 2026-09-22: 8c settled read-only and built (D84).
- 2026-09-23: `ready` (D85).
- 2026-09-23: `1.0.0-alpha.10`: 8b, 8c and `ready`.
- 2026-09-23: Milestones 7 and 8 condensed into history docs, with the companion's reference in
  companion.md.
- 2026-09-23: 2.1.280 snapshotted, `generated.ts` regenerated and the harness moved to it; two
  classes gone, neither ours.
- 2026-09-23: `rigline update` moved a published `alpha.8` engine to `alpha.10` and re-injected;
  milestone 7 done.
- 2026-09-23: 8c's *Rigline: Show Plugins* read live.
- 2026-09-23: Plugins write React: one React served by the panel (D87), and the shell with the RIG
  menu (D88, D89).
- 2026-09-24: Elements and `rigRow` (D90), settings in `config.yaml` (D91), the layout and `rigline
  layout` (D92), and the Layout submenu saving through the companion (D93).
- 2026-09-24: The kernel seals `acquireVsCodeApi` before plugins load, and D79 claims only what that
  backs.
- 2026-09-25: `rigline.enginePath`: the companion runs a checkout's engine (D94).
- 2026-09-25: Editing in place (D95), place names (D96) and Rigline's own buttons (D97); plugin UI
  done.
- 2026-09-25: `1.0.0-alpha.11`: the plugin UI.
- 2026-09-25: `vscode-setup` installs the companion outside Settings Sync.
- 2026-09-25: The report ends with what to reload, then what needs you (D98).
- 2026-09-25: The companion updates itself from the engine it runs, read live (D99).
- 2026-09-25: The companion goes into every profile that has Claude Code, and is added where it is
  missing (D100); read end to end against a scratch VS Code.
