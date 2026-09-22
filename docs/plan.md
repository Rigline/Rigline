# Rigline 1.0 plan

The working document: what is being built, in what order, and where it stands. Durable rules live
in [decisions.md](decisions.md); this file is about getting to 1.0. Phases 0 to 4b, phase 6 and
milestone 7 are done; **milestone 8, the companion extension, is what is open**, and
[m8-companion.md](m8-companion.md) owns it. Delivery has its own document, [ci.md](ci.md) — the
branching rule, the release commands and the two workflows.

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
| `packages/core` | `@rigline/core` | Node library: locate installed extensions, harvest identifier layers, generate types and runtime tables, inject and restore, discover plugins and bake the registry, run the install flow, watch for updates, hold the curated anchor table. Ships `dist/bundled` — the payload and the four first-party plugins (D71) — so it is what a published install injects from. The CLI and a future companion extension both consume it. |
| `packages/cli` | `rigline` | The retrieval layer (D69): installs `@rigline/core` under `<RIGLINE_HOME>/engine`, spawns its `rigline-engine` bin, and forwards every verb but the two that are about acquiring bytes — `update` and the remote half of `add`. Answers `--version` itself. Depends on no Rigline package, and belongs in no project's dependencies. |
| `packages/host` | `@rigline/host` (private) | The injected runtime: `pre.js` (bus tap, buffer, rewrite chain, React devtools hook, meters) and `post.js` (kernel plus capability modules). Built to exactly two files. |
| `packages/plugin-api` | `@rigline/plugin-api` | What a plugin is written against: `PluginContext`, the manifest type and JSON schema, `definePlugin`, the anchor names, and the pure helpers shared by host and core (capability contracts, session rule, stream shape, transcript derivations). |
| `packages/create-plugin` | `create-rigline-plugin` | The scaffold: `template/` as real files, copied and substituted. Published, and the only package here whose payload is not code. |
| `packages/harness` | (private) | The Playwright tier: boots the real webview bundle from the corpus with a faked `acquireVsCodeApi` and a replayed bus. |
| `plugins/session-id` | first-party plugin | Session id and inter-agent messaging address in the composer footer. |
| `plugins/worktree-prefix` | first-party plugin | Worktree prefix on the session tab label; declares the worktree-list host patch. |
| `plugins/time-marks` | first-party plugin | Clock times and pause dividers on transcript rows. |
| `plugins/probe` | first-party plugin | The live integration harness: a check per capability and the `RIG` badge in the composer footer. |
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
The ten: `classes` (raw `cls`), `anchors` (curated), `messages` (`onMessage`), `mount` (`mount`,
`mountAfter`, `mountBefore`, `watch`), `style`, `rewrites` (`rewrite`, `resend`), `tools`
(`onToolUse`, `onToolResult`), `session` (`onSessionId`), `transcript` (`decorateTranscript`), and
`surface`.

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

A user's machine keeps its own state under `~/.rigline/`: `config.json` (enabled plugins,
per-plugin settings, and the source each installed plugin came from — the engine's to write, D74),
`plugins/` (installed third-party plugins), `anchors.json` (local overrides and additions to the
curated anchor table), `baseline.json` (the last harvest), and `engine/`, the npm prefix `rigline`
installs `@rigline/core` into (D73). A clone of this repo is for developing Rigline, not for using
it.

### Distribution

`@rigline/core`, `@rigline/plugin-api` and the `rigline` CLI are published to npm; plugins are npm
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
record into `config.json` by kind, pinned version and integrity, which is what lets `update` fetch a
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

Deferred out of the phase and still open: `rigline corpus fetch <version>` for Marketplace VSIXs.

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

In order.

1. **`~/.rigline/anchors.json`, the local anchor override** (D44, amended) — done 2026-09-18.
   Merged over the shipped table, reaching the `generated.js` the loader reads, and named per
   version at install with what that version makes of it. [anchors.md](anchors.md) is its
   reference, written for a user rather than for us. It came first because it had to be there
   before anybody else installed a plugin, and that condition is now met.
2. **`rigline add` from a path, and `remove`** — done 2026-09-18. No network, and what makes
   `~/.rigline/plugins/` a managed directory rather than one people copy into. `add` is where
   `describeUses` says what arrived, at the moment it means something.

   `add <path>` validates the manifest as data against its own `name` rather than the source
   directory's, copies the directory through the same output filter the installer uses, records a
   source (D49), prints what the plugin can do and any host patch it declares, and re-injects so
   one reload has it in the panel. `remove <name>` is its inverse and refuses anything that is not
   in `~/.rigline/plugins/`. `config.json` grows `sources`, written back without losing keys
   nothing here knows about, and `list` says which plugins have no source record and so cannot be
   upgraded. Neither command runs a package manager or evaluates a plugin (D47, D12).
3. **`rigline add` from npm, and `rigline update`** (D47, D48, D49) — done 2026-09-18. The tarball
   fetch and integrity check, the minimum release age with `--now` and a report naming what was withheld and why, and
   the source record with its kind discriminator. D47's premise already holds: `rigline build`
   bundles everything the entry imports, `@rigline/plugin-api` included, so a published plugin has
   no runtime dependency to install and the template must keep plugin-api a *devDependency* as the
   first-party plugins do.

   Four pieces. A tar reader that refuses rather than reproduces (D57). A registry client: fetch a
   packument, pick a version by dist-tag and publish time, fetch and integrity-check the tarball —
   with the fetch injectable, because no test here touches the network. `add <name>` in front of
   what `add <path>` already does, and `update` over the recorded sources. Exact versions and tags
   only, no ranges (D58).
4. **The authoring guide and the `create-rigline-plugin` template** (D50) — done 2026-09-18.
   [authoring.md](authoring.md) is the guide. A pnpm workspace with
   `plugins/*`, one member scaffolded, `rigline codegen --out` run once at the root, and the
   manifest JSON schema from plugin-api. One ordering dependency, proved when D40 landed: module
   augmentation is per-program, so each plugin's tsconfig must pull the shared root harvest in,
   which a shared base config does.

   The template is real files under `packages/create-plugin/template/`, copied and substituted
   rather than rendered from strings, so it stays readable and reviewable; the scaffold writes a
   placeholder `generated.ts` so a fresh clone typechecks before `codegen` has ever run, which is
   D40's own promise made true at the one moment it is easiest to break. It ships without the
   publish workflow: D50 has the template carry it, and item 6 is where it is proven before it is
   handed to anybody.
