# M7: distribution — Rigline reaches a user

The working document for the milestone that makes an installed Rigline work. Durable rules live in
[decisions.md](decisions.md); delivery is [ci.md](ci.md) and [releasing.md](releasing.md). This file
owns the shape, the phases and their acceptance criteria, and it supersedes "Blocking: the
first-party plugins do not reach a user" in [plan.md](plan.md).

## The problem

`npm install -g rigline && rigline install` does not inject. It throws `payload is missing pre.js`.

`defaultPayloadDir()` resolves `../../host/dist` relative to the CLI's own `dist/`
([cli/src/index.ts:122-125](../packages/cli/src/index.ts#L122-L125)). In this checkout that is
`packages/host/dist`. Installed from npm it is `node_modules/host/dist`, which does not exist,
because `@rigline/host` is `private` and never published. `npm pack --dry-run` on `packages/cli`
prints five files and 26.8 kB — `LICENSE`, `README.md`, `dist/build.js`, `dist/index.js`,
`package.json` — and no payload. `repoPluginsDir()` is wrong the same way, and `list` prints a root
labelled "this checkout" that is not one.

No published package carries the thing that gets injected, and none carries a plugin. The root cause
is not a missing copy step: **nothing has ever exercised the published artefact.** Every test drives
the workspace, where those relative paths happen to resolve. 7a answers that with a test, and that
is the part which stops it recurring.

## The split

Two packages a person installs, and one sentence decides which owns what.

**The engine cannot update the engine.** A process cannot replace the package it is running out of —
that is the whole of the npm self-update failure record — so whatever performs an update must sit
above the thing being updated. `update` therefore cannot live in `@rigline/core`, and the package
that holds it is the one that installs the engine (D69).

### `rigline` — retrieval

It retrieves bytes and hands them over. That is the whole of it.

Owns `update`, and the **remote half of `add`**: resolving a spec, fetching, checking integrity,
vetting the archive, applying the release-age gate, and unpacking into a staging directory. It then
hands the engine a local path and a source record, and the engine does everything else.

**It writes no user state** beyond the engine directory and its own staging directory. It does not
place plugins, does not read `config.json`, and does not read a plugin manifest at all.

**It declares no dependency on any Rigline package and none on rolldown.** It appears in no
project's dependencies — not this repository's root, not a plugin author's workspace, not the
scaffold. A project that can declare dependencies does not need a delivery mechanism; it declares
the engine. Taking `rigline` as a devDependency is the same error as the payload one above, one
layer down: treating the shell as the substance.

Every verb it does not own is **forwarded verbatim** to the engine, so core can add a command
without a wrapper release. That is deliberate, not incidental: it is what keeps the wrapper still.

### `@rigline/core` — the engine

Everything else. Harvest, codegen, injection, patching, host patches, plugin discovery and baking,
the anchor table, the capability registry, the report formatters, and every command that reads or
drives any of it: `install`, `check`, `watch`, `status`, `restore`, `add`, `remove`, `list`,
`disable`, `enable`, `doctor`, `codegen`, `diff`, `build`, `dev`. **All of `config.json` is the
engine's**, sources included — one writer, and the wrapper is not it.

It owns a bin, `rigline-engine`, and it carries `dist/bundled/`:

    dist/bundled/pre.js
    dist/bundled/post.js
    dist/bundled/plugins/{session-id,time-marks,worktree-prefix,probe}/rigline.json
    dist/bundled/plugins/{session-id,time-marks,worktree-prefix,probe}/dist/index.js

Core rather than the wrapper, because core is what injects and discovers, and the phase 5 companion
extension consumes core and will need the same assets (D31).

**A bundled plugin keeps its manifest's own `entry` path**, `dist/index.js`, rather than being
flattened to `index.js` beside the manifest. Flattening would mean rewriting `entry` during the
copy, so the manifest a user's engine validates would not be the bytes any test ran against — and
the copy stops being a copy. `dist` inside `dist` reads oddly and costs nothing; a transform in the
one step that exists to move bytes faithfully costs the property the step is for.

### The line between them

**The wrapper vets the container; the engine vets the content** (D70).

Integrity hash, the tar reader's refusals (D57 — regular files only, no absolute path, no `..`, no
symlink or device, entry size and count caps, one stripped root), and the release-age gate are the
wrapper's: it must not hand over bytes it has not vetted *as bytes*. Manifest shape, the entry file
existing, capability declarations, anchor existence, the installed directory's name, `describeUses`
and the name-collision check are all the engine's, which already reports a plugin it refuses by name
without blocking the install (D43, D27).

A wrapper that validated would hold an opinion about what a valid plugin is, and pinned to a
different `@rigline/plugin-api` than the engine it could refuse a plugin the engine would have run —
an updater vetoing working software, with no way to argue.

**So there is exactly one `add` implementation, in the engine, and it takes a path.** The wrapper's
remote handling is a prefix that turns a spec into a path:

    rigline add ./plugins/clock          -> forwarded straight to the engine
    rigline add npm:clock@1.2.0          -> wrapper resolves, fetches, vets, stages; engine adds
    rigline update                       -> wrapper resolves and stages each; engine adds each

This is what keeps the wrapper out of the plugin's business, and it is also why an author's loop
still works: `add <path>` is an engine command, reachable from a workspace that depends only on
`@rigline/core`. The engine's `add` signature gains an optional source record, supplied by the
wrapper, which it writes into `config.json` (D74).

An engine handed a source `kind` it does not recognise **refuses that one `add`, naming the kind**,
and `readConfig` **skips** an unrecognised kind with a line rather than throwing
([discover.ts:203-206](../packages/core/src/plugins/discover.ts#L203-L206) throws today). The
wrapper is routinely newer than the engine — that is the point of an acquisition layer — so the
first wrapper to write a new kind must not break `list` on every older engine.

## Plugins

### A spec names a source; the name is the identity

`add` accepts a path, `npm:<name>[@<version|tag>]`, and — when the deferred git work lands — a URL
with an optional `#ref`. **A bare name still means npm**, as it does today, so nothing breaks and no
CLI surface is removed; the `npm:` form is the explicit spelling the other schemes need to sit
beside.

The manifest's `name` remains the runtime identity and the installed directory's name. It is what
the baked registry entries key on, what diagnostics group by (D66), what `ctx.check` reports under,
what `disabled` lists, what `last: ["probe"]` orders, and what a refusal names. Two plugins called
`session-id` both claim the composer footer and both claim that identity in the panel, whichever
URLs they came from, so keying storage by source would move the conflict from install time, where it
is refusable with a clear message, to load time, where they fight.

Because the engine owns placing, it keeps D56's collision check and can see every root — which the
wrapper never could. **It refuses a name already discovered in a root it does not own** (the
checkout's `plugins/`), replaces a name already in `~/.rigline/plugins`, and **allows a name that
only the bundled set holds**, because overriding a bundled plugin is the point (see Discovery
roots). It also refuses when the same name is already recorded against a *different* source, naming
both, with a flag to replace.

`addPlugin` and `removePlugin` already take the roots they do not own as `otherRoots`, and the
bundled root goes in that list for both with one extra field naming it: `add` skips it, because
taking a bundled name is allowed, and `remove` reads it, because a bundled plugin is exactly the
case whose refusal has somewhere better to send you. Two lists would put the carve-out in the
caller, where the next root added is one somebody has to remember to file twice.

### The bundled plugins

session-id, time-marks, worktree-prefix and probe ship inside core and are discovered **in place** —
never copied into `~/.rigline/plugins` (D71). Copying would make them look user-owned, break
`remove`, and mean an engine update did not refresh them. In place means a re-inject *is* their
update.

Their version is the engine's. `rigline.json` carries no version and the bundled tree ships only the
manifest and the entry, so `list` reports `CORE_VERSION` for a bundled plugin rather than reading
one.

**probe's home is settled; the other three are bundled for now** (D72). Probe is not only a badge:
it registers two composing `rename_tab` rewriters that cancel each other, so it is a live self-test
in the user's editor, and it is the test of whether the contributed-check shape is right (D63 to
D68). Moving it into `post.js` would let the plugin-facing API rot unwatched. The other three are
bundled because a default install must work, and may move out when there is a reason.

Any bundled plugin may be switched off, and `doctor` says so rather than leaving a missing badge to
be interpreted. `remove` on a bundled plugin refuses and names `disable`, as it does today for a
plugin it did not install.

### Discovery roots

In order, which is both precedence and load order (D56):

1. the checkout's `plugins/`, when the engine is running from this workspace
2. `~/.rigline/plugins`
3. core's `dist/bundled/plugins`

**The user's directory outranks the bundled set**, so a fork installed over a bundled name wins and
the bundled one is shadowed. That is the escape hatch that lets a broken bundled plugin be replaced
without waiting for a release, in the spirit of `~/.rigline/anchors.json` (D44).

Root 1 exists only in this workspace, and **what computes it is settled in 7a, not deferred**: walk
up from the engine's own module URL to the nearest `package.json`, and take `<that dir>/../../plugins`
only when the workspace root above it is this one (`name === "rigline-workspace"`). Today's
`repoPluginsDir()` is fixed path arithmetic that resolves to `<npm-global-prefix>/plugins` from a
published install — a non-existent directory that happens to be skipped, which is the same accident
this milestone exists to end.

In this workspace all four first-party plugins are therefore found twice, root 1 shadowing root 3.
**That is expected and must be quiet**: `discoverPlugins` logs a shadowing line per collision
([discover.ts:166](../packages/core/src/plugins/discover.ts#L166)) and `formatFlow` prints it under
every installed version, so without a carve-out every `pnpm rigline install` grows eight lines of
noise. A bundled plugin shadowed by a same-named non-bundled one is reported once, not per version,
and never as a problem.

**So overriding a bundled plugin is a fact about the winner, not an event in a log.** Discovery is
told which root is the bundled one and records `overridesBundled` on the plugin that won; it emits
no line at all. The two places a person is actually asking then carry it: `list`, which is where
somebody looks to find out what is loaded and from where, and `add`, at the moment they take a
bundled name. That is the "once" — it costs a boolean on a structure discovery already builds,
rather than a second discovery pass to collect lines nobody asked for. The alternative, a line in
the install report, is per-version by construction: `install` discovers once per extension
directory, so there is no "once" available to it.

Because a bundled plugin can only be declined by switching it off, this milestone adds `rigline
disable NAME` and `rigline enable NAME` — engine commands, since they change what gets baked, and
both re-inject, because the registry is baked at install time (D14) and nothing changes until the
payload is rewritten.

## The engine on disk

    npm install --prefix <RIGLINE_HOME>/engine --save-exact --ignore-scripts @rigline/core@<version>

**This is the only engine.** The wrapper carries no bundled copy, so there is no precedence rule, no
semver ordering and no way for the engine you ran to differ from the one you installed. The wrapper
does compare the installed version against the resolved one for equality — that is what "install
only when it moved" means, and it is not the ordering D58 refuses.

**Do not reach for a launcher, a versions directory, background update checks, release channels or
staged upgrades.** Claude Code itself does all of those, on this machine, and it is the nearest
neighbour a reader will find — but that machinery exists because a session is open for hours and an
update lands underneath it. `rigline` exits in seconds, having been asked to run. One engine
directory, replaced in place by npm, is the whole of it.

npm does the full dependency resolution as always, into a directory the user unconditionally owns.
Never a global install of core (D73). What that buys: no `EACCES`, because it is the user's own home;
no bin collision, because core's bin lands in that prefix rather than the global one; no PATH
dependency and no package-manager detection, because the wrapper knows where it put it; and rollback
is the same command with the previous version.

Mechanics that are not optional:

- **The prefix rule is duplicated, deliberately.** The wrapper cannot import `riglineHome()`
  ([core/src/paths.ts:14-17](../packages/core/src/paths.ts#L14-L17)) because it depends on nothing,
  so it reimplements the two-line rule — `$RIGLINE_HOME`, else `join(homedir(), ".rigline")` — and a
  test asserts the two agree. That duplication is the price of the split and it is cheaper than the
  dependency. The test reaches across by relative path into core's source, and the wrapper's
  typecheck config drops its `@rigline/core` mapping in the same step: a devDependency would put
  core in the wrapper's `node_modules`, where a stray import from `src/` typechecks, builds, and
  fails only when somebody installs the tarball.
- **The npm argv is a function, so a test can run it.** The wrapper exports what it would hand
  `process.execPath` rather than only running it, which is what lets tier 4 install a packed core
  tarball into a temporary engine prefix through the same construction the real thing uses, and then
  drive the packed `rigline` against it. The registry resolve is the one inch left, and tier 1 fakes
  it.
- **Create the directory first.** Run against an empty directory, npm creates `node_modules`,
  `package-lock.json` and a `package.json`, resolves the full dependency graph as usual, and
  downgrades cleanly when handed an older version — all confirmed by running it, on npm as shipped
  with Node 26 on Windows. `--save-exact` is required and confirmed to work: without it npm writes a
  caret range into that manifest, which is a second mechanism deciding what is installed and
  disagrees with the pin the moment anyone runs a bare `npm install` there — what D58 refuses for a
  plugin source — and a caret on a prerelease is narrower than it looks (D50).
- **`--ignore-scripts`.** Core's only dependency is `@rigline/plugin-api` and neither has an install
  script, and the workspace's own `allowBuilds: {}` says that is the posture. Nothing is lost and the
  surface is declined rather than defended (D47).
- **Finding npm.** Try `<dirname(process.execPath)>/node_modules/npm/bin/npm-cli.js` (the Windows
  layout), then `<dirname(process.execPath)>/../lib/node_modules/npm/bin/npm-cli.js` (POSIX). If
  neither exists, refuse by name and print the command for the user to run. Do not fall back to
  PATH: under corepack, volta or fnm the shim on PATH is not necessarily the npm beside this Node.
- **Spawn `process.execPath`**, never a `.cmd` shim, and always with an argv array and no shell —
  `child_process.spawn` of `npm.cmd` without `shell: true` throws `EINVAL` on Windows since the 2024
  CVE fix, `node_modules/.bin` holds three shims per bin of which the extensionless one is a POSIX
  script, and an argv array is what makes a prefix containing spaces safe.
- **Finding the engine entry.** Read `bin["rigline-engine"]` from
  `<prefix>/node_modules/@rigline/core/package.json` and run it under `process.execPath`. Never
  hard-code `dist/index.js`.
- **Majors move together.** The wrapper installs within its own major. If the resolved tag is outside
  it, the wrapper installs nothing and says `rigline 1.x cannot run engine 2.x — run npm i -g
  rigline@latest`. On a fresh machine that is one command, and it is the only case where a first run
  cannot complete.
- The costs, stated: `npm` must be beside the running Node; the first run needs the registry, seconds
  after the user ran `npm i -g rigline`; and a user cannot override the engine with `npm i -g
  @rigline/core`, which is the price of never colliding.
- **Recovery**: `rm -rf <RIGLINE_HOME>/engine` and run any command. The wrapper reinstalls.

## `update`, end to end

    rigline update
      -> resolve @rigline/core's tag; install into <RIGLINE_HOME>/engine if the version differs
      -> resolve each recorded plugin source; fetch, vet and stage the ones that moved
      -> spawn the engine: add each staged plugin, then install if the engine moved
      -> "Developer: Reload Webviews"

One command brings the engine, the four bundled plugins, every third-party plugin and every
installed extension version current.

Rules it follows:

- **Resolve before shelling out.** `npm install` takes seconds and prints its own noise even when
  nothing moves. Resolve with the registry client and run npm only when the version differs.
- **The engine first**, so the new engine does the placing and the injection. An engine that fails to
  start leaves the previous injection untouched, which is the right way round, and `update` prints
  the version it moved from so the rollback command is to hand.
- **A failed engine resolution is reported and the run carries on** with the installed engine.
  `resolveVersion` throws on any registry failure while `updatePlugins` is built never to stop at the
  first one; an unqualified resolve would make a registry outage fatal to the plugin half and the
  re-injection too.
- **The final `install` is the engine's half of re-injecting.** `add` re-injects, so a run that
  moved plugins has already rewritten the payload; a run that moved only the engine has not, and the
  payload on disk is then the previous engine's — the exact staleness D75 exists to make visible.
  So an engine that moved is followed by one `install` after the adds.
- **The age gate applies to the engine** as to a plugin: 1440 minutes, `--now` to override, a
  withheld version reported by name with its age (D48). What made the delay affordable there holds
  here — the urgent repair is `~/.rigline/anchors.json`, which needs no publish (D44).

  **It applies here and not to the first run.** D48's shape is refuse-and-name-the-flag, which needs
  something to stay on; a machine with no engine has nothing, so gating the bootstrap would make
  `rigline install` fail outright for a day after every release, on a verb with no `--now` to offer.
  The first run takes what the tag resolves to and says which version it took.
- **`latest` unless told otherwise**, with `--tag` for a preview line.
- **A checkout is never touched.** `pnpm rigline` in this repository must not install an engine.

## The payload says who wrote it

`install` writes the engine version into the payload directory it creates under
`<ext>/webview/rigline/`, alongside `generated.js` and `registry.js`, so a stale injection stops
looking identical to a current one (D75).

**The stamp is `registry.js`, and it lands in 7a.** The phase list below does not name it, and it
belongs there rather than in 7b for the reason 7a ends the way it does: its acceptance is a live
read on a machine that installed from npm, and "the badge is green" is a weaker reading than "the
badge is green and says the engine that wrote this payload is the version I just installed". The
7b half is only the wrapper passing its own version down so the report names both.

`registry.js` rather than a JSON file beside it, which was the other candidate. The webview cannot
fetch (no `connect-src`), so anything the probe reads has to be a module the post hook already
imports — and `registry.js` is baked by the same `install` that knows the version. One fact, one
file. The Node-side readers pay for that with a bounded regex over a line this repository writes
itself, which is cheaper than two writes of one version that can disagree.

Three readers, and the plumbing each needs:

- `doctor` already inspects the payload directory and lists its files
  ([doctor/install.ts:134](../packages/core/src/doctor/install.ts#L134)); it reports the stamp against
  `CORE_VERSION`, and the wrapper passes its own version down so the report names both.
- `check` reads the injected stamp — it touches only `harvestOne` today, so this is new wiring, not a
  field on `FlowOptions`.
- The probe reads it through the diagnostics object, never by importing the host: a plugin may not
  reach past `ctx`, and an undeclared member may not widen what a plugin can reach (D18, D63). The
  kernel puts what `registry.js` exports onto diagnostics, which is the read path the probe already
  has for every other host-provided value.

## Recovery without the CLI

`restore` is the recovery from a blank panel, and somebody who installed from npm has no checkout to
fall back on. The backups sit beside the bundles as `index.js.orig` and `extension.js.orig`, so
un-patching is a file copy. Write it down where a person can find it when the panel is blank.

## Phases

Both phases carry `CHANGELOG.md` entries under `## Unreleased` in the same commit as the change
(D60). 7a ships four plugins, two commands, a discovery root, a `list` column, a payload stamp and
a scaffold dependency; 7b changes a bin name and a spec spelling. All user-visible.

### 7a: the published artefact works

Ends the blocker. Ships on its own, and keeps today's package structure — `rigline` still depends on
core here; 7b is what separates them.

- Core's published `dist/bundled/` carries `pre.js`, `post.js` and the four built plugins. The copy
  is a **workspace step**, not core's own build: plugins build through `rigline build`, so a
  build-order edge from core to the plugins would be a cycle. It is `scripts/bundle-assets.mjs`, the
  root `build` becomes `pnpm -r build && node scripts/bundle-assets.mjs`, and all three callers run
  `pnpm build` first — `ci.yml`, `release.yml`, and `release.mjs`'s pre-cut gate. `tsc` does not
  clean `packages/core/dist`, so `dist/bundled` survives a later core-only rebuild — which is exactly
  why the guard below is needed.
- **Copy bytes.** `cpSync`, never text-mode I/O — a `readFileSync(…, "utf8")` here rewrites every
  line ending in the payload on this machine before it is ever injected (D37). `dist/` is gitignored,
  so `* text=auto` never sees it.
- **Resolve `dist/bundled` by walking up to the nearest `package.json`**, not by a fixed offset from
  `import.meta.url`. [vitest.config.ts:22](../vitest.config.ts#L22) aliases `@rigline/core` to
  `packages/core/src/index.ts`, so a fixed offset means `src/bundled` under test and `dist/bundled`
  when built, and the suite would exercise a directory that does not exist.
- **The staleness guard is a chain, at the point of use.** `dist/bundled` newer than
  `packages/host/dist` and each `plugins/*/dist`, *and* each of those newer than its own `src` — one
  link alone passes when a stale `host/dist` is faithfully copied to a newer `bundled`.
  `preparePayload` carries the second link today
  ([harness/src/payload.ts:54-70](../packages/harness/src/payload.ts#L54-L70)); the resolver carries
  the first and must not be mistaken for it. Name the build command in the refusal.

  **Both links live in the resolver, and `preparePayload` loses its own check** rather than keeping
  half a chain beside a whole one. The harness is about to copy from `dist/bundled`, so the question
  it needs answered is the resolver's question, and a second mtime scan in `payload.ts` would be a
  rule that agrees with the resolver until the day somebody changes one of them. The guard runs only
  where it can: a published install has no `packages/host/src` to compare against, so the chain is
  checked when the workspace marker holds and skipped when it does not.
- **The harness copies from `dist/bundled`**, so tier 2 drives the bytes a user gets rather than a
  second source of truth. CLAUDE.md's "rebuild the host before running the harness tests" rule moves
  with it.
- **Root 1 gets the workspace-marker rule above**, replacing `repoPluginsDir()`'s path arithmetic.
  Discovery skips a non-existent root, and the bundled-shadowing noise is suppressed as described.
- **Rolldown becomes a lazy import and a devDependency.** `cli/src/index.ts` statically imports
  `./build.ts`, which statically imports `rolldown`: undeclared and static, `rigline --help` throws.
  `buildPlugin` uses `await import("rolldown")` inside a try/catch producing a named install message,
  rolldown stays a devDependency so `tsc` resolves its types, and the packed CLI stops carrying 20 MB
  of native binding. Doing it here rather than in 7b is what makes the test below work offline.
- **The scaffold's template gains rolldown in this phase, not 7b.** A scaffolded workspace gets
  rolldown today only because it depends on `rigline`, which depends on rolldown; the bullet above
  removes that the moment 7a is published. The template's hand-written devDependency range is the
  same edit whenever it is made, and made a phase late it is a released version where `pnpm build`
  in a fresh scaffold fails on the first command the guide tells an author to run — which is
  precisely the failure D50 already records happening once.
- `rigline disable NAME` and `rigline enable NAME`, both re-injecting.
- `list` gains an origin of `bundled` and a version column, sourced from `CORE_VERSION` for a bundled
  plugin, from the recorded source for an installed one, and empty for a hand-placed one.
- **The payload stamp** (see "The payload says who wrote it"): `registry.js` carries the engine
  version, `doctor` and `check` report it against `CORE_VERSION`, and the probe reads it off
  diagnostics.
- **The pack-and-install test.** `pnpm pack` — not `npm pack`, which leaves `workspace:*` in the
  manifest — then install the tarballs into a temporary prefix with `--ignore-scripts` and run
  `install` against a copied extension directory (never the live one, D39). With rolldown gone this
  needs no registry.

  It is a fourth verification tier: **tier 4, the tarballs, installed**, with a row in
  [verification.md](verification.md) and a line in D36. **It runs under `pnpm test`**, so
  `verification.md`'s "everything but the probe runs under one `pnpm test`" stays true as written.
  The alternative — a script of its own and a fifth CI step — buys a faster inner loop and pays for
  it with the one property this tier exists for: a check that has to be remembered is a check that
  answers a question nobody asked on the day it mattered, which is the whole diagnosis of the
  blocker. It lives at `packages/cli/test/packed.test.ts`, because the tarball a person installs and
  the command they then run are the CLI's.
- The CLI-free recovery procedure is documented.
- README's "No plugins are published yet" paragraph goes.

Gate: the pack-and-install test passes on every CI rung, offline.

**7a ends with a release and a live read**, not with a green CI run. Its real acceptance — `npm i -g
rigline@<version>` on a machine with no checkout injects, bakes four plugins, and the `RIG` badge
reports green after a reload — needs a published version, and plan.md's own rule is that a pipeline
step nobody has run is a defect rather than a gap.

### 7b: the wrapper and the engine separate

- `packages/cli` becomes the wrapper: `update`, the remote half of `add`, engine installation, and
  verbatim forwarding. It drops `@rigline/core` and declares nothing.
- The registry client, the tarball reader, the integrity check and the age gate move up into it. All
  are dependency-free today and must stay so. `manage.ts` does **not** move: `addPlugin`, `place`,
  `removePlugin`, the `sources` read-modify-write, `checkManifest` and `describeUses` all stay in the
  engine, and `isPluginOutput` stays where it is, since the injector shares it.
- The engine's `add` gains an optional source record and the unknown-kind refusal; `readConfig` stops
  throwing on an unknown kind.
- The rest of the command surface moves from `packages/cli` into core, which gains the
  `rigline-engine` bin.
- The wrapper refuses an engine major it does not know, and installs within its own major.
- **What actually has to change is narrower than "every `rigline <verb>`".** The user-facing command
  stays `rigline` for every verb, because the wrapper forwards, so prose that types `rigline check`
  is correct as it stands. What changes is a `package.json` script or a `pnpm rigline` invocation
  inside a project that no longer depends on `rigline`: the root `codegen` script, `"build": "rigline
  build"` in all four plugin manifests, and the template's root and member manifests. **Both this
  repository and the template gain a new forwarding `rigline` script** — neither has one today;
  `pnpm rigline` works only because the bin is linked by a devDependency that is being removed.
- Docs to edit: `CLAUDE.md`'s command table and its `pnpm rigline` note, `CONTRIBUTING.md`, the
  package tables in `plan.md` and `architecture.md`, `architecture.md` and `plan.md` where they name
  `config.json` as holding sources, `releasing.md`'s four-package narrative, root `README.md`'s
  Layout block, `packages/cli/README.md` (which documents all fourteen verbs and is now the
  wrapper's), `packages/core/README.md` (which now needs the command surface),
  `packages/create-plugin/README.md`, the template README, the scaffolder's printed next step, and
  the template's plugin test comment.

Acceptance: the wrapper adds nothing to stdout for a forwarded verb once an engine is installed, and
exits with the child's code; no project in the tree or in a generated scaffold depends on `rigline`;
and a generated scaffold builds and runs `add` with no global install.

**The upgrade-in-anger check is deliberately not run** (2026-09-21, Leo). It was to be a manual
tier-3 pass — an older engine installed, one `rigline update`, every extension version left injected
by the newer one — and it needs two published versions carrying `rigline-engine`. The registry has
none: `@rigline/core@1.0.0-alpha.5` has no `bin` at all, so the oldest engine that can be downgraded
to is whichever release ships this step. Cutting a version before the step, to be the older half,
was offered and declined. So the path is covered at tier 1 with a faked spawn and at tier 4 against a
packed tarball, and the one question neither answers — whether a *published* older engine upgrades
cleanly — is carried as unrun rather than as passed. plan.md's rule about an unrun pipeline step
applies: treat it as a defect, and the first release that follows one is where it gets discharged.

#### Settled: the help, the typo, and the version

**The engine prints the usage, for every verb including the ones it refuses.** The wrapper has no
verb list and must not grow one — that is what lets core add a command without a wrapper release —
so an unknown verb is forwarded like any other and the engine answers it. `--help` and a bare
`rigline` forward too, which means the engine's usage is the whole `rigline` surface rather than a
list of what the engine implements: it documents `update`, and refuses it with a pointer to
`rigline update` when somebody runs it against `rigline-engine` directly. A verb the engine also
does not know is one usage block and a non-zero exit, from one place.

**So a typo does trigger the first-run engine install, and that is the right answer rather than a
tolerated one.** The wrapper cannot tell `instal` from a verb a newer engine has without holding the
list it is designed not to hold. The install is not wasted either — the next command needs it — and
the alternative is a hardcoded list that goes stale in exactly the direction that matters, refusing
a verb that exists.

**`rigline --version` is the one thing the wrapper answers itself**, printing its own version and
the installed engine's, or naming the absence before a first run. It installs nothing. The line
between this and `--help` is not taste: a version is a question about what is on this machine, which
the wrapper can answer from `<prefix>/node_modules/@rigline/core/package.json` — the file it already
reads to find the bin — while a usage is a question about what the tool can do, which only the
engine knows. And a version query is what somebody runs when something is already wrong, so making
it reach the network first is the opposite of a diagnostic.

The wrapper reads its own version from its own `package.json` rather than from a constant. It cannot
import core's, a second constant is a second thing to bump, and the release script already rewrites
every manifest.

#### `rigline build` after the split, which is not obvious

`build` is an engine command and rolldown is a lazy import, so the engine resolves rolldown from
wherever *it* sits. In an author's workspace that is `node_modules/@rigline/core/…` walking up to
the workspace's own `node_modules/rolldown`, which is why the scaffold declaring rolldown (7a) is
what keeps this working. In `<RIGLINE_HOME>/engine` there is no rolldown and there should not be:
`rigline build` run globally fails with the named install message, which is correct, because a build
happens in a workspace and never against a user's engine.

#### Order, so the tree is green at every step

1. The command surface moves into core, which gains the `rigline-engine` bin; `packages/cli` becomes
   a file that calls it. Nothing about dependencies changes yet.
2. The registry client and the tarball reader move up into the wrapper; the engine's `add` takes an
   optional source record and refuses a kind it does not know; `readConfig` skips one.
3. The wrapper drops `@rigline/core`: engine installation, forwarding, `update`, and the remote half
   of `add` — **and this repository's own scripts move off the wrapper in the same step**. The root
   and the four plugins take `@rigline/core` as the devDependency and spell the bin
   `rigline-engine`, with a forwarding `rigline` script at the root so `pnpm rigline <verb>` keeps
   working. Not deferrable to 4: the moment the wrapper stops calling core in-process, `pnpm build`
   runs `rigline build` in four packages, which reaches for an engine from the registry. There is no
   green tree between the two halves.
4. The template, which has the same two changes and none of the urgency.
5. Docs.

## Decisions to record

Numbers continue from D68.

- **D69.** The engine cannot update the engine, so `rigline` is a retrieval layer above
  `@rigline/core` and belongs in no project's dependencies.
- **D70.** The wrapper vets the container; the engine vets the content. There is one `add`, in the
  engine, taking a path; the wrapper's remote handling turns a spec into one.
- **D71.** The first-party plugins ship inside `@rigline/core`, discovered in place, versioned with
  the engine.
- **D72.** probe's home is settled and it is never installed by name; the other three are bundled
  until there is a reason not to be. Any of them may be switched off, and `doctor` says so.
- **D73.** The engine installs into `<RIGLINE_HOME>/engine` through npm, never globally, and is the
  only engine on the machine. Wrapper and engine move majors together.
- **D74.** A plugin spec names its source; the manifest's `name` remains the runtime identity and the
  installed directory's name. The engine owns `config.json`, sources included, and skips a source
  kind it does not recognise rather than throwing.
- **D75.** The payload records the engine version that wrote it.

### Amendments

- **D47** — its headline is already scoped to `rigline add`; what it needs is the engine carve-out.
  Installing the engine is what npm is for, and it passes `--ignore-scripts`.
- **D55** — "`install` is the one write command about the injection" is *already* false:
  `updateCommand` re-injects when a plugin moved
  ([cli/src/index.ts:262-270](../packages/cli/src/index.ts#L262-L270)), and CLAUDE.md says both
  things in two places. Fold the `add`/`remove` carve-out in and fix CLAUDE.md.
- **D56** — keeps its ordering rule and its collision check, which moves to the engine's `add`
  along with everything else about placing. What changes is the verdict for a bundled name:
  allowed, because overriding is the point.
- **D58** — gains the `npm:` spelling beside the bare name, and its opening sentence still names
  `config.json`, which remains correct.
- **D49** — records that the engine writes the source it is handed, and the unknown-kind skip.
- **D46** — after 7b `rigline` has no workspace dependency on core, so `stage approve`'s protection
  against publishing a package whose dependency did not make it stops covering the one package where
  it matters. Say so, and add the check to `releasing.md`.
- **D35** — `dist/bundled` ships about 800 kB, three quarters of it inline source map, and the
  bundles carry comments. Both halves of D35 are breached and the same CSP argument excuses both;
  say it once, or somebody will "fix" it.
- **D36** — the published artefact is a question no existing tier owns. Name the tier.
- **D32** — user state gains `<RIGLINE_HOME>/engine`, worth naming since the recovery instruction is
  `rm -rf` on it.

D33 needs no amendment; it is simply the right citation for "we will not run an author's build on a
user's machine".

## Deferred, with triggers

- **git as a plugin source.** Preferred over npm for third-party plugins: no publish ceremony, no npm
  account, a tag is the whole release. It needs no `git` binary — GitHub, GitLab and Codeberg serve
  `archive/<ref>.tar.gz`, which the tar reader already handles, with the sha as the integrity check
  and `{kind: "git", url, ref, sha}` as the source record D49 left room for. Its one cost is a
  constraint npm does not impose: the built entry must be committed at the ref, because we will not
  run an author's build on a user's machine (D33). The spec syntax and the unknown-kind skip already
  accommodate it. Revisit D33 when it is taken.
- **A plugins repository.** The home for a non-core first-party plugin, scaffolded by
  `create-rigline-plugin` and installable by URL and tag. Triggered by a fourth plugin that is not
  part of the product; the git source is its prerequisite.
- **The companion extension** ([plan.md](plan.md) phase 5). The only keystroke-free update, since VS
  Code updates its own extensions. Core carrying the bundled assets is what lets it inherit them
  without a second packaging decision.
