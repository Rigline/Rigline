# Rigline 1.0 plan

The working document: what is being built, in what order, and where it stands. Durable rules live
in [decisions.md](decisions.md); this file is about getting to 1.0. Phases 0 to 3 are done and
phase 4 is next.

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

## Inputs

- **The 0.x archive**, [archive/0.x/](archive/0.x/README.md): the prototype's design documents,
  measurements and source inventories, and the evidence behind most of the numbers the decisions
  cite. OCR-recovered, so re-derive a regex rather than copying it, and re-measure before quoting a
  number as current.
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
| `packages/core` | `@rigline/core` | Node library: locate installed extensions, harvest identifier layers, generate types and runtime tables, inject and restore, discover plugins and bake the registry, run the install flow, watch for updates, hold the curated anchor table. The CLI and a future companion extension both consume it. |
| `packages/cli` | `rigline` | Thin command surface over core: `install`, `check`, `status`, `restore`, `add`, `remove`, `update`, `list`, `watch`, `doctor`, `codegen`, `diff`, `build`, `dev`. |
| `packages/host` | `@rigline/host` (private) | The injected runtime: `pre.js` (bus tap, buffer, rewrite chain, React devtools hook, meters) and `post.js` (kernel plus capability modules). Built to exactly two files. |
| `packages/plugin-api` | `@rigline/plugin-api` | What a plugin is written against: `PluginContext`, the manifest type and JSON schema, `definePlugin`, the anchor names, and the pure helpers shared by host and core (capability contracts, session rule, stream shape, transcript derivations). |
| `packages/create-plugin` | `create-rigline-plugin` | The scaffold: `template/` as real files, copied and substituted. Published, and the only package here whose payload is not code. |
| `packages/harness` | (private) | The Playwright tier: boots the real webview bundle from the corpus with a faked `acquireVsCodeApi` and a replayed bus. |
| `plugins/session-id` | first-party plugin | Session id and inter-agent messaging address in the composer footer. |
| `plugins/worktree-prefix` | first-party plugin | Worktree prefix on the session tab label; declares the worktree-list host patch. |
| `plugins/time-marks` | first-party plugin | Clock times and pause dividers on transcript rows. |
| `plugins/probe` | first-party plugin | The live integration harness: a check per capability and the `RIG` badge in the composer footer. |
| `fixtures/plugins/*` | test fixtures | Plugins that must be refused (unknown class, unknown field, failed required patch). Test-only. |
| `docs/` | | Plan, decisions, topic docs, authoring guide, archive. |

Each first-party plugin: `rigline.json`, `package.json`, `src/index.ts`, `src/*.test.ts`,
`README.md`, built by `rigline build` to `dist/index.js`. The distributed form of any plugin is one
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
per-plugin settings), `plugins/` (installed third-party plugins), `anchors.json` (local overrides
and additions to the curated anchor table), and `baseline.json` (the last harvest). A clone of this
repo is for developing Rigline, not for using it.

### Distribution

`@rigline/core`, `@rigline/plugin-api` and the `rigline` CLI are published to npm; plugins are npm
packages carrying a `rigline.json` and a built entry, installed with `rigline add <spec>`, or a
local directory during development. The version-specific half (identifier tables, registry, resolved
anchors) is derived on the installing machine from the bundle in front of it, so there is no version
matrix to ship, and no published type union doubles as an extension-version pin (D40).

`add` resolves the version, refuses anything younger than the minimum release age unless `--now` is
passed, fetches and integrity-checks the tarball, and extracts it — no package manager runs, because
a plugin is one bundled ES module and a manifest (D47, D48). `config.json` records the source by
kind, pinned version and integrity, which is what lets `update` fetch a newer one later (D49).

Our own packages publish from CI: OIDC to npm so no credential sits in the repo, `npm stage publish`
into a queue, a human approving with 2FA (D46). That is release hygiene for our packages and the
template's default, not a claim about any plugin. Publishing anything is Leo's step.

## Phases

Each phase ends with a commit and a status-log entry.

### Phase 0: record and scaffold — done 2026-09-13

Archive, plan and decisions in `docs/`; corpus snapshot outside the repo; pnpm workspace with
TypeScript 7, Rolldown, Vitest, Biome and LF enforced.

### Phase 1: core harvest and codegen — done 2026-09-13

The identifier-layer registry and its five layers, every regex derived against the 2.1.270 bundle
and pinned by synthetic fixtures plus the corpus. Codegen (`generated.ts` plus the runtime tables
written per extension directory), byte-stable under `--check`. The extension locator, the
pristine-bundle rules, the stability diff, and the anchor table.

Deferred out of the phase and still open: `rigline corpus fetch <version>` for Marketplace VSIXs.

### Phase 2: injector, host kernel, probe — done 2026-09-14

Inject, restore and status with byte-faithful I/O and the backup file as the authority. `pre.js`
and `post.js` as kernel plus capability modules. The probe as a first-party plugin whose checks are
contributed by the capability modules. The Playwright spike succeeded and is now `packages/harness`.

