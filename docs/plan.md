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
    "style": true
  },
  "patches": []
}
```

Everything a plugin depends on sits under `uses`, so the permission summary is a walk over one
object. `patches` stays top-level because it is not a use of the webview; it changes the host.
Package metadata (`version`, `homepage`, `repository`, `license`) comes from `package.json`; the
manifest carries only what the installer needs without executing anything.

### Where state lives

The repo commits `packages/plugin-api/src/generated.ts` as the baseline the first-party code
compiles against. A user's machine keeps its own state under `~/.rigline/`: `config.json` (enabled
plugins, per-plugin settings), `plugins/` (installed third-party plugins), `baseline.json` (the
last harvest, for "what changed" after an update) and `snapshots/` (class maps per version). A
clone of this repo is for developing Rigline, not for using it.

### Distribution

`@rigline/core` and the `rigline` CLI are published to npm; plugins are npm packages carrying a
`rigline.json` and a built entry, installed with `rigline add <spec>`, or a local directory during
development. The version-specific half (identifier tables, registry, resolved anchors) is derived
on the installing machine from the bundle in front of it, so there is no version matrix to ship. A
companion VS Code extension wrapping core for hands-off updates, a reload prompt and a settings UI
is a later phase; core is designed so it can be that consumer. Publishing anything is Leo's step.

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

- `rigline build` (Rolldown preset) and `rigline dev` (rebuild, re-inject, remind to reload).
- The three plugins in TypeScript against the new `ctx`, tests included.
- The update flow and watcher: report and inject around a plugin problem; block only on the
  harvest floor or Rigline's own build.
- The CLI complete.
- Acceptance: all three plugins verified live; a simulated update (a copied extension directory
  with an identifier removed) refuses the right plugin by name and injects the rest.

### Phase 4: the community layer

- `~/.rigline` install model, `rigline add` from npm and from a path, permission summary, host-patch
  opt-in.
- Authoring guide, a `create-rigline-plugin` template, the manifest JSON schema shipped with
  plugin-api.
- Topic docs: architecture, identifier layers, the bus, host patches, the transcript, verification.
- Publish prep: package metadata, changelog, CI. Leo publishes.

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

## Open questions, not blocking

- Per-plugin settings: schema in the manifest, values in `~/.rigline/config.json`, delivered as
  `ctx.settings`. Design in phase 3, ship in phase 4 unless a first-party plugin needs it sooner.
- Anchor governance: who may add to the table, and what evidence an entry needs.
- Whether `ctx.style` refuses a selector naming a class the plugin did not declare, or only lints.

## Next session

Start here. Phase 2 is closed and verified live; phase 3 has not begun.

1. **Phase 3, in this order:** the three first-party plugins in TypeScript against the new ctx
   (`session-id`, `worktree-prefix`, `time-marks`; the 0.x inventory of each is in
   [archive/0.x/inventory-plugins.md](archive/0.x/inventory-plugins.md) and holds the rules, the
   CSS that must not narrow the content, and the tests to reproduce), then `rigline dev`, then the
   update flow and watcher, then `rigline check`. Each plugin should be added as a harness test as
   well as a live check, since `packages/harness` can now drive the real bundle.
2. **Small items carried over:** a helper or documented pattern for a mount whose `build()` runs
   again on re-placement (the probe had to track its current node by hand); `ctx.watch` on the
   session list has no model pill, so a plugin that wants a badge there mounts on `document.body`;
   `.local/spike/` in the checkout is scratch from the spike and can be deleted; the compile-time
   proof test (a `tsc` run over a fixture plugin showing wrong pairs fail to compile) is still
   deferred; the harness's `page.ts` could generate its reply table from the same anchors codegen
   reads, which was noted and not tried.

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
