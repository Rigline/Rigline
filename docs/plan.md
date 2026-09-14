# Rigline 1.0 plan

The working document: what is being built, in what order, and where it stands. Durable rules live
in [decisions.md](decisions.md); this file is about getting to 1.0.

Started 2026-09-13. Phase 0 in progress.

## What Rigline is

A plugin layer for the Claude Code VS Code extension. A small loader is injected into the installed
extension's webview bundle; plugins are written against a capability-scoped context the loader
provides; and a toolchain harvests the identifiers plugins depend on from whichever extension
version is installed, so an extension update is a diff to read rather than a breakage to chase.

The ambition is a community-maintained system in the spirit of Forge for Minecraft: a
stable-enough API over a host that changes weekly by design, with the fragile parts owned in one
place and the extension points curated.

## Inputs

- **The 0.x archive**, [archive/0.x/](archive/0.x/README.md): design documents, measurements and
  source inventories from the 0.x prototype. It is the evidence behind most of the decisions and
  most of the numbers cited in them. OCR-recovered, so its numbers are indicative and its regexes
  are to be re-derived rather than copied.
- **A bundle corpus** at `c:\dev\kb\vscode-claude-code-versions\<version>\` holding `extension.js`,
  `webview/index.js`, `webview/index.css` and `package.json` for 2.1.268, 2.1.269 and 2.1.270,
  snapshotted 2026-09-13. The extension deletes superseded directories on update, so this is the
  corpus until older VSIXs are fetched from the Marketplace.
- **Live validation on 2.1.270** (2026-09-13) of every anchor the design rests on:

| anchor | result |
| --- | --- |
| `acquireVsCodeApi` in the webview bundle | present once |
| CSP `default-src 'none'`, `script-src 'nonce-`, no `connect-src` | confirmed |
| `__REACT_DEVTOOLS_GLOBAL_HOOK__`, `findFiberByHostInstance`, `memoizedProps` | present |
| `processRequest(` (the inbound-request anchor family) | present |
| `includeWorktrees:!1` in `extension.js` (the worktree-list host patch) | exactly one match |
| `modelPill_gGYT1w`, `modelPillRow_gGYT1w` | present; the hash is `gGYT1w` with a digit one |
| `sessionItem_OOQiHg`, `worktreePill_OOQiHg`, `statusFilterMenuButton_OOQiHg` | present |
| `message_07S1Yg`, `timelineMessage_07S1Yg`, `userMessageContainer_07S1Yg` | present |
| `worktreeBannerName_aqhumA` | present |
| `sendRequest({type:"…"})` outbound request literals | 111 distinct |
| `data-transcript-message` | present since 2.1.268; not an anchor, too new |

Toolchain on this machine: Node 26.8.1, pnpm 12.3.4.

## Physics

Four facts about the host force the shape of everything else, and each was re-confirmed above:

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
| `packages/core` | `@rigline/core` | Node library: locate installed extensions, harvest identifier layers, generate types and runtime tables, inject and restore, discover plugins and bake the registry, run the update flow, watch for updates, hold the curated anchor table. The CLI and a future companion extension both consume it. |
| `packages/cli` | `rigline` | Thin command surface over core: `install`, `update`, `check`, `status`, `restore`, `watch`, `add`, `remove`, `list`, `build`, `dev`. |
| `packages/host` | `@rigline/host` (private) | The injected runtime: `pre.js` (bus tap, buffer, rewrite chain, React devtools hook) and `post.js` (kernel plus capability modules). Built to exactly two files. |
| `packages/plugin-api` | `@rigline/plugin-api` | What a plugin is written against: `PluginContext`, the manifest type and JSON schema, `definePlugin`, the generated identifier unions, and the pure helpers shared by host and core (capability contracts, session rule, stream shape, transcript derivations). |
| `plugins/session-id` | first-party plugin | Session id and inter-agent messaging address beside the model pill. |
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
a declaration check. Initial layers: CSS-module classes (a module-scoped map from the webview
bundle); the protocol in four directions (outbound request, outbound notification, inbound push,
inbound request, each from its own dispatch-site anchor); outbound payload fields (one level under
the request anchors, intersected across send sites, marked partial where a spread hides keys);
host replies (from `extension.js`, derived from the request side by naming convention); and React
internals (asserted, not collected). Codegen, the stability diff and the update gate iterate the
registry; nothing else knows the list.