5. **Topic docs** — done 2026-09-19. [anchors.md](anchors.md) covers the anchor half of surviving
   an update and [authoring.md](authoring.md) covers publishing a plugin, so what is left is the
   internals a contributor to Rigline itself reads. Six, on [host.md](host.md)'s model — the shape,
   not the argument, with the argument in [decisions.md](decisions.md):
   [architecture.md](architecture.md) (the map: what runs where, the seams, the two pipelines),
   [identifiers.md](identifiers.md) (the layer contract, the five layers, views, codegen, adding
   one), [bus.md](bus.md) (the protocol, the single egress, the tap, the rewrite chain, the derived
   services), [patches.md](patches.md) (the second bundle and why it is a different kind of change),
   [transcript.md](transcript.md) (the three-way join and the sweep), and
   [verification.md](verification.md) (the three tiers and what belongs in each).
6. **Our own release pipeline** (D46) — done 2026-09-19.
   `.github/workflows/release.yml` stages the four publishable packages from
   `main` over OIDC, with provenance and a dist-tag chosen per run, and a summary step naming what
   is waiting and the command that approves it, because nothing notifies a maintainer. Proven on a real release: `1.0.0-alpha.1` went out through it, all four
   attested. [releasing.md](releasing.md) is the runbook.

   `1.0.0-alpha.2` then went out to `latest`, which is how the tag stranded on `alpha.0` by the
   bootstrap publish was corrected — by publishing to it rather than moving it, since `pnpm
   dist-tag` accepts only a typed one-time password and this account's second factor is a security
   key. `next` sits one version behind as a result, which costs nothing and corrects itself at the
   next release.

7. **The template carries the publish workflow** (D50) — the last of phase 4, unblocked now the
   path is proven. An author should get the good path by generating a repository rather than by
   reading a guide. Its workflow is ours with the workspace-specific parts taken out: no lint step,
   since the template ships no linter, and the summary inline rather than a script, since a
   single-plugin repo stages one package and a second file to maintain earns less than it costs.

   One thing to check rather than assume: npm renames `.gitignore` inside a published tarball,
   which is why the template ships it undotted, and whether the same happens to `.github/` decides
   whether the scaffolder needs the same trick a second time.

### Phase 4b: the changelog, and the release pipeline — done 2026-09-20

Delivery outgrew a phase entry. The model, the branching rule, the two workflows and what is still
outstanding live in [ci.md](ci.md); [releasing.md](releasing.md) is the runbook.

### Phase 5: companion VS Code extension — promoted to milestone 8

Outgrew a phase entry. **[m8-companion.md](m8-companion.md)** owns it.

### Phase 6: a plugin contributes its own diagnostics — done 2026-09-21

A check is a thing that is contributed. The kernel and each capability module contribute the host's
lines under `core`; a plugin contributes its own through `ctx.check(name, run)`, which declares
nothing and is handed nothing. Checks are pulled on the panel's cadence rather than pushed, a
throwing one fails its own line without disabling its plugin, and the panel groups by contributor in
an order that does not move as verdicts change. The probe is left rendering the registry and
contributing six of its own, which is the test of whether the shape is right.

So "the badge is red and it names your plugin" replaces "the badge is green and your plugin quietly
does nothing" — P8 applied to the one layer that never had it.

session-id, time-marks and worktree-prefix go through `ctx.check` exactly as a stranger's plugin
does, and the scaffold ships one, so a plugin starts with the habit rather than acquiring it after
the first silent failure.

Read live on 2.1.278, on the editor and the session list: every line green or legitimately `n/a`, no
red flash at boot, and the three plugins that have no work on the session list reported `inactive`
rather than broken. The read found three things a green harness had not (D67, D68), which is the
phase justifying itself on the two days it took to build.

[history-m6.md](history-m6.md) is the archaeology; the reference is spread across
[host.md](host.md), [verification.md](verification.md) and [authoring.md](authoring.md), and the
argument is D63 to D68.

## Milestone 7: distribution

**[m7-distribution.md](m7-distribution.md)** owns it: the split between the `rigline` retrieval
layer and the `@rigline/core` engine, the payload and the four first-party plugins as bundled
assets, the engine's own install path, and the phases with their acceptance criteria.

