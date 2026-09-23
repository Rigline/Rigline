# Verification: four tiers, and knowing which one a question belongs to

Rigline's tests answer four different kinds of question, against four different things, and most
of the work is putting a question in the right place. A question about a regex against a real bundle
belongs to the corpus; a question about whether a decoration survives a re-render belongs to a
browser; a question about what a person who installed from npm actually gets belongs to the tarball;
and a question about whether the whole thing works in the actual extension belongs to the probe, and
nothing else can answer it. The reasoning is D36 and D39 in [decisions.md](decisions.md).

Everything but the probe runs under one `pnpm test`.

A tier's number is what it is called, not how close it is to a real editor. Tier 4 arrived last and
is the cheapest of the four; it sits at the end because that is where a new one goes.

## The rule that comes before the tiers

**Never point a test at the live extension directory** (D39). A failing assertion mid-test leaves a
real install half-patched, and the panel renders blank when the static import is broken. Tests work
over throwaway copies (`mkdtempSync`) and over the corpus, which is read-only by convention and
outside the repo.

## A test whose pass is an absence must first prove the trigger fired

Half the assertions worth making about this project are negative: no notification, no rewrite, no
reaction. Every one of them passes just as convincingly when the thing under test never ran, and
that failure is invisible — it looks exactly like success and arrives faster.

It has been read wrong twice. A companion test that asserted silence after an extension replacement
passed while the replacement went into a profile the window did not use, onto a version whose
directory already existed; nothing moved, so nothing fired, so the silence meant nothing. The same
shape a layer down: "the second run wrote nothing" is worthless unless the first run wrote
something.

**So a negative assertion carries a positive one.** Name the observable that proves the trigger
arrived — the log line, the changed mtime, the new directory — and assert that too, in the same
test or the same live read. Where the trigger is a person's command, check its effect on disk rather
than its exit code: an install that resolved to a version already present reports success and
changes nothing.

This is not tier-specific. In tier 1 it is the assertion above the one you meant to write; in tier 4
it is the line you look for in the output channel before concluding that the silence after it was
the designed silence.

## A step nobody has run is a defect, not a gap

A claim nothing has exercised — a pipeline step, a live acceptance read — is carried as *unrun* until
something does, and is discharged at the first release that makes it possible. Green tiers around it
are not evidence for it: the first release driven end to end found five things the pipeline asserted,
and none of them was true.

## Tier 1: Node, under vitest

Pure functions and file transforms: every harvest layer, the diff and its successor suggestions,
codegen's byte-stability, the injector, discovery and registry baking, every capability contract's
`violation` and `summary`, the manifest reader and the JSON schema, the anchor resolver and the
override merge, the tarball reader, the registry client with its fetch injected.

The built `pre.js` is tested here too, against a stubbed `acquireVsCodeApi` in the same process:
immutability, envelope unwrapping, the buffer, the chain, resend, the counts. It needs no DOM, so it
does not need a browser.

Two sources of bundle text, and the difference matters:

- **Synthetic fixtures** (`packages/core/test/fixtures.ts`) pin a pattern's edges — the hyphenated
  local name, the lazily-initialised module map, the `sessionId:"abc123_OOQiHg"` near-miss, a
  payload whose value is a call or an array. They are built to clear every layer's floor, so an
  install test can run against a fixture extension end to end.