**Capabilities** (contract in plugin-api, grant in host, check in core). A capability module
carries: its manifest key and schema fragment; its expansion into identifier-layer dependencies;
the permission-summary sentence shown at install; the runtime grant that builds its slice of `ctx`
for one plugin; its diagnostics; and its probe check. The `post.js` kernel loads the registry,
checks declarations, builds each plugin's `ctx` by asking every capability module for its slice,
and isolates failures. Initial capabilities: `classes` (raw `cls`), `anchors` (curated),
`messages` (`onMessage`), `mount` (`mount`, `mountAfter`, `watch`), `style`, `rewrites`
(`rewrite`, `resend`), `tools` (`onToolUse`), `session` (`onSessionId`), `transcript`
(`decorateTranscript`), and `surface`.

**Anchors** (core table; types flow to plugin-api). The curated map from a stable name to a
module-scoped class: `modelPill` is `{ module: "gGYT1w", local: "modelPill" }`. Plugins declare
and use names; the update flow validates the table once per extension version; a retired anchor
is reported against the table and refuses only the plugins that use it. This is Rigline's mappings
file, in the Forge sense. Raw `cls(module, local)` stays available as the escape hatch, so nobody
is blocked on curation.

### The manifest

`rigline.json`, `api: 1`. Sketch, to be fixed in phase 2 when the capability modules exist:

```json
{
  "$schema": "node_modules/@rigline/plugin-api/schema/manifest.json",
  "api": 1,
  "name": "session-id",
  "description": "The panel's session id, beside the model pill.",
  "entry": "dist/index.js",
  "surfaces": ["editor", "sidebar"],
  "uses": {
    "anchors": ["modelPill"],
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

Everything a plugin depends on sits under `uses`, so the permission summary is a walk over one
object. `uses.optional` mirrors it key for key and is checked the same way, but a missing optional
is reported rather than refusing the plugin (D41). `patches` stays top-level because it is not a use
of the webview; it changes the host. Package metadata (`version`, `homepage`, `repository`,
`license`) comes from `package.json`; the manifest carries only what the installer needs without
executing anything.

### Surviving an extension update

The extension updates roughly weekly and users take it almost immediately, so the failure that
matters is not a spread of old versions to support: it is the window between an update landing and a
plugin's maintainer catching up. Four mechanisms shorten that window, ranked by what they buy.

- **The anchor table and its local override** (D7, D44). The only repair that works without the
  plugin's author: one curated pair, fixed once, repairs every plugin that used the name, and
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
codegen` in their own repo and commits theirs. It sits at the root rather than inside
`packages/plugin-api/src/` for three reasons, settled in phase 3: keeping a harvest out of the
published package is then a property of the layout rather than an exclusion rule somebody has to
remember; one file serves every plugin in the repo, which is the shape the phase 4 template needs
(D50); and it makes the default `rigline codegen` output the same rule for us as for an author —
`generated.ts` in the current directory. The file imports nothing, so it is free of any package it
sits beside. It carries three things: the module augmentation D40 describes, `EXTENSION_VERSION`,
and `SCAN`, the harvest reduced to its layer views, which is the baseline the update flow diffs
against (D29). A user's machine keeps its own state under `~/.rigline/`:
`config.json` (enabled plugins, per-plugin settings), `plugins/` (installed third-party plugins),
`anchors.json` (local overrides and additions to the curated anchor table), `baseline.json` (the
last harvest, for "what changed" after an update) and `snapshots/` (class maps per version). A
clone of this repo is for developing Rigline, not for using it.

### Distribution

`@rigline/core` and the `rigline` CLI are published to npm; plugins are npm packages carrying a
`rigline.json` and a built entry, installed with `rigline add <spec>`, or a local directory during
development. The version-specific half (identifier tables, registry, resolved anchors) is derived
on the installing machine from the bundle in front of it, so there is no version matrix to ship.
`@rigline/plugin-api` publishes the anchor names, the manifest type and the context types, and no
harvested identifier unions (D40), so the published API version never doubles as an extension-version
pin. A companion VS Code extension wrapping core for hands-off updates, a reload prompt and a
settings UI is a later phase; core is designed so it can be that consumer. Publishing anything is
Leo's step.