**Done, both phases, and released as `1.0.0-alpha.6`.** 7a's blocker is gone — `npm i -g rigline &&
rigline install` injects — and 7b separated the wrapper from the engine, recorded as D69, D70, D73
and D74. What the milestone still owes is in "Next session" below: `rigline update` moving off an
older engine has not been run, because it needs two published versions carrying `rigline-engine`.

## Milestone 8: the companion extension

**[m8-companion.md](m8-companion.md)** owns it: the fork it derives from — the companion is a second
retrieval layer, acquiring and running `@rigline/core` the way `rigline` does rather than embedding
it (D80) — the two costs that shape creates, what it watches, what it may and may not reload, how it
is installed, and the three phases with their acceptance criteria.

The problem is the last silent failure in the project. An extension update installs a fresh
directory and deletes the old one, so the injection reverts with nothing said: no badge, no plugins,
no error, weekly. `rigline watch` already fixes it and nobody is running it; the companion is a
process that is.

**8a is next**: acquire, watch, spawn, re-inject, unattended, with no UI beyond a status item and a
failure notification. It opens with the two things D80 makes load-bearing and no Node-side test can
see — finding a Node and its npm from inside the extension host, and a lock so the CLI and the
companion cannot install over each other. It is not published to a marketplace (D76), Anthropic's
terms rather than Microsoft's are the live constraint (D77), and D78 records the premise underneath
all of it.

## Open questions, not blocking

- **Whether a plugin may have the resolved selector**, as `ctx.selector(name)`. `ctx.anchor()` hands
  back a bare class, which serves the two uses D7 names — borrowing a class for your own markup, and
  the host querying for you. It leaves a third: a plugin writing CSS *about* the app's own elements,
  which can only be scoped to the class and so lands on every control wearing the look. Recommended
  but not taken, because it is the first plugin-facing API that hands over something version-derived
  and composable. Until it is settled the authoring guide says: scope a rule to something you
  placed, never to an anchor's bare class.
- **Anchor governance** (D44): who may add to the table, and what evidence an entry needs. Half of
  the promotion path exists already: an override whose anchor this version resolves without it is
  reported as changing nothing, which is the signal that the shipped table has caught up and the
  entry can go. What is missing is the other end — how an entry gets into the shipped table, and on
  whose say-so.
- **Whether `ctx.style` refuses a selector naming a class the plugin did not declare, or only
  lints.**
- **Per-plugin settings** are not needed yet. time-marks persists its toggle in `localStorage` and
  that is the right answer for a value only the panel cares about. A `ctx.settings` API earns its
  place when a value must be editable from outside the panel, and not before.

## Next session

Phases 0 to 4b, phase 6 and milestone 7 are done. `1.0.0-alpha.6` is published to `latest` and
installs from npm on a machine with no checkout.

**7b is closed, all five steps.** `rigline` installs `@rigline/core` into `<RIGLINE_HOME>/engine`,
spawns it, answers `--version` itself and forwards everything else, and declares no Rigline package
at all; this repository and the scaffold both declare the engine and spell the bin `rigline-engine`.
[m7-distribution.md](m7-distribution.md) is the milestone's record until it is condensed.

**`1.0.0-alpha.6` is published to `latest`, and it is the first release carrying the split.** The
published wrapper was then driven from the registry, which is what nothing before it could do:
`npm install rigline`, one binary with no dependencies, `--version` naming the absent engine,
`check` installing `@rigline/core` and forwarding, and `list` and `status` returning the engine's
output and the engine's exit code with nothing of the wrapper's in front of it.

That run also gave D75 its first real reading. Both installed extension versions reported *its
payload was written by engine 1.0.0-alpha.5, and this engine is 1.0.0-alpha.6* — a stale injection
named after a genuine upgrade rather than a synthesised one, which is the case the stamp exists for
and had never been in.

**What remains unrun is the upgrade itself.** `rigline update` moving off an older *engine* still
needs two published versions carrying `rigline-engine`, and `1.0.0-alpha.5` has no `bin` at all, so
`alpha.6` is the oldest that counts. The next release is where that check becomes possible: install
the engine at `alpha.6` by hand into `<RIGLINE_HOME>/engine`, run `rigline update`, and it should
move forward and re-inject. Owed, per this file's own rule about a pipeline step nobody has run.

**The release pipeline has now been driven end to end**, tag through approval, with one step that
is irreducibly a person's: `pnpm release:finish` needs 2FA. [ci.md](ci.md) carries the rest of what
delivery still owes.

**Milestone 8 is what is open**, and [m8-companion.md](m8-companion.md) is the working doc.

**8a is done**, published as `1.0.0-alpha.9` and read live: `npm i -g rigline` then `rigline
vscode-setup` on a Windows laptop installs the engine from npm, installs the companion from the
bundled VSIX, injects, and the extension activates. The live read found three bugs no test had,
which [m8-companion.md](m8-companion.md) records — along with one machine where it did not work,
and why that is parked rather than solved.

**8b is next**: the reload, offered and never taken. Then 8c, the enable, disable and settings
surface. The other open piece is the stability half of [partial-bundles.md](partial-bundles.md),
which needs a decision about making `install` async.

**About this machine.** 2.1.270 and 2.1.278 are both installed and both injected; 2.1.268 and 2.1.269
were deleted by VS Code once nothing was serving them, which is the behaviour D4 exists for, and all
four are in the corpus. 2.1.278's `extension.js` is patched and has not been reloaded — worktree-prefix
is the one plugin that declares a host patch, and a host patch takes effect only after *Developer:
Reload Window*, which ends every Claude session in that window. `pnpm rigline restore` puts a version
back to the extension's own bytes and needs neither VS Code nor the extension to be working.

The harness pins one corpus version, `HARNESS_VERSION` in `src/suite.ts`, and the pin follows the
installed extension: it is 2.1.278, and the reply-table check refuses a `generated.ts` harvested
from anything else. Moving it is maintenance rather than a decision — the corpus keeps every
version, so an old pin costs reproducibility nothing and buys testing a bundle nobody runs. A clone
whose corpus lacks the pinned version skips the suite with a reason, as it always did.
`CORPUS_VERSIONS`, which the layer and anchor ground-truth tests sweep, is a separate list and holds
all four.

**The two numbers have been read, on 2.1.278, across the editor and the session list.** Both are
settled enough to stop asking, and the first one does not say what this section expected it to.

- *Mount re-placement* (D52): `replaced` 0, `moved` 0, `lost` 0, on `commit`, over 328 active mounts
  and 144,548 commits in one measured run. `multiple` and `abandoned` are both empty.

  **That does not retire `replaceLost`, and the rule that said it would was wrong.** Zero here is
  the absence of the *trigger*, not of the need. Nothing detached because nothing moved: the
  conditions that produce a non-zero reading are session-specific — the prototype's vanishing pill
  needed an attachment chip to reorder the footer — and a transcript row that React rebuilds takes
  its anchor with it, so the mount is skipped rather than counted. A mechanism whose reading is zero
  because it was never provoked is not one you delete on the strength of a quiet afternoon. What
  would retire it is a demonstration that the app cannot detach a mount, and no counter can be that.

- *The sweep meter* (D53): peak 6/s on the editor with 326 entries, sustained near 2/s. Not hot, and
  not worth optimising — the clone path costs more (10ms over 83 clones) and the commit rate dwarfs
  both. `querySelectorAll` stays.

  The session-list reading is what mattered, and it was a bug rather than a number: 27/s peak,
  roughly one sweep per React commit, on a surface whose row anchor is measured as editor and
  sidebar. `decorateTranscript` now registers nothing where the anchor renders no rows (D68 applied
  to the second capability that takes one).

**The small items carried into this milestone are closed.** Two built, one declined; what each left
behind as a standing constraint is below.

**The scaffold's release-age gate** (D50 amended). A scaffolded workspace exempts the two Rigline
packages by version, substituted from the same string their ranges are so the two cannot diverge.
The constraint worth keeping: pnpm walks back to the newest version in range that is old enough, so
what decides whether the gate refuses is *whether a range's floor is itself the newest published
version*. A derived range always is. A hand-written one becomes so the moment somebody bumps a floor
to a same-day release — the template's other dependencies satisfy this today by having been written
earlier, which is luck and not a mechanism.

Writing `minimumReleaseAge: 1440` down — the value pnpm 12.3 already defaults to — is what makes the
gate *refuse* rather than record the young picks and proceed; explicitness flips
`minimumReleaseAgeStrict`, at any value. This repository keeps the refusal.

**The harness's reply table.** `REPLY_TABLE` is real TypeScript in `page.ts`, serialised into the
page, and checked against the harvested layers: each reply must be the one `replyCandidates` pairs
to its request, and each key must be a message type the protocol has. It caught the second wrong
entry it was built for — `get_asset_uris` was answered with `get_asset_uris_response`, and the
extension's reply is `asset_uris_response`. The check reads the committed `generated.ts`, so it runs
in CI with no corpus and no browser, and is exact only while that file and the version the suite
pins are the same extension.

**`hostBackupIsCurrent`'s size comparison stays, and the hash that was going to replace it is
declined (2026-09-21).** Not carried any longer; recorded so it is not re-proposed.

Every installed version has its own directory, `anthropic.claude-code-<version>`, and both `.orig`
files live inside it. A new extension version is therefore a new directory with no backup in it at
all, and a superseded one keeps its own matching pair until VS Code deletes the lot. So there is no
general problem of a backup outliving its bundle: for `extension.js.orig` to go stale beside its own
`extension.js`, that file has to be rewritten *within an existing version directory*, by a
same-version rebuild landing at an identical byte size in a directory the installer did not wipe
first. The cost of being wrong is one `rigline restore`, which needs neither VS Code nor the
extension to be working.

Against that, three findings made the fix cost more than the fault. Hashing the *pristine* bundle —
what this entry used to propose — records the backup's own content, which nothing ever mutates, so
it cannot detect anything. Hashing the bytes the injector *wrote* does detect it, and is destructive
while `hostBackupIsCurrent` has one caller answering two questions: `inject.ts` uses it both to
choose which bytes to rebuild from *and* to decide whether to overwrite `extension.js.orig`, so
bytes it does not recognise become the new pristine baseline. A foreign patch preserving the file's
size is harmless today and would be baked into the backup under the hash — the same failure that
rules out recomputing `applyPatches(backup, declared) === live`, and the reason the webview's
`settleWebviewBackup` has a roll-back branch the host side has no analogue of. Closing the hole
honestly therefore means splitting that boolean and adding a third file to the extension directory
for `restore`, `doctor` and `status` to know about, which is a redesign of what the injector does
with unrecognised bytes rather than a swapped comparison.

Two incidental corrections it turned up, both true of the code as it stands. `restore` reverts from
`extension.js.orig` whenever one exists and never consults currency at all, so the size check guards
the harvest and the install's rebuild-from, not the restore this entry used to claim it protected.
And a record kept in `registry.js`, the D75 stamp's precedent, would not survive: `restore` removes
the payload directory, and `codegen` and `diff` read extension directories that have none.

## Status log

One line per day. The reasoning lives in [decisions.md](decisions.md); the diffs live in git.

- 2026-09-13: Archive assembled, anchors validated on 2.1.270, corpus snapshotted, plan and
  decisions written, workspace scaffolded. Phase 0 done.
- 2026-09-13: Phase 1 done. Harvest of 2.1.270: 104 modules, 1009 classes, 108 outbound requests, 9
  notifications, 9 inbound pushes, 22 inbound requests, 105 replies, 151 payload fields; three
  requests have no reply by convention; two stylesheet modules are unreachable. Drift 2.1.268 to
  2.1.270: modules 99.0% kept, classes 98.2%, local names 99.6%, message types 99.3%, React anchors
  100%.
- 2026-09-14: Phase 2 done, then two defects found live. **Superseded payload directories**: install
  and restore only ever wrote and removed the *current* payload directory, so a webview opened
  before a reinstall went on running a whole superseded loader from disk — a second observer, hook
  chain, tap and sweep — which is what locked a window up with two surfaces open. Both commands now
  delete superseded directories by name. **The probe's boot-window false negative**: its first poll
  ran inside its own `setup()`, before the kernel seals the replay buffer, so every
  diagnostics-driven check was being read before its answer could exist. Deferred to a macrotask.
- 2026-09-14: Direction validated against Leo's two questions — third-party install and version
  spread. The third-party mechanism already worked; the version question split four ways and
  produced D40 to D45. His reframe set the priority: design against the gap between an update
  landing and a maintainer catching up, not against a spread of old versions.
- 2026-09-14: Distribution settled as npm with a CI publish pipeline, after a git-repo channel was
  proposed and rejected — the cadence argument for git belongs to the anchor table, which repairs in
  an hour without an author. D46 to D49, D33 amended. Template shape settled as D50.
- 2026-09-14: Phase 3 built and merged, and the three plugins earned their keep by finding two
  faults in the layer they were the first consumers of: an optionally-declared switch, tap or
  rewrite was not granted at all, and a mount was rebuilt rather than re-placed.
- 2026-09-14: Mount service moved off its document-wide observer onto the React commit signal (D52).
  Then the drifting-mount gap it left reproduced the same afternoon and was fixed: a pass now asks
  where a mount *belongs*, not only whether it is still there.
- 2026-09-14: Three first-party decorations turned out to be mounted on the agent-map button rather
  than the model picker, because both carry `modelPill_gGYT1w`. An audit found five of fifteen
  identity anchors already ambiguous on 2.1.270. P2 and D7 amended; the work built the same day —
  `kind` split three ways, application-site counts carried into the diff as `classes.reused`,
  selector resolution, runtime multiplicity. The harvest showed `modelPill` at two sites on 2.1.268,
  so the agent-map button arrived in 2.1.269 and `classes.reused` is what would have said so.
- 2026-09-14: Observability landed (D53): rates and peaks on nine hot paths, a bounded
  `localStorage` ring that survives a force-close, and the probe's copy carrying the whole picture.
- 2026-09-14: The composer footer turned out to measure its own element children and reset that
  measurement through `flushSync` on any foreign mutation, which is the flicker Leo saw whenever a
  file was attached (D54). Fixed at the anchor — `footerSpacer` plus `ctx.mountBefore` — and
  generalised into a damper: a mount or watch corrected on thirty consecutive passes without
  settling is abandoned by name rather than fought at frame rate.
- 2026-09-15: A harness test that failed once and passed alone turned out to be `boot()` returning
  before plugins had loaded. It now waits on `diagnostics.bufferSealed`, which means every plugin
  has had its chance, refusals included.
- 2026-09-15: Phase 4's opening cut back by Leo, and `rigline update` renamed out of existence:
  `install` is the one write command, `check` its read-only half, and `update` belongs to plugins
  (D55).
- 2026-09-18: `rigline list` built, and `describeUses` finally has a caller. Building it surfaced the
  same noise problem one level down — the anchor summary emitted a line per anchor carrying the
  table's prose, ten near-identical sentences about a pop-up's look burying the one line that said
  where it appeared. It groups by what the plugin does with the anchor now: fifteen lines to five.
- 2026-09-18: Trimmed the register and this plan to what is true now, and cut `doctor` back to
  Rigline's own install state (D53 amended), dropping about 1,600 lines of VS Code log parsing and
  the redaction machinery that existed to make reading those logs safe.
- 2026-09-18: The template and the authoring guide landed. Scaffolding one and running it end to
  end — install, typecheck, test, codegen, build, add, load — found two faults nothing else would
  have: the template pinned TypeScript 5 and vitest 3 rather than the versions this repo tests
  against, and with `allowBuilds: {}` that pnpm fails the very first install over an ignored
  esbuild build script.
- 2026-09-18: `add` from npm and `update` landed, with a tar reader of our own (D57) and no version
  ranges (D58). Two things the design got wrong and the work corrected: the release-age gate was
  written as a walk back to the newest version old enough, which would install a patch to an old
  line that no tag points at, and is now a gate that refuses and names the flag; and the reader
  required every tarball member under `package/`, which the first live fetch disproved — `@types/*`
  pack under `node/`, and npm's own rule is to strip one leading directory whatever it is called.
- 2026-09-18: `add` and `remove` landed, and with them the rule that one name is one plugin (D56):
  discovery had been flattening its roots without deduplicating, so two directories of a name baked
  two registry entries and loaded the plugin twice. `add` is what made that reachable, so it refuses
  a name already discovered somewhere it does not own, and discovery keeps the first and reports the
  shadow. `config.json` grew `sources` and is now written back through a read-modify-write that
  keeps keys nothing here knows about.
- 2026-09-18: The local anchor override landed, and phase 4's first item with it (D44 amended).
  Building it turned up two things the design had not said. The manifest's shape check was refusing
  any anchor name outside the shipped table, which stops being an answerable question once the table
  is extensible — it now checks shape only, and a name the installed table has not got is a
  per-plugin refusal rather than a failed install. And the flow's `--codegen` rewrite was rendering
  `generated.ts` from the merged table, so one machine's local repair would have been committed into
  the record every other checkout reads; the write is now the shipped table's answer, byte for byte,
  and a test holds it there.
- 2026-09-19: The six topic docs landed, and phase 4 item 5 with them. Writing them turned up one
  stale fact in three places: D17 put the refusal fixtures under `fixtures/`, and the directory was
  never made — the harness carries them as module source strings instead, which serves the decision
  better, since there is nothing on disk for discovery to find. D17, this plan's package table and
  the README now say so.
- 2026-09-19: Reading the code against the docs found five more things the docs asserted and the
  code did not. `CapabilityContract.violation` is `gaps` and returns a list; `CapabilityModule` takes
  a `Grant` and has `grantOptional`; neither `probes` nor `ProbeCheck` has ever existed, so "checks
  are contributed by the capability modules" was true of the design and of nothing else — phase 6
  now owns making it true, and four documents describe what the code does until it is. D49 still said
  `upgrade`, which D55 had already abolished. And `restore` discarded the host bundle's result, while
  `revert` threw on an I/O error: an `extension.js` that could not be written back was unreportable,
  and a throw would have stranded every directory after it, which is the opposite of what
  `restoreAll` promises. `revert` now catches and `restore` reports `hostReason`; the CLI prints it
  and exits non-zero. The harness's stale-`dist` rule became a guard that refuses the run.
- 2026-09-19: Line endings stopped being everybody's problem (D37 amended). `* text=auto` and
  Biome's `lineEnding: "auto"` replace `eol=lf`, so git normalises on commit and no tool has to be
  taught; `generated.ts` and the committed schema stay pinned, and codegen normalises its own
  output, because both are compared byte for byte against what is on disk. Converting the tree
  found the reason one file never normalised: `sharedFields` joined a composite map key with a NUL
  byte, which made git classify `capabilities/rewrites.ts` as **binary** — every change to it
  rendered as `Binary files differ`, with no reviewable diff, in a repo meant to be
  community-maintained. Two nested maps need no separator.
- 2026-09-19: `pnpm stage publish` completes the OIDC exchange, verified against a stand-in registry
  rather than inferred, so D46 and D50 keep the one command they lean on. Three things the check
  changed. The exchange is per package, so the trusted publisher is too: four entries, not one. The
  staged manifest carries exact versions in place of `workspace:*`. And pnpm emits no registry stage
  id, so the run summary names what was staged instead of an id to quote. Two things the check
  found on the way: there are four publishable packages rather than three, `create-rigline-plugin`
  having arrived after D46 was written, and none of them has a `repository` field, without which npm
  refuses provenance. [releasing.md](releasing.md) is the checklist for the setup that is Leo's.
- 2026-09-19: The repository is `Rigline/Rigline` and the workflow is on it, green end to end on a
  dry run against the real registry in 26 seconds. It surfaced the thing no stand-in could: the
  exchange 404s while the packages do not exist, and pnpm reports that as `[WARN] Skipped OIDC` and
  carries on unauthenticated — so the error a maintainer eventually sees is about authentication and
  names nothing about the publisher that caused it, and a dry run, which never uploads, passes
  either way. releasing.md now says both. Also landed, because a bootstrap publish is the first
  thing anybody sees: a README and LICENSE per published package, and `repository`, `homepage`,
  `bugs` and `keywords` in all four manifests.
- 2026-09-19: All four bootstrapped to npm under `--tag next`, and running the *published*
  `create-rigline-plugin` found what running the one in the tree never could: the template's
  hand-written `^1.0.0` cannot match `1.0.0-alpha.0`, because a caret range admits a prerelease only
  when it names one. Every scaffold it produced failed on `pnpm install`, the first command its
  README gives. The range is now derived from the scaffolder's own version (D50), so it is right on
  an alpha, right at 1.0.0 and never hand-maintained; the placeholder test that would have caught it
  matches any `__UPPER__` rather than the keys it knew about. Fixed in the tree and still broken on
  npm until the first staged release ships it. Also learned, and not ours: npm generates the
  abbreviated packument every installer asks for *after* the publish returns, so a brand-new scoped
  package 404s for `pnpm install` while `curl` and `pnpm view` both see it.
- 2026-09-19: `1.0.0-alpha.1` went out through the pipeline rather than by hand, all four attested
  now the repository is public, and the published scaffold was driven end to end from npm: create,
  install, codegen against the installed 2.1.270, build, typecheck, test. So phase 4 closes, with
  the template carrying the publish workflow D50 always said it would. Two things the release
  taught. A package must have a `latest`, so the bootstrap publish pinned one whatever `--tag`
  said, and it still names `alpha.0` — which is the broken scaffold, and what `npm create
  rigline-plugin` resolves, so moving that tag is the difference between the fix being published
  and being reachable. And a dry run does perform the OIDC exchange after all: it does not gate on
  the result, so the tick means nothing, but the absence of `Skipped OIDC` in its log means every
  trusted publisher works.
- 2026-09-20: `1.0.0-alpha.2` published to `latest`, and `npm create rigline-plugin` verified
  end to end from the registry: scaffold, install, build, typecheck, test, with the release
  workflow in it. Getting there found the second factor is where this path is thin. `pnpm
  dist-tag` takes `--otp` and nothing else, so a security key cannot use it; `pnpm stage approve`
  asked for a code at the last step too. The npm CLI is the way through — `auth-type` defaults to
  `web`, so `npm login` completes against a key, and `npm stage list` / `approve` work on stages
  pnpm created, because a stage belongs to the registry rather than to the client that made it.
  That also retires a claim repeated in four places here: the registry does issue a stage id and
  `npm stage list` shows it; it is pnpm's output that carries none.
- 2026-09-20: CI on push and pull request (D59), over Node 22.12.0, 24 and 26 — and with it an
  `engines` floor in all four published packages, the workspace root and the template, none of
  which had one. 22.12.0 is where vitest starts, so it is the oldest Node this suite can run on;
  the whole suite was run on it before the number was written down, tier 2 and its Chromium
  included, and `pnpm build` with it, so the published CLI is known to work there rather than
  assumed to. `pnpm/action-setup` moved off the `v4` that runs on GitHub's deprecated node20
  runner, to `v6.1.0` rather than `v6`: the floating major still resolves to the last release
  before pnpm v12 support, which is a thing to check on any action before trusting the major to be
  the newest thing under it. The template's workflow carried the same `v4` and moved with it.
- 2026-09-20: The template ships CI as well (D50 amended), which is D59's argument one level out:
  a scaffolded repository ran its tests only when it published, and a contributor's pull request
  was checked by nothing. Same three rungs, so an author's own `engines` floor is one their own CI
  stands on. The scaffold now carries the publishable metadata it can know — the `rigline-plugin`
  keyword and `publishConfig.access` — and deliberately not `repository`, the one field a publish
  needs and a scaffold cannot guess: npm binds provenance to it, so the release workflow refuses a
  publishable package that has none, by name, before it builds anything. That refusal was run
  against a real scaffold in all three of its states rather than reasoned about. None of it
  reaches an author until the next release.
- 2026-09-20: A Windows row on the matrix (D59, amended), at the floor rung rather than a second
  axis: this machine runs the whole suite on Windows at Node 26 many times a day, so what CI adds
  is Windows on an older Node, with exactly one variable between it and the Linux floor job. It
  also turns the `eol=lf` pins on `generated.ts` and the committed schema from a comment that
  asserts something into a thing a run proves, because a CRLF checkout is precisely what that row
  gets. The scaffolder's template stays on one platform: the argument for this row is about this
  machine and does not transfer to an author's.
- 2026-09-20: `.github/dependabot.yml` for the `github-actions` ecosystem (D59), one grouped pull
  request a week, arriving checked because CI runs on `pull_request`. It is the answer to a `v4`
  that was six months behind upstream the day it was written here, and was found by somebody
  reading a warning. Two gaps it does not close, both written down rather than left to be
  discovered: the template's own workflows are not at the repository root and so are not watched,
  and enabling version updates is a repository setting rather than a file.
- 2026-09-20: `CHANGELOG.md`, `pnpm release` and `pnpm release:check` (D60) — entries written
  as the change lands, one command to cut a version across every manifest, and a release that
  refuses a version the changelog does not describe. D61 records why moving `next` cannot be CI's
  job: npm's OIDC exchange authenticates `publish` and `stage publish` and nothing else, and
  `otplease` needs a TTY, so the retag belongs to `release:finish` beside the approval.
- 2026-09-20: Phase 4b closes. A release is `pnpm release <increment>` and `pnpm release:finish`,
  with a pushed tag between them (D60) and both dist-tags derived rather than chosen (D61). The
  derivation is tier 1 in `scripts/lib/tags.test.mjs`, which is where the two silent failures live:
  a maintenance release staged to `latest` is a downgrade for everybody, and a `next` left behind
  strands whoever follows it.
- 2026-09-20: [ci.md](ci.md)'s review lands in full, and what is left there is deferred rather
  than outstanding. The dispatch dry run was broken and passing by luck — a dry run checks a tree
  whose version is already published, which the derivation refuses, and only `next` lagging
  `latest` by one version kept that quiet — so the workflow now tells `release:check` whether the
  run will stage, gets the placeholder `dry-run` back when it will not, and the Stage step refuses
  that tag by name. `release:finish` repeats end to end: approval is decided three ways per
  package from `versions`, and `next` moves one package at a time, each caught and named. A lapsed
  npm session fails before the tag is pushed. CI runs on a `<major>.x` branch and a dispatch may
  come from one. D62's invariant is restated around the preview window that made it false, with
  *one preview line at a time* as the constraint the wider naming now makes it possible to
  violate. [releasing.md](releasing.md) gains what the machine needs, the three runbooks — steady
  state, a preview line and its promotion, two lines at once — and no longer contradicts D61.
- 2026-09-21: `1.0.0-alpha.4` published to `latest`, the first release driven end to end. Five
  things the pipeline asserted turned out false the moment it ran: the cut left `CORE_VERSION`
  behind, approval refused unless HEAD was the tagged commit, `pnpm stage approve` cannot do a
  security key any more than `pnpm dist-tag` can, and the `next` retag cost four authentications a
  release to keep one pointer agreeing with another (D61 amended — `next` is unset until a stable
  line exists). `1.0.0-alpha.3` was burned by a red run and folded back; the cut now runs lint,
  typecheck, build and test before it spends a version. Treat any part of this pipeline that has not
  actually been run as a defect rather than a gap.
- 2026-09-21: Phase 6 closes on a clean live read of both surfaces on 2.1.278. It found a third
  thing first: the session list had been sweeping the transcript once per React commit — 27,000
  times in one run — for rows whose anchor is measured as editor and sidebar, so
  `decorateTranscript` now registers nothing where there are no rows to find. The two numbers the
  plan had been holding are read and settled, and `replaced` at zero does **not** retire
  `replaceLost`: it is the absence of the trigger, not of the need, and the rule that said otherwise
  was wrong.
- 2026-09-21: 2.1.278 landed mid-session, eight versions on from 2.1.270, and every plugin survived
  it untouched: react anchors, messages, replies and payload fields all 100% kept, classes 99.4%
  (six gone, all but one from the same usage-popup module, and the exception carries a successor).
  Snapshotted to the corpus and `generated.ts` regenerated. The first unplanned extension update
  Rigline has seen, and it cost a codegen and a reload.
- 2026-09-20: Phase 6's first live read found two mistakes, which is the phase justifying itself on
  the day it was built (D67, D68). A check with no "not yet" state flashed red at boot; the split is
  by who can answer, so the host's watches check waits and a plugin's says `n/a` until it is handed
  something. session-id claimed all three surfaces for a composer-footer badge, and the host was
  ignoring the `surfaces` its own anchor table has recorded since it was written.
- 2026-09-20: Phase 6 built. A check is contributed rather than written into the probe (D63 to D66):
  nine lines from the kernel, nine from the capability modules, six left in the probe, and
  `ctx.check` for everybody else. Pulled rather than pushed, so a verdict cannot go stale; a
  throwing check fails its own line and leaves its plugin loaded. The three first-party plugins went
  through the plugin-facing API rather than a privileged one, which is what tested it, and each
  turned out to have a failure that was silent — time-marks most completely, since it can be loaded,
  toggled on and decorating nothing while every other line says it is fine. Live read outstanding.
- 2026-09-21: M7 phase 7a built. `@rigline/core` ships `dist/bundled` — the payload and the four
  first-party plugins, copied by a workspace step and resolved by walking up to core's own
  `package.json`, which is the one rule that answers correctly under vitest's alias, in `dist` and in
  `node_modules`. Discovery gained the bundled root and records an override rather than logging a
  collision; `disable` and `enable` switch a bundled plugin off and on; `list` gained a version
  column; `registry.js` carries the engine that wrote it, read by `doctor`, `check` and the probe;
  rolldown became a lazy import and a devDependency, with the scaffold declaring its own. Tier 4
  packs the three tarballs, installs them offline into a clean prefix and runs `install` out of it —
  the thing that had never been done, and the reason this was broken for two releases. 789 tests
  green. Released as `1.0.0-alpha.5`.
- 2026-09-21: **M7 phase 7a done, on the read rather than on the run.** `npm i -g rigline` on a
  machine with no checkout injected 2.1.269 and 2.1.278, applied worktree-prefix's host patch,
  resolved 27 of 27 anchors on each, and baked all four plugins. The `RIG` badge is green on both
  surfaces: four loaded on the editor, three `inactive` and probe loaded on the session list (D68),
  no host errors, and the session-id pill and time marks visible. The payload stamp reads
  `engine 1.0.0-alpha.5` (D75), which is what makes this a reading rather than an impression — the
  badge alone cannot say whether the payload is the one the installed engine would write.
- 2026-09-21: M7 phase 7b steps 1 and 2. The command surface and the `rigline-engine` bin are
  core's; the registry client, the tarball reader, `add`'s remote half and `update` are the
  wrapper's. There is one `add`, in the engine, taking a path — a published plugin reaches it as a
  staging directory the wrapper vetted (D70). `add --source` refuses a kind it cannot read back
  where `readConfig` skips one (D74), and `list --json` is how the wrapper will learn what `update`
  can move without reading `config.json`. Each published package now empties its own `dist` before
  `tsc` refills it, after a module cut a week earlier was found still compiled there. 798 green.
- 2026-09-21: M7 phase 7b step 3: **the wrapper and the engine are separate processes.** `rigline`
  declares no Rigline package, installs `@rigline/core` into `<RIGLINE_HOME>/engine` with npm and
  spawns its bin, answering only `--version` itself (D69, D70, D73, D74). This repository's own
  scripts moved in the same step, onto `@rigline/core` and `rigline-engine`, because `pnpm build`
  runs `rigline build` in four packages and there is no green tree between the halves. Two things
  the work decided that the plan had left open: the release-age gate is `update`'s and not a first
  run's, since a machine with no engine has nothing to stay on; and an `update` that moves only the
  engine now re-injects, which nothing else would have done. Tier 4 became the two prefixes a user
  actually has, installing the engine through `engineInstallArgv`, the wrapper's own npm
  construction, rather than a copy of it. 818 green.
- 2026-09-21: M7 phase 7b step 4, the template, which takes the two changes this repository just
  took and is checked by generating one: scaffold, install against locally packed tarballs,
  codegen, build, typecheck, test, all green, with `rigline-engine build` resolving rolldown from
  the scaffold's own `node_modules` — the thing the split made non-obvious and nothing else asks.
  A guard now holds the acceptance criterion directly: no manifest in the tree or in a generated
  scaffold declares `rigline`, which otherwise fails slowly from inside pnpm with an error about a
  version rather than about the mistake. The run also found that a scaffold cannot install the
  release that produced it for a day; carried above rather than fixed.
- 2026-09-21: M7 phase 7b step 5, the docs, and with it the milestone. Both package READMEs now say
  what their package is — `rigline` a retrieval layer with the engine install spelled out, core the
  engine with its bin and the scripts a plugin workspace runs — and the authoring guide, the two
  scaffolder READMEs, the package tables, the state sections and CONTRIBUTING follow. releasing.md
  gained the one thing the split takes away: `pnpm stage approve`'s dependency-order skip protects
  every package whose dependency did not make it, and the wrapper no longer has one, so the pair is
  checked by eye.
- 2026-09-21: `1.0.0-alpha.6` published to `latest` — the split, the template, the docs, all four
  packages staged over OIDC with no `Skipped OIDC` in the log. Two things the run taught, both
  about the half that is a person's. `pnpm stage approve` with no arguments now exits
  `ERR_PNPM_STAGE_ID_REQUIRED` rather than asking for a second factor, so `release:finish` was
  failing on an argument error wearing the costume of the 2FA wall; it reads the ids from `npm
  stage list --json` and passes them, which gets as far as the wall the message describes. And
  pnpm's staging output *does* carry stage ids now, retiring a claim this file, releasing.md and
  the summary script all made — the summary still prints none, deliberately, because what it says
  works whether or not one exists.
- 2026-09-21: The first `rigline update` on a fresh machine, minutes after `alpha.6` went out,
  refused the engine as too young and installed it anyway — and skipped the re-injection, because
  the decision to re-inject reads the outcome the refusal had already written. The rule was right
  and applied in one of the two places that needed it: the gate is about staying on what you have,
  so `updateEngine` now skips it when nothing is installed, as `ensureEngine` always did. The
  result type says which outcomes carry which versions, so `staying on undefined` is a shape the
  compiler refuses rather than a string somebody has to notice.
- 2026-09-21: The three carried items closed. A scaffolded workspace could not install the release
  that scaffolded it, because pnpm's walk-back needs an older version *in range* and a derived
  caret's floor is the newest one — so the exclusion is by version, narrow enough that widening the
  gate to reject everything still refuses 62 third-party packages and no Rigline one. The harness's
  reply table moved into TypeScript and gained a check that pairs each reply to its request the way
  the harvest does; it failed on the entry it was built for. And `hostBackupIsCurrent` keeps its
  size comparison: every extension version has its own directory carrying its own backup, so the
  fault needs a same-version rebuild at an identical size, while the fix needs the injector's one
  "is this current" answer split in two before it stops baking unrecognised bytes into the backup.
- 2026-09-21: Phase 5's gate answered, and the phase promoted to milestone 8. There is no Marketplace policy against an extension patching another extension: the trust model is publisher-based, and `subframe7536.custom-ui-style` advertises exactly this to a hundred thousand installs. The live constraint is Anthropic's, it lands on the harvest rather than the injection, and the response is [anthropic-compliance.md](anthropic-compliance.md) published from the top of the README with a standing invitation (D76, D77, D78). [plugin-policy.md](plugin-policy.md) followed, splitting what the architecture makes impossible from what is asked of an author and saying outright that nobody is checking, because policing behaviour the boundary permits is whack-a-mole against people who can obfuscate (D79). `rigline add` now says the choice is the user's. [m8-companion.md](m8-companion.md) is the working doc; 8a is next.
- 2026-09-21: **`1.0.0-alpha.8` published**, carrying 8a: the companion extension, `rigline vscode-setup`, the home lock, and `install` refusing an unfinished extension directory. Read end to end from npm on a machine with no Rigline — the engine installs, the verb is reached through the wrapper's empty verb list (D69), the bundled VSIX installs and `--remove` undoes it. `1.0.0-alpha.7` was spent on the way: green on Windows, failed on Linux in the run its own tag triggered, because two test files hardcoded `;` and `C:\`. The fix is in the gate rather than the tests — `pnpm release` now refuses to cut from a commit CI has failed on, and a Linux checkout lives at `~/rigline-linux` in WSL for the fast loop.
- 2026-09-22: **8a done, `1.0.0-alpha.9` published and read live on a laptop with Claude Code.** The live read found three bugs nothing else could: `vscode-setup` had never worked on Windows at all, because Node refuses to spawn `code.cmd` since the BatBadBut fix and every test injects `run`; the built bundle had never been loaded by anything, which `test/activates.test.ts` now does; and a companion installed before Claude Code went green over an `install` that exits 0 having done nothing. All three are one shape — the artefact was never exercised, only its source. One Windows laptop at alpha.8 had the extension installed and inert with no explanation; [m8-companion.md](m8-companion.md) records what was ruled out and the two candidates left.