### Phase 3: plugins, build preset, install flow, CLI — done 2026-09-14

`uses.optional` and the `ctx.optional` grants (D41). The augmentable identifier interface (D40),
pinned by a test that drives `tsc`. `rigline build` and `rigline dev`. The three plugins in
TypeScript. The install-time declaration check (D43), successor suggestions (D45), the install flow
and its watcher, and the CLI.

Three bodies of work landed after the phase closed and belong to it: anchor ambiguity (D7 amended —
`kind` split three ways, application-site counts, selector resolution, runtime multiplicity), the
composer-footer damper (D54), and observability (D53).

### Phase 4: the community layer — next

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
5. **Topic docs**: architecture, identifier layers, the bus, host patches, the transcript,
   verification. [anchors.md](anchors.md) covers the anchor half of surviving an update and
   [authoring.md](authoring.md) covers publishing a plugin, so what is left is the internals a
   contributor to Rigline itself reads.
6. **Our own release pipeline** (D46), which is a separate track and gates none of the above. The
   staged-publish workflow for the three packages, proven on a real release before the template
   hands it to anyone else. One `pnpm stage publish -r` stages all three; each is approved on its
   own. The workflow prints the stage ids and the approve command into the Actions run summary,
   because nothing notifies a maintainer that a stage is waiting. The one-time npm setup is Leo's.

### Phase 5, later: companion VS Code extension

A thin extension over core: re-inject on update, prompt for the webview reload, expose enable,
disable and settings. Marketplace policy for an extension that patches another extension is a
known risk to weigh when this phase starts.

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
- **Whether `pnpm stage publish` completes the OIDC exchange.** D46 and D50 lean on one `pnpm stage
  publish -r` for the whole workspace, and pnpm's support for trusted publishing is reported
  inconsistently. Verify before the workflow is written. The fallback costs little — `npm stage
  publish` per package, losing `-r` — but it changes what the template ships.
- **Per-plugin settings** are not needed yet. time-marks persists its toggle in `localStorage` and
  that is the right answer for a value only the panel cares about. A `ctx.settings` API earns its
  place when a value must be editable from outside the panel, and not before.

## Next session

Phase 4 item 5, the topic docs, then item 6, the release pipeline. Item 6 needs Leo: the one-time
npm setup is his, and `pnpm stage publish` and OIDC is an open question to verify before the
workflow is written. The template ships without the publish workflow until that is proven.

**About this machine.** Only 2.1.270 is installed — VS Code deleted 2.1.268 and 2.1.269 once nothing
was serving them, which is the behaviour D4 exists for; both are still in the corpus. Its
`extension.js` is patched, worktree-prefix being the one plugin that declares a host patch, and a
host patch takes effect only after *Developer: Reload Window*, which ends every Claude session in
that window. `pnpm rigline restore` puts it back to the extension's own bytes and needs neither VS
Code nor the extension to be working.

**Two numbers to read off the live probe** before deciding anything about them. Its copied report
carries both.

- *Mount re-placement* (D52): `replaced`, `lost` and the driver. Zero `replaced` retires
  `replaceLost` and the peer scan it needs. Any `lost` at all is a node nobody can see being retried
  every frame, and is a bug to chase.
- *The sweep meter* (D53): `querySelectorAll` allocates a static collection per call where
  `getElementsByClassName` returned a live cached one, and the transcript sweep runs over several
  hundred rows per commit. Read the peak before optimising anything, and do not hand-wave it either.

While there, `mounts.multiple` should be empty (a name in it is a singleton whose refinement has
stopped refining), and so should `mounts.abandoned` (a name in it means the host and the app fought
over a position and the host conceded, so a decoration is gone and the panel flickered before it
went). `rebind`'s peak is the early warning for the same thing.

**Small items still carried.** `ctx.watch` on the session list has no composer footer, so a plugin
wanting a badge there mounts on `document.body` — a sentence in the authoring guide, not an API
change. The harness's `page.ts` could generate its reply table from the same anchors codegen reads;
a wrong reply type sat in that table until a plugin needed the message.

## Status log

One line per day. The reasoning lives in [decisions.md](decisions.md); the diffs live in git.

- 2026-09-13: Archive assembled, anchors validated on 2.1.270, corpus snapshotted, plan and
  decisions written, workspace scaffolded. Phase 0 done.
- 2026-09-13: Phase 1 done. Harvest of 2.1.270: 104 modules, 1009 classes, 108 outbound requests, 9
  notifications, 9 inbound pushes, 22 inbound requests, 105 replies, 151 payload fields; three
  requests have no reply by convention; two stylesheet modules are unreachable. Drift 2.1.268 to
  2.1.270: modules 99.0% kept, classes 98.2%, local names 99.6%, message types 99.3%, React anchors
  100%.
- 2026-09-14: Renamed Prototype to Rigline — `@prototype` was a registered npm org and bare `prototype`
  collides with a published package. Nothing had been published under the old name, so the sweep was
  total except `docs/archive/0.x/`, which is the prototype's own record.
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