**How a version gets published** (D46). CI stages, a human approves. A GitHub Actions workflow
authenticates to npm over OIDC — no token in the repository — and runs `npm stage publish`, which
needs no 2FA and does not make the version installable. The owner reviews the queue (`npm stage
list`, `npm stage view <id>`, `npm stage download <id>` for the tarball itself) and promotes with
`npm stage approve <id>`, which does prompt for 2FA. These are two separate mechanisms doing two
separate jobs — OIDC decides how CI authenticates, staging decides whether a version goes live — and
the trusted publisher is configured with stage-only permissions so that CI is *permitted* to stage
and refused `npm publish`, rather than merely choosing to behave. Rigline's own three packages
publish through this pipeline, and `create-rigline-plugin` ships the same workflow, so an author
gets it by generating a repository rather than by reading a guide. The one-time steps that cannot be
automated are Leo's: the npm organisation, 2FA on the account that approves, a bootstrap publish of
each package under a temporary token (npm states a brand-new package cannot be staged), then the
trusted-publisher entry naming the repo, workflow file and environment, set to stage-only, and then
revoking that bootstrap token. The revocation is not tidying: there is no setting that requires
staging, so the gate holds only while every credential able to publish the package is stage-limited,
and one surviving full-rights token quietly reopens the direct path. Provenance comes from the OIDC
half and needs the source repo public.

**What `add` does on the way in** (D47, D48, D49). It resolves the version against the registry,
refuses anything younger than the minimum release age unless `--now` is passed, fetches and
integrity-checks the tarball, and extracts it — no package manager runs, no `node_modules` exists
and no lifecycle script is available to run, because a plugin is one bundled ES module and a
manifest. The manifest is then read as data and gated: permission summary, and D26's per-patch
opt-in for any declared host patch. `config.json` records the source by kind, pinned version,
integrity and a fingerprint of the declarations, so `update` re-gates when a new version widens what
the plugin may do and stays quiet when it does not.

### Trust model

Plugins run in the app's realm with full DOM access and can read every message on the bus, which
is the same trust a VS Code extension asks for, and is documented as such. What the system adds:
every dependency is declared and shown as a permission summary at install; a read tap cannot
write; a write is limited to declared fields of messages the app already sends; and a host patch
from a plugin outside this repo requires explicit per-patch opt-in at install.

## Phases

Each phase ends with a commit and a status-log entry. The acceptance lines are the definition of
done.

### Phase 0: record and scaffold (this session)

- Archive and plan and decisions in `docs/`. Done.
- Corpus snapshot outside the repo. Done.
- Workspace scaffold: pnpm workspace, TypeScript 7, Rolldown, Vitest, Biome with semicolons
  required, `.gitattributes` forcing LF, packages that build empty.
- Acceptance: `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint` succeed on the empty
  workspace; first commit on `main`.

### Phase 1: core harvest and codegen (done 2026-09-13)

- The identifier-layer registry and its five initial layers, every regex derived against the
  2.1.270 bundle and pinned by synthetic fixtures plus the corpus (skip when missing). Done.
- Codegen: `generated.ts` (types plus the tables as data) and the runtime rendering the injector
  will write per extension directory. Done; `rigline codegen --check` is byte-stable.
- The extension locator (version-sorted, oldest first), the pristine-bundle rules, the stability
  diff. Done.
- The anchor table, seeded with twenty-six names covering every class the first-party plugins and
  the probe use, every one verified against 2.1.270. Done.
- Drift 2.1.268 to 2.1.270 measured; see the status log. Done.
- Not done, deferred: `rigline corpus fetch <version>` for Marketplace VSIXs; and the compile-time
  proof (a test that drives `tsc` over a fixture plugin to show a wrong module/class pair and an
  unknown message type fail to compile) waits for `PluginContext` in phase 2, since that is the
  type it exercises.
- Acceptance met: `generated.ts` for 2.1.270 committed; every codegen anchor asserted; 174 tests
  green.

### Phase 2: injector, host kernel, probe

- Inject, restore and status: byte-faithful I/O, the backup file as the authority on patched
  state, every installed version patched, host patches rebuilt from `.orig`, tests against
  throwaway copies only.
- `pre.js`: wrapper, taps, sealed buffer, clone-and-freeze, rewrite chain, resend, outbound
  counts, devtools hook. Its Node test drives the built file.