- **The corpus** (`c:\dev\kb\vscode-claude-code-versions\<version>\`, one directory per version
  holding `extension.js`, `webview/index.js`, `webview/index.css` and `package.json`) is the only
  guard against a regex drifting away from real minified output. A test that needs a version it does
  not have **skips with a reason** rather than failing, so a fresh clone is not blocked on a
  download — but a machine that develops Rigline should have it. The ground-truth tests sweep every
  version in `CORPUS_VERSIONS` (`packages/core/test/corpus.ts`); the harness drives one of them,
  `HARNESS_VERSION`, which moves with the installed extension and the committed `generated.ts`.

The injector's fixtures deliberately carry CRLF line endings and non-ASCII bytes, because
byte-faithful I/O is the property under test (D37): text-mode I/O on Windows rewrites every line
ending and turns a 133-byte patch into a 2.2 KB one.

Tests resolve `@rigline/plugin-api` and `@rigline/core` to their **sources**, through aliases in
`vitest.config.ts`, so a test never runs against a stale `dist/`. Builds and typechecks resolve
through each package's exports, as a consumer would.

### The compile test

`packages/core/test/compile.test.ts` drives `tsc` in a child process, because it asks the one
question no runtime test can: does a plugin author find out *while typing* that they have paired a
class with the wrong module or named a message that does not exist.

Both halves of D40 are asserted. With a harvest, the unions narrow and a wrong pair is an error;
with no harvest, every union widens to `string` and the same source compiles — which is what lets a
freshly scaffolded plugin build before codegen has ever run. The augmentation is written *outside*
the fixture plugin's directory and pulled in by the tsconfig, because that is the arrangement the
template needs: one harvest at a workspace root serving every plugin in the repository (D50).

It is worth the child process. A module augmentation resolving and merging across a program boundary
is exactly the kind of property that works when it is set up and quietly stops working a year later.

## Tier 2: the harness, over the real bundle

`packages/harness` boots the extension's **actual webview bundle** from a corpus snapshot, in
headless Chromium, with a faked `acquireVsCodeApi` and a scripted host — no VS Code, no install, and
no reload loop. It answers everything about host and plugin DOM behaviour: does a mount land beside
the right anchor, survive a re-render, keep registry order; does a refusal leave the other plugins
alone; does a rewrite reach the wire; does a decoration find its row.

Four pieces:

- **The fixture page** (`page.ts`) reproduces the extension's own `getHtmlForWebview` template: the
  three `window.IS_*` globals, `#root`, a CSP close to the real one, and an inline script defining
  `acquireVsCodeApi` before the module script runs. It hard-codes no identifier from any bundle,
  only the boot contract every version relies on, so one page serves every corpus version.
- **The fake host** is a reply table keyed by the outbound request's inner type — a plain table, not
  a stateful mock, because the real host's behaviour is not what is under test. It is seeded with
  the boot floor every surface needs; `get_claude_state`'s `config.openNewInTab` is set true because
  that is what makes the app's own tab-title effect actually call `renameTab()`, turning a dead
  branch into something a rewrite test can observe. `test/page.test.ts` holds each key to a real
  message type and each reply to the one the harvest pairs with its request, reading the committed
  `generated.ts`, so it runs without corpus or browser and is exact only while that file and
  `HARNESS_VERSION` are the same extension.
- **`preparePayload`** writes exactly what a real injector would leave on disk: `pre.js` and
  `post.js` copied from `@rigline/core`'s `dist/bundled`, `generated.js` harvested fresh from the
  corpus version, a `registry.js` baking whichever fixture plugins the test wants, and each plugin's
  source as a module string. From `dist/bundled` rather than from `packages/host/dist`, so this tier
  drives the bytes a user gets rather than a second source of truth (D71).
- **`register(version)`** launches one browser per file and gives each test its own payload, server
  and page. Per-test on purpose: a plugin deliberately made to fail writes an expected
  `console.error`, and a shared page would leak it into an unrelated test's assertions.

Two details that were each a debugging session before they were code:

**`boot()` waits on `diagnostics.bufferSealed`, not on the app's own markup.** The pre hook is
static but `post.js` loads dynamically, so the app can be fully rendered before a single plugin's
`setup()` has run. A test that waits on a node its own plugin placed gets the synchronisation for
free; one that reads what `setup()` installed on `window`, or pushes a message expecting a tap to be
listening, does not — and it fails only when the machine is loaded enough to widen the window, which
is the whole suite and never the test alone. `bufferSealed` is set in the `finally` of the
plugin-loading loop, so it means *every plugin has had its chance*, refusals included.

**`remove` stands up an extension update in front of the real bundle.** It deletes named anchors,
modules or message types from the tables the loader reads, leaving the bundle itself untouched —
which is precisely the state a plugin meets on the morning after an update it has not caught up
with, and a state no harvest would ever produce. An anchor is removed from all three tables at once
(class, selector and reason), because an anchor that resolved to no class but still to a selector
would leave `watch` finding the element the test says has gone.

**Rebuild before running these.** `preparePayload` copies `dist/bundled/{pre,post}.js`, so vitest
alone exercises whatever was last built. A change to
the host with no `pnpm build` would give a green run against the previous payload — a result about
code that is not loaded, which is worse than a red one — or a failure you then debug in source that
was never running. `bundledDir()` refuses rather than letting either happen, and it carries the
whole chain rather than the half `preparePayload` used to: `dist/bundled` newer than
`packages/host/dist` and each `plugins/*/dist`, *and* each of those newer than its own `src` — since
a stale `host/dist` copied faithfully into a newer `bundled` passes the first link on its own. The
refusal names the build command. The rule used to live in `CLAUDE.md` and rely on everybody
remembering it.

A file skips, with a reason, when the corpus lacks its version or Chromium will not launch — and the
reason says which.

## Tier 3: the panel, in the real extension

`plugins/probe` renders Rigline's diagnostics panel in the actual webview, and is the only tier that
exercises the real extension host, the real CSP, the real React build and the real install.

**A check is contributed, not written into the probe** (D63). The kernel and each capability module
contribute the host's lines under `core`; every plugin contributes its own through `ctx.check`, under
its own name. So the panel answers *which part of this is broken* — and a plugin, which is precisely
the thing whose failure was invisible, now has somewhere to say what working would look like.

The probe is one contributor among several, which is the test of whether the shape is right. It keeps
only what is an experiment rather than a reading: register a tap and check the tap saw the app's
original, rewrite twice and check the chain composed. Everything it can reach through `ctx` it
reaches through `ctx`, exactly as a third-party plugin would, which is what makes an all-green badge
evidence rather than self-assessment. The one exception is `globalThis.__rigline`, read directly and
by nothing else: rendering every contributor's verdict, and the diagnostics the copied report
carries, is not a capability a manifest could sanely declare.

The verdict logic behind `core` is pure and tested in Node, in
[verdicts.test.ts](../packages/host/test/verdicts.test.ts), with the registry's own behaviour — a
throwing check, a malformed one, the grouping — beside it in `checks.test.ts`. Tier 2 proves the
registry end to end through the real `ctx`, in
[kernel.test.ts](../packages/harness/test/kernel.test.ts). What is left for this tier is the thing
none of them can answer: whether the lines are true of a real panel.

Three verdicts, and **`n/a` is a real state**: a check that cannot apply on this surface, or has had
no opportunity yet, says so instead of guessing. The panel, the badge count and the clipboard are
all built from one run of the registry, so they cannot disagree about what a check found.

The loop is: `pnpm build`, `pnpm rigline install`, *Developer: Reload Webviews*, read the `RIG`
badge — on the full editor, the sidebar and the session list, because the three surfaces differ in
what exists to check.

Its copied report also carries the numbers nothing else can produce: the meters' peaks, the mount
counters, and the two findings that should be empty. `mounts.multiple` names a singleton anchor
whose selector matched several elements, so a decoration may be on the wrong control.
`mounts.abandoned` names a mount or watch the host gave up on, so a decoration is gone and the panel
was flickering before it went.

`rigline doctor` is the other half of a bug report: install state per version, as a pasteable
report, from files we wrote. VS Code's own logs are deliberately out of scope (D53).

## Tier 4: the tarballs, installed

`packages/cli/test/packed.test.ts` packs what a release would publish, installs those tarballs into
**two** temporary prefixes with nothing else on the machine, and runs `install` out of them against
a fixture extension directory.

Two prefixes because that is what a user has (D73): `rigline` on its own, and `@rigline/core` with
its dependency under a temporary `RIGLINE_HOME/engine`. The engine goes in through
`engineInstallArgv`, the construction the wrapper itself hands npm, so what runs here is the real
invocation rather than a copy that can drift from it. Resolving a version against a registry is the
one step of the path that cannot happen here, and tier 1 fakes it.

It exists because of a failure the other three could not see. Every one of them drives this
workspace, where a relative path from a package's `dist` happens to reach the files beside it.
Installed from npm those paths reach nothing, and `rigline install` threw `payload is missing pre.js`
for two releases while every tier was green. The question it owns is therefore narrow and nothing
else asks it: **does what a person downloads do its job?**

Three details are load-bearing:

- **`pnpm pack`, never `npm pack`.** npm leaves `workspace:*` in the packed manifest, which installs
  as a dependency npm cannot resolve. pnpm substitutes the exact version, which is also what lets
  the tarballs resolve each other (D46).
- **`--offline`**, so a run that silently reached for the registry would fail rather than becoming a
  test of the network. Nothing needs it: the published packages depend on each other, and the
  engine's one third-party dependency is pinned exactly and packed from the copy this workspace
  installed (D87), which is what the registry would have served.
- **`--ignore-scripts`**, because nothing here has an install script and the surface is declined
  rather than defended (D47). And `RIGLINE_HOME` points into the temporary directory, so the run
  cannot read or write the developer's own config, plugins or baseline.

**Checking a generated scaffold is a manual pass, and it is not tier 4.** Tier 4 packs and installs
*our* tarballs; a scaffold is a workspace `create-rigline-plugin` writes, whose dependencies resolve
from the registry. To run one against this tree rather than against what is published: scaffold into
a temporary directory, `pnpm pack` core and plugin-api into it, rewrite the two Rigline ranges in the
generated root and member manifests to `file:` those tarballs, and set `minimumReleaseAge: 0` in the
generated `pnpm-workspace.yaml` — the gate refuses a registry-resolved transitive dependency
published inside its window, and `--config.minimumReleaseAge=0` does not override it. Then
`pnpm install`, `codegen`, `build`, `typecheck`, `test`. Stop before `rigline add`: it re-injects
whatever extension is installed on the machine, which is not something a check should do to somebody's
editor. What this catches and nothing else does is the resolution question — whether
`rigline-engine build` finds rolldown from the workspace it is invoked in.

**That pass cannot see the gate at all, and the gate is where a scaffold broke.** Rewriting the
ranges to `file:` and zeroing the age removes both halves of the question, so the release-age failure
D50 records — a workspace unable to install the release that scaffolded it — is invisible to it by
construction. The pass that sees it is the published one, and it is only available in the day after a
release: `npm create rigline-plugin@latest` into a temporary directory, then `pnpm install` and
nothing else. It passes when the two `minimumReleaseAgeExclude` entries name the versions the
manifests declare. To check the exclusion is still *narrow*, widen `minimumReleaseAge` to something
no package satisfies and install again: every third-party dependency should be refused and no
`@rigline` one.

It also runs `rigline` **by name**, through the shim npm wrote from the `bin` field, and not only
`dist/index.js` by path. Three declarations have to hold together for a command to exist at all —
`bin` in the manifest, the entry inside `files`, and the shebang surviving `removeComments` in the
build config — and running the file directly asks none of them. A local install rather than
`--global`, because both go through npm's `bin-links` and only the location differs; `--global`
costs about seven seconds of fixed overhead on Windows to test npm's own prefix layout, which is
npm's business rather than ours.

It asserts what the command *did* — the payload beside the bundle, the four plugins baked into
`registry.js` with their entry files present, "injected" printed — and deliberately not its exit
code. A synthetic bundle carries none of the curated anchors, so every plugin's declaration check
fails against it and `install` exits 1 to say a person is needed. That is D27 working rather than a
failure: a refused plugin is still copied, still baked, and never blocks the injection.

It runs under `pnpm test` with everything else, and costs about a second. A script of its own and a
fifth CI step would buy a faster inner loop and give up the one property it exists for — a check
that has to be remembered is a check that answers a question nobody asked on the day it mattered,
which is the whole diagnosis of what it catches. It needs no corpus and no browser, so unlike tier 2
it is one of the few things a CI run proves as fully as a local one.

## In CI, and what it cannot reach

`.github/workflows/ci.yml` runs `lint`, `typecheck`, `build` and `test` on every push to `main` and
every pull request, on Node 22.12.0, 24 and 26, and once more on Windows at 22.12.0 (D59). The
release workflow runs the same four steps again before it stages anything, so nothing reaches npm
that a pull request would not already have failed on.

What CI cannot reach is the corpus, which lives outside the repository: tier 2 skips in full, and
the corpus-backed half of tier 1 skips with it. So a green run there is the pure functions, the
transforms, the synthetic fixtures and tier 4, on four runners — and every line of the table below
that says *corpus* or *harness* is answered on a maintainer's machine or nowhere. That is the reason
[releasing.md](releasing.md) asks for a local run before a release, and the reason the skip carries
a reason rather than passing quietly.

Tier 4 is the exception, and worth naming as one. It needs no corpus, no browser and no registry, so
it runs in full on every rung — which matters because the question it asks is about the artefact CI
is about to stage.

The floor rung is the one part of the matrix that is not free to move: 22.12.0 is what the four
published packages declare in `engines`, so lowering or raising it means moving the rung first and
then the same number in the workspace root and the scaffolder's template (D59).

## Choosing a tier

| the question | where it belongs |
| --- | --- |
| does this regex read a real bundle | corpus, tier 1 |
| does this regex handle *that* shape | synthetic fixture, tier 1 |
| do these bytes round-trip | tier 1, over a throwaway copy |
| does the compiler catch a wrong pair | the compile test |
| does this node land in the right place, survive a re-render, keep its order | the harness |
| what happens to a plugin the day an identifier goes | the harness, with `remove` |
| is it in the tarball, and does it work from there | tier 4, the packed install |
| does it work in the actual extension | the probe, and only the probe |

When a tier cannot answer a question, say so rather than approximating it in a cheaper one. The
harness cannot tell you whether the real composer reflows around your decoration; the corpus cannot
tell you whether react-dom injected. Both of those are probe questions, and were found by the probe.
