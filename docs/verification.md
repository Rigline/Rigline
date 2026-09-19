# Verification: three tiers, and knowing which one a question belongs to

Rigline's tests answer three different kinds of question, against three different things, and most
of the work is putting a question in the right place. A question about a regex against a real bundle
belongs to the corpus; a question about whether a decoration survives a re-render belongs to a
browser; a question about whether the whole thing works in the actual extension belongs to the
probe, and nothing else can answer it. The reasoning is D36 and D39 in [decisions.md](decisions.md).

Everything but the probe runs under one `pnpm test`.

## The rule that comes before the tiers

**Never point a test at the live extension directory** (D39). A failing assertion mid-test leaves a
real install half-patched, and the panel renders blank when the static import is broken. Tests work
over throwaway copies (`mkdtempSync`) and over the corpus, which is read-only by convention and
outside the repo.

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
  download — but a machine that develops Rigline should have it.

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
  branch into something a rewrite test can observe.
- **`preparePayload`** writes exactly what a real injector would leave on disk: `pre.js` and
  `post.js` copied from the host build, `generated.js` harvested fresh from the corpus version, a
  `registry.js` baking whichever fixture plugins the test wants, and each plugin's source as a
  module string.
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

**Rebuild the host before running these.** `preparePayload` copies
`packages/host/dist/{pre,post}.js`, so vitest alone exercises whatever was last built. A change to
the host with no `pnpm build` gives you a green run against the previous payload, or a failure you
then debug in code that is not running.

A file skips, with a reason, when the corpus lacks its version or Chromium will not launch — and the
reason says which.

## Tier 3: the probe, in the real extension

`plugins/probe` is a first-party plugin whose job is to prove the plugin machinery works end to end
in the actual panel. It is the only tier that exercises the real extension host, the real CSP, the
real React build and the real install.

Its checks are **contributed by the capability modules**, not listed centrally, so a new capability
brings its own check the way it brings its own contract. Everything it can reach through `ctx` it
reaches through `ctx`, exactly as a third-party plugin would — which is what makes an all-green
badge evidence rather than self-assessment. The one exception is `globalThis.__rigline.diagnostics`,
read directly and by nothing else: this plugin exists to diagnose the host, and pre/post timing, raw
tap counts and every plugin's load status are not capabilities a manifest could sanely declare.

Three verdicts, and **`n/a` is a real state**: a check that cannot apply on this surface, or has had
no opportunity yet, says so instead of guessing. Every verdict goes through one `report()` path, so
the badge's failing count and the panel's lines are built from the same map and cannot disagree.

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

## Choosing a tier

| the question | where it belongs |
| --- | --- |
| does this regex read a real bundle | corpus, tier 1 |
| does this regex handle *that* shape | synthetic fixture, tier 1 |
| do these bytes round-trip | tier 1, over a throwaway copy |
| does the compiler catch a wrong pair | the compile test |
| does this node land in the right place, survive a re-render, keep its order | the harness |
| what happens to a plugin the day an identifier goes | the harness, with `remove` |
| does it work in the actual extension | the probe, and only the probe |

When a tier cannot answer a question, say so rather than approximating it in a cheaper one. The
harness cannot tell you whether the real composer reflows around your decoration; the corpus cannot
tell you whether react-dom injected. Both of those are probe questions, and were found by the probe.