- `post.js` as kernel plus capability modules, including `anchor`, `watch`, `style` and `surface`.
- The probe as a first-party plugin whose checks are contributed by the capability modules.
- The Playwright harness spike, time-boxed: load the 2.1.270 webview bundle in a plain page with a
  faked `acquireVsCodeApi`, the `IS_*` globals and a replayed bus. If it boots, host and plugin DOM
  tests gain a real-DOM tier. Record the outcome either way.
- Acceptance: injected on this machine; Leo reloads webviews and the probe reports every check
  green on the full editor, the sidebar and the session list; `restore` round-trips.
- Status 2026-09-13: everything above is built and merged; the spike succeeded and the harness
  is committed as `packages/harness` with six tests that drive the real 2.1.270 bundle (boot,
  mount ordering, error isolation, refusal by name without import, transcript timing, rewrite).
  `rigline install` has injected 2.1.268, 2.1.269 and 2.1.270 on this machine with the probe
  enabled. Awaiting the live reload and the badge on all three surfaces.
- Defect found and fixed 2026-09-14, **superseded payload directories**. `install` and `restore`
  only ever wrote and removed the *current* payload directory, so the rename left
  `webview/prototype/` sitting beside `webview/rigline/` in all three installed versions. The live
  bundle no longer referenced it — `settleWebviewBackup` had correctly rolled the old patch back —
  but a webview opened *before* the reinstall still held `./prototype/pre.js` and `./prototype/post.js`
  resolved in its module graph, and those files were still on disk, so it went on running the
  whole superseded loader: a second `MutationObserver`, devtools hook chain, `io_message` tap and
  transcript sweep, alongside the new generation in any freshly opened surface. The symptom was
  VS Code locking up with the sidebar and an editor session open together, which is why it
  presented as a two-surface bug and cleared after a remove and fresh install. Both commands now
  delete superseded payload directories by name. The deliberate caution at
  `settleWebviewBackup` — never delete a payload directory on the strength of bytes this installer
  did not write — is unchanged and still right; a directory *we* named is not foreign.
- Defect found and fixed 2026-09-14, **the probe's boot-window false negative**. The badge came up
  `RIG 1` for about a second on a fresh window before turning green. The failing check was
  "replay buffer sealed", and it could not have been anything else: the probe's first
  `pollDiagnostics()` ran synchronously inside its own `setup()`, and `setup()` runs inside the
  kernel's plugin-loading loop, while `bus.sealBuffer()` is deliberately called only once that loop
  has finished. So the probe asked before the answer could exist. The first poll is now deferred to
  a macrotask, which is after the kernel's `finally` because everything between is a microtask
  continuation, and is sound because the probe is pinned last in registry order. That fixes the
  whole class rather than this one check — every diagnostics-driven check was being read inside the
  boot window. The host was correct throughout; only the probe's timing was wrong.
- **Acceptance met 2026-09-14.** `install` round-trips, `status` reads patched with the marker on
  all three installed versions, and the probe reports every check green on the full editor, the
  sidebar and the session list. Phase 2 closed.

### Phase 3: plugins, build preset, update flow, CLI

- `uses.optional` and the `ctx.optional` grants (D41), landed first so the three plugins are its
  first consumers and can say whether the shape is right. The shape settled: `Uses` splits into
  `Declarations` (the nine capability keys) and `Uses extends Declarations` with one extra member,
  `optional: Declarations`, so both verdicts are the same walk over the same contracts. A contract's
  `violation()` becomes `gaps()`, returning *every* identifier the declaration depends on that the
  tables lack rather than only the first; `capabilityViolation` is then the first gap over the
  required half and `optionalGaps` is all of them over the optional half. The runtime half is a
  second method on a capability module, `grantOptional()`, which only `anchors` and `classes`
  implement; the kernel assembles `ctx.optional` from those and still names no capability. One
  addition beyond D41 as written: `ctx.watch` accepts an anchor declared optional and returns a
  no-op teardown when the class is absent, because "the handler never fires" is what absence already
  means everywhere else and the alternative is an optional anchor that cannot be watched.
