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
    dist/bundled/plugins/{session-id,time-marks,worktree-prefix,probe}/{rigline.json,index.js}

Core rather than the wrapper, because core is what injects and discovers, and the phase 5 companion
extension consumes core and will need the same assets (D31).

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
  dependency.
- **Create the directory first.** npm writes `package.json`, `package-lock.json` and a dependency
  range into it. `--save-exact` is required: a caret range is a second mechanism deciding what is
  installed, disagreeing with the pin the moment anyone runs a bare `npm install` there, which is
  what D58 refuses for a plugin source; and a caret on a prerelease is narrower than it looks (D50).
  Verify npm's behaviour in an empty directory by running it, not by reasoning about it.
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
      -> spawn the engine: add each staged plugin, then install
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
- **The age gate applies to the engine** as to a plugin: 1440 minutes, `--now` to override, a
  withheld version reported by name with its age (D48). What made the delay affordable there holds
  here — the urgent repair is `~/.rigline/anchors.json`, which needs no publish (D44).
- **`latest` unless told otherwise**, with `--tag` for a preview line.
- **A checkout is never touched.** `pnpm rigline` in this repository must not install an engine.

## The payload says who wrote it

`install` writes the engine version into the payload directory it creates under
`<ext>/webview/rigline/`, alongside `generated.js` and `registry.js`, so a stale injection stops
looking identical to a current one (D75).

Three readers, and the plumbing each needs:

- `doctor` already inspects the payload directory and lists its files
  ([doctor/install.ts:134](../packages/core/src/doctor/install.ts#L134)); it reports the stamp against
  `CORE_VERSION`, and the wrapper passes its own version down so the report names both.
- `check` reads the injected stamp — it touches only `harvestOne` today, so this is new wiring, not a
  field on `FlowOptions`.
- The probe reads it through `registry.js` or the diagnostics object, never by importing the host: a
  plugin may not reach past `ctx`, and an undeclared member may not widen what a plugin can reach
  (D18, D63). Decide which of the two carries it during 7c-equivalent work in 7b; it is a host-provided
  value like any other.

## Recovery without the CLI

`restore` is the recovery from a blank panel, and somebody who installed from npm has no checkout to
fall back on. The backups sit beside the bundles as `index.js.orig` and `extension.js.orig`, so
un-patching is a file copy. Write it down where a person can find it when the panel is blank.

## Phases

Both phases carry `CHANGELOG.md` entries under `## Unreleased` in the same commit as the change
(D60). 7a ships four plugins, two commands, a discovery root and a `list` column; 7b changes a bin
name, a spec spelling, and what the scaffold depends on. All user-visible.

### 7a: the published artefact works

Ends the blocker. Ships on its own, and keeps today's package structure — `rigline` still depends on
core here; 7b is what separates them.

- Core's published `dist/bundled/` carries `pre.js`, `post.js` and the four built plugins. The copy
  is a **workspace step**, not core's own build: plugins build through `rigline build`, so a
  build-order edge from core to the plugins would be a cycle. It lives in `scripts/`, the root
  `build` becomes `pnpm -r build && node scripts/<name>.mjs`, and all three callers already run
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
- `rigline disable NAME` and `rigline enable NAME`, both re-injecting.
- `list` gains an origin of `bundled` and a version column, sourced from `CORE_VERSION` for a bundled
  plugin, from the recorded source for an installed one, and empty for a hand-placed one.
- **The pack-and-install test.** `pnpm pack` — not `npm pack`, which leaves `workspace:*` in the
  manifest — then install the tarballs into a temporary prefix with `--ignore-scripts` and run
  `install` against a copied extension directory (never the live one, D39). With rolldown gone this
  needs no registry. It is a fourth verification tier: give it a name, a row in
  [verification.md](verification.md), and a line in D36, and say whether it runs under `pnpm test` or
  beside it — `verification.md`'s "everything but the probe runs under one `pnpm test`" has to stay
  true or change.
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
- **The scaffold's template gains rolldown** as a hand-written devDependency range —
  `__RIGLINE_RANGE__` is derived from the scaffolder's own version (D50) and cannot supply it.
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
a generated scaffold builds and runs `add` with no global install; and, as a manual tier-3 check
needing two published versions, one `rigline update` with an older engine installed leaves every
installed extension version injected by the newer engine and says so.

Decide during 7b: who prints usage for a verb neither package knows, and whether a typo triggers a
first-run engine install before it is rejected; and what `rigline --version` reports, which D75 wants
to be both.

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
