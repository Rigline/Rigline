# @prototype/harness

The third verification tier docs/host.md names: host and plugin DOM behaviour tested against the
**real** webview bundle from the corpus, headless, in Vitest, with Playwright driving Chromium. No
VS Code, and nothing here ever reads from or writes to a live extension directory — the bundle
always comes from the pinned corpus snapshot at `c:\dev\kb\vscode-claude-code-versions`.

Three pieces:

- `src/page.ts`: the fixture HTML — the extension's own webview template (root div, the three
  `IS_*` globals, a nonce'd CSP, `acquireVsCodeApi` defined before the module script) plus a
  scripted fake host standing in for the real extension. `window.__harness = { sent, push }` lets
  a test read every outbound message and push an inbound one.
- `src/server.ts`: `startHarness()`, a `node:http` server on an ephemeral port serving the fixture
  page, the bundle's own CSS untouched, the bundle wrapped in the two lines the injector adds
  (`import"./prototype/pre.js"...` / `...import("./prototype/post.js")...`), and the payload directory
  under `/prototype/`.
- `src/payload.ts`: `preparePayload()`, which writes pre.js and post.js from the host build,
  `generated.js` harvested fresh from one corpus version, and a `registry.js` baking whichever
  fixture plugins one test wants active — plain JS strings, no build step.

## Running it

```
pnpm vitest run packages/harness
```

Skips with a reason, rather than failing, when the corpus snapshot (`2.1.270` by default) or a
launchable Chromium is absent — a fresh clone with neither still passes. Chromium is a project
devDependency; after `pnpm install`, run once:

```
pnpm --filter @prototype/harness exec playwright install chromium
```

`test/kernel.test.ts` boots the real bundle once per test (each with only the fixture plugins that
test needs, so a plugin deliberately made to fail cannot leak its expected `console.error` into an
unrelated assertion) and checks: the pre/post hooks wire up and `__prototype.diagnostics` reports a
clean boot; a mount lands after its anchor, attributed and ordered; an undeclared anchor use
disables just that plugin, not a sibling's mount; a plugin naming a gone identifier is refused
before it is ever imported; transcript rows pick up a real time once pushed `io_message`s land; and
an outbound `rename_tab` carries a plugin's rewrite.

## Adding a reply for a new request type

`src/page.ts`'s `replyTable` is a plain map from a request's inner `type` to a response builder,
seeded with the boot floor every surface needs. If a test's plugin triggers a request type nothing
answers yet, the fake host logs `console.warn("[harness host] no scripted reply, sending {} for", ...)`
and continues with `{}` — read that warning (or the actual field the webview's console error names)
and add an entry, the same way docs/spikes/playwright-harness.md's original spike found each of the
ten it needed: read the console message, grep the bundle for the field it dereferenced, add the
smallest reply that satisfies it. Do not guess a full reply shape up front.

## The two traps

Carried over from the spike, because they are still the two places `{}` is not good enough:

- `init`'s `state.authStatus` must be **non-null** (any object passes), never `undefined` — the
  app's own fallback collapses "no answer" to the same `null` a real unauthenticated state would
  send, and the login screen renders instead of the composer.
- `init`'s `state.experimentGates` must be **present as an object** — every flag read is
  `state.experimentGates.<flag>` with the optional chain placed one level too high to protect the
  flag lookup itself, so a missing object throws the moment any component reads a flag.

A third, found while wiring `rename_tab` for this harness: the connection's reactive `config` value
(which gates whether `renameTab()` actually posts anything) is fed entirely from **`init`'s**
`state`, not from `get_claude_state`'s own `config` field — the two are separate reactive values
fed by different requests, the same distinction the spike already drew for `authStatus` and
`experimentGates`.