- The identifier types move to an augmentable interface (D40): plugin-api stops exporting harvested
  unions directly, `rigline codegen` writes an augmentation, and the first-party plugins prove
  both halves — that a local harvest narrows, and that its absence still compiles. plugin-api
  declares `interface RiglineIdentifiers {}` and derives `ModuleId`, `ModuleClasses`, `MessageType`
  and `OutboundFields` from it by conditional lookup with a `string`-shaped fallback; those four are
  the only harvested types anything consumed, so the five protocol-direction unions and the
  `TABLES`/`EXTENSION_VERSION`/`PARTIAL_FIELD_TYPES`/`UNREACHABLE_CSS_MODULES` values leave the
  published surface with them. Proven by spike before being built, in all three arrangements that
  matter: the augmentation narrows from a file outside the plugin's own directory, both when
  `@rigline/plugin-api` resolves through tsconfig `paths` to source and when it resolves through
  real `node_modules` to the emitted `.d.ts` — merging into the interface even though `index.ts`
  only re-exports it — and the same plugin compiles unchanged with the file absent. The mechanism
  the phase 4 template needs is a shared `tsconfig.plugin.json` at the root whose `files` names the
  harvest and whose `include` each plugin overrides with its own `src`.
- `rigline build` (Rolldown preset) and `rigline dev` (rebuild, re-inject, remind to reload).
- The three plugins in TypeScript against the new `ctx`, tests included.
- The install-time declaration check (D43), reported per extension directory by plugin and by the
  identifier that is gone. `capabilityViolation` currently runs only in the webview, despite its own
  doc comment claiming both sides.
- Successor suggestions in the diff (D45).
- The update flow and watcher: report and inject around a plugin problem; block only on the
  harvest floor or Rigline's own build. The baseline rule D29 gives as two sentences is one rule in
  code: `./generated.ts`'s `SCAN` when the directory has one, `~/.rigline/baseline.json` otherwise,
  which is the committed harvest for this repo and for an author's repo alike.
- The CLI complete.
- Acceptance: all three plugins verified live; a simulated update (a copied extension directory
  with an identifier removed) refuses the right plugin by name and injects the rest, and the same
  identifier removed from an *optional* declaration degrades that plugin instead of refusing it.

### Phase 4: the community layer

- `~/.rigline` install model, `rigline add` from npm and from a path. **The permission summary and
  the per-patch host-patch opt-in (D26) land before or with `add`, never after it**: both are in the
  design and wired to nothing today (`permissionSummary` is written, tested and called by no one;
  `applyPatches` takes every enabled plugin's declared patch regardless of origin), and `add` is what
  turns a third-party host patch from a hand-copied directory into a one-liner.
- The fetch path itself (D47, D48, D49). D47's premise is already true rather than aspirational:
  `rigline build` bundles everything the entry imports, `@rigline/plugin-api` included, so a
  published plugin has no runtime dependency to install. The template must keep plugin-api a
  *devDependency* for the same reason, as the first-party plugins do. What is left to build: tarball
  and integrity only, never a package manager; the
  minimum release age with `--now` and a report naming what was withheld and why; the source record
  with its kind discriminator and declaration fingerprint, and `update` re-gating on a fingerprint
  change.
- `~/.rigline/anchors.json`, the local anchor override (D44), reported by name at install.
- Our own release pipeline first (D46): the staged-publish workflow for `@rigline/core`, `rigline`
  and `@rigline/plugin-api`, proven on a real release before it is handed to anyone else. One
  `pnpm stage publish -r` stages all three; each is approved on its own. The workflow emits the
  stage ids into the run summary rather than relying on npm to notify anybody.
- Authoring guide and the `create-rigline-plugin` template (D50). Ordering dependency worth knowing
  now: the template puts one `generated.ts` at the workspace root for every plugin in the repo,
  which rests on D40's augmentation working from a file outside the plugin's own directory. Module
  augmentation is per-program, so each plugin's tsconfig has to pull the shared file in — workable
  through a shared base config, and worth proving once when D40 lands in phase 3 rather than
  discovering it here. The template itself: a pnpm workspace with `plugins/*`,
  one member scaffolded and a documented way to add the next, `rigline codegen --out` run once at
  the root on first use, and the same staged-publish workflow we run ourselves. The manifest JSON
  schema ships with plugin-api.
- Topic docs: architecture, identifier layers, the bus, host patches, the transcript, verification,
  surviving an update, publishing a plugin.
- Publish prep: package metadata, changelog, CI. The one-time npm setup is Leo's (organisation, 2FA,
  the bootstrap publish of each package, the trusted-publisher entries), and every release after
  that is approve-with-2FA.

### Phase 5, later: companion VS Code extension

A thin extension over core: re-inject on update, prompt for the webview reload, expose enable,
disable and settings. Marketplace policy for an extension that patches another extension is a
known risk to weigh when this phase starts.

## Decided 2026-09-13

Confirmed by Leo, with the reasoning in [decisions.md](decisions.md): distribution is core library
plus CLI now and a companion extension later; plugins target UI through curated anchors with raw
class access as the escape hatch; the Playwright harness gets a time-boxed spike in phase 2.

Decided without asking because the direction was clear, and open to challenge: TypeScript plugins
built by a preset over an unchanged output contract; capabilities and identifier layers as
registries; refusal fixtures kept out of the live install; Vitest and Biome; user state under
`~/.rigline`; the 0.x material archived rather than repaired, and 1.x written from first principles.

## Decided 2026-09-14

Confirmed by Leo after a validation pass over the third-party and version-spread questions, with the
reasoning in [decisions.md](decisions.md) as D40 to D45. The reframe that settled the priority is
his: users take an extension update almost immediately, so the cost to design against is the gap
between an update landing and a maintainer catching up, not a spread of old versions to support. Out
of that — no harvested types are published, and an author harvests and commits their own; optional
declarations with a nullable grant, so the compiler forces the check exactly where a dependency may
be absent; per-version plugin builds rejected outright rather than deferred; the declaration check
wired into the Node install; the anchor table named as the repair path and made overridable from
`~/.rigline/anchors.json`; successor suggestions in the diff.

Later the same day, distribution was reopened and closed the other way, as D46 to D49 with D33
amended. A git-repo source with `git pull` updates was proposed, argued for on cadence, and rejected
by Leo in favour of npm with a supply-chain pipeline: CI stages over OIDC, a human approves with
2FA, provenance comes free, and the plugin template ships the workflow so the good path is the
default one. The cadence argument did not survive scrutiny — it belonged to the anchor table, which
is a separate and faster tier — and a committed `dist/` proved a weaker version of exactly
what provenance provides. Leo's own framing: encourage CI and 2FA rather than route around them.
Added on top: `add` runs no package manager at all rather than merely disabling lifecycle scripts,
and the minimum release age is 1440 minutes to match pnpm's default rather than the few hours first
suggested, since the urgent repair path is the anchor override and not a republish. Git stays
available as a later source kind, which is why a source is recorded by kind from the first entry.

And the template that carries all of it (D50) is a pnpm workspace holding many plugins, Leo's call
on the superset argument: it scaffolds correctly for one plugin, a single-plugin template cannot
grow into a workspace without a restructure, and it is nearly free to write because it is the shape
of this repo. pnpm for the template too — not for symmetry, but because `minimumReleaseAge` and
`allowBuilds` defend an author's own machine on the same reasoning D48 applies to that author's
users. P6 is unchanged and worth restating, since a template is the easiest place to lose it: the
contract is the output, and a plugin built with any other toolchain is treated identically.

## Open questions, not blocking

- Per-plugin settings: schema in the manifest, values in `~/.rigline/config.json`, delivered as
  `ctx.settings`. Design in phase 3, ship in phase 4 unless a first-party plugin needs it sooner.
- Anchor governance, load-bearing now rather than tidy (D44): who may add to the table, what
  evidence an entry needs, and how a local `anchors.json` override is promoted into the shipped
  table once it is confirmed.
- Whether `ctx.style` refuses a selector naming a class the plugin did not declare, or only lints.
- Whether `pnpm stage publish` completes the OIDC exchange. D46 and D50 lean on one `pnpm stage
  publish -r` staging the whole workspace, but pnpm's support for trusted publishing is reported
  inconsistently: some accounts say `pnpm publish` delegates to npm and inherits OIDC for free, and
  at least one reports the exchange failing under pnpm and succeeding with npm directly. Verify
  before the workflow is written, not after. The fallback costs little — call `npm stage publish`
  per package and lose the `-r` convenience — but it changes what the template ships, so settle it
  first.
- Whether a provenance attestation survives a staged approval. npm documents provenance for trusted
  publishing and documents staging, but nowhere documents the two together; `npm stage publish`
  accepts `--provenance`, which is suggestive and not proof. Settle it by looking at our own first
  approved release, and keep the claim out of the authoring guide until then.
- How a maintainer learns a stage is waiting. npm documents discovery by `npm stage list` and the
  Staged Packages tab on npmjs.com; no email or push notification is documented, and none was found.
  Our workflow therefore prints the stage id and the approve command into the Actions run summary,
  which is enough for us. If a plugin author's release sits unapproved for a week, revisit — the
  template may need to open an issue or post to the repo instead.

## Next session

Start here. Phase 2 is closed and verified live; phase 3 has not begun.

Read "Surviving an extension update" above and D40 to D45 before starting. D46 to D50 are phase 4
and block nothing here — they touch no interface phase 3 builds against. One thread does reach back:
phase 3 lands D40's augmentation, and the phase 4 template needs it working from a file outside the
plugin's own directory, so prove that while it is in hand.

1. **Phase 3, in this order:** `uses.optional` and the augmentable identifier types first, since both
   change what a plugin compiles against; then the three first-party plugins in TypeScript against
   the new ctx (`session-id`, `worktree-prefix`, `time-marks`; the 0.x inventory of each is in
   [archive/0.x/inventory-plugins.md](archive/0.x/inventory-plugins.md) and holds the rules, the
   CSS that must not narrow the content, and the tests to reproduce); then the install-time check,
   `rigline dev`, the update flow and watcher, and `rigline check`. Each plugin should be added as a
   harness test as well as a live check, since `packages/harness` can now drive the real bundle.
2. **Small items carried over:** a helper or documented pattern for a mount whose `build()` runs
   again on re-placement (the probe had to track its current node by hand); `ctx.watch` on the
   session list has no model pill, so a plugin that wants a badge there mounts on `document.body`;
   `.local/spike/` in the checkout is scratch from the spike and can be deleted; the compile-time
   proof test (a `tsc` run over a fixture plugin showing wrong pairs fail to compile) is still
   deferred; the harness's `page.ts` could generate its reply table from the same anchors codegen
   reads, which was noted and not tried; and this repo's own supply-chain settings deserve a
   deliberate choice rather than a default, since D46 to D48 ask the same of everyone else
   (`minimumReleaseAge` already defaults to 1440 on pnpm 12, but `allowBuilds` and
   `blockExoticSubdeps` do not).
3. **Two camp-site fixes, neither urgent:** `packages/core/src/plugins/discover.ts`
   calls the user config `rigline.config.json` in two doc comments while `riglinePaths().config` is
   `~/.rigline/config.json` — settle it when D49 lands, which widens that same file from
   `{disabled: []}` to a per-plugin source record and would otherwise bake the inconsistency deeper;
   and `packages/plugin-api/package.json` lists `schema` under `files`, which does not exist yet and
   which the probe's `$schema` already points at.

## Status log

- 2026-09-13: Archive assembled and inventoried. Anchors validated on 2.1.270. Corpus snapshotted.
  Three design forks settled with Leo. Plan and decisions written. Workspace scaffolded; phase 0
  done.
- 2026-09-13: Phase 1 done. Five layers, the registry, the diff, the anchor table, codegen and the
  first two `rigline` commands (`codegen`, `diff`). Harvest of 2.1.270: 104 modules, 1009 classes,
  108 outbound requests, 9 notifications, 9 inbound pushes, 22 inbound requests, 105 replies, 151
  payload fields; three requests have no reply by convention (`authenticate_mcp_server`,
  `clear_mcp_server_auth`, `submit_mcp_oauth_callback_url`); two stylesheet modules are unreachable
  (`oblbPg`, `OxFNMA`). Drift 2.1.268 to 2.1.270: modules 99.0% kept (one retired, `ukWSlw`, a
  confirm dialog; seven added), classes 98.2%, local names 99.6%, message types 99.3% (one retired,
  `exec`, with its two fields and its reply; eight added), React anchors 100%. Next: phase 2, the
  injector, the host kernel and the probe.
- 2026-09-14: Renamed Prototype to Rigline. `@prototype` turned out to already be a registered npm
  organization (empty, no packages published, owner unconfirmed) and bare `prototype` collides with an
  unrelated published package; Gizmo and the shortlisted Cadget/Cogsmith/etc. alternatives all had
  real collisions too (a live company at `cadget.net`, an active org at `cogsmith.com`, or a taken
  npm/GitHub name). `rigline` came back clear on npm (scoped and bare), npm org, and GitHub org.
  Nothing was published under the old name, so the rename is a full sweep per the held decision
  above: package names, the CLI binary, the manifest filename (`prototype.json` to `rigline.json`),
  `~/.prototype` to `~/.rigline`, the injected marker comments, the `__prototype` bridge global, and the
  `GRO` probe badge (now `RIG`). `docs/archive/0.x/` is untouched: it is the historical prototype's
  own record and genuinely was called Prototype at the time.
- 2026-09-14: Live verification after the rename. All three versions restored and reinjected from a
  post-rename build, so the marker now reads `RIGLINE-PRE` and `status` annotates all three. Added
  `CONTRIBUTING.md` (build, install, uninstall, blank-panel recovery) with a pointer from the
  README, since the install and uninstall route existed only in `CLAUDE.md`, which humans do not
  read; and made `rigline` a `workspace:*` devDependency of the repo root so the CLI runs as
  `pnpm rigline <command>` instead of by path. Verification also turned up the superseded-payload
  defect recorded under phase 2: worth reading before assuming a lockup is a hot-path cost problem,
  because it presented as one and was not. Recorded rather than waved off — the lockup vanished
  after a reinstall, which is the shape of a bug that comes back.
- 2026-09-14: Direction validated before phase 3, against two questions from Leo — how a third-party
  plugin gets installed alongside the first-party ones, and how a spread of extension versions is
  handled. The third-party mechanism turned out to be already working: `~/.rigline/plugins` is
  a discovery root, and a plugin dropped there is validated, copied per version and baked like any
  other. What is missing is the two gates, not the mechanism — `permissionSummary` is written and
  tested and called by nothing, and D26's per-patch opt-in does not exist at all, so every enabled
  plugin's declared host patch currently applies unreviewed. Both now block `rigline add` in phase 4
  rather than merely sharing a phase with it. The version question separated into four: several
  versions on one machine (solved, D4, verified live on three); a plugin against whichever version
  the user has (right mechanism, no reporting — `capabilityViolation` runs only in the webview
  despite its doc comment claiming both sides); all-or-nothing refusal, which had no answer and now
  has D41; and the published `generated.ts` quietly making the plugin-api version an
  extension-version pin, which now has D40. Leo's reframe set the priority and is recorded above
  under Decided 2026-09-14. Six decisions added, D40 to D45; the plan's phase 3 and phase 4 lists
  and its "Surviving an extension update" section follow from them. No code changed.
- 2026-09-14: Plugin distribution settled properly, after a git-repo channel was proposed and
  rejected. The argument for git was publish cadence; it did not survive, because the cadence
  problem it borrowed from D44 belongs to the anchor table, which is the tier that already repairs
  in an hour without an author. The counter-proposal was Leo's and is now the plan: npm, with the
  supply-chain pipeline that makes npm the safer channel rather than merely the conventional one.
  Verified against current npm documentation rather than assumed — staged publishing is GA, `npm
  stage publish` takes no 2FA and composes with OIDC trusted publishing, `npm stage approve` does
  take 2FA, provenance is automatic on a trusted publish from a public repo, and the floors are npm
  CLI 11.15.0 and Node 22.14. Both the trusted publisher and the stage need the package to exist
  first, so a bootstrap publish under a temporary token is unavoidable and is Leo's. Two additions
  beyond the proposal: `add` runs no package manager at all, since a bundled ES module has nothing
  to install and declining the surface beats defending it; and the minimum release age is pnpm's
  1440-minute default rather than a few hours, affordable precisely because D44 carries the urgent
  case. Four decisions added, D46 to D49, D33 amended to record git as deferred with its reason and
  its re-entry point. No code changed.
- 2026-09-14: Template shape settled as D50, Leo's call: a pnpm workspace holding many plugins,
  because that scaffolds correctly for one while the reverse needs a restructure, and because it is
  the shape of this repo already. Verified the property it rests on — `pnpm -r publish` publishes
  only packages whose version is not yet on the registry, so a multi-plugin repo releases
  incrementally on version bumps with no changeset tooling. pnpm is pushed to authors for its
  supply-chain defaults rather than for consistency. The entry carries an explicit restatement of P6
  because a template is the easiest place to let a toolchain leak into a contract, and names the one
  real cost of the shape: a trusted publisher is per package, so plugin number two needs its own npm
  setup even though it shares the workflow file. No code changed.
