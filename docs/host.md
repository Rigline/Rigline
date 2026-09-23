# The host: loader, kernel, capabilities, manifest

The design for phase 2 of [plan.md](plan.md), and afterwards the reference for how the injected
runtime works. Decisions it rests on are in [decisions.md](decisions.md); this document is the
shape, not the argument.

## What the injector leaves on disk

For every installed extension directory `anthropic.claude-code-<version>-<platform>/`:

    webview/index.js            the app bundle, with two lines added
    webview/index.js.orig       the app bundle as the extension shipped it
    extension.js                the host bundle, rebuilt from its backup plus declared patches
    extension.js.orig           only once any enabled plugin declares a patch
    webview/rigline/pre.js       the pre hook, one prebuilt file
    webview/rigline/post.js      the post hook, one prebuilt file
    webview/rigline/runtime/     the modules plugins import — react, its JSX runtime, react-dom,
                                 and @rigline/plugin-api/ui (D87) — and shell.js (D88)
    webview/rigline/generated.js the identifier tables harvested from this directory's bundles
    webview/rigline/registry.js  the enabled plugins, their declarations, and patch outcomes
    webview/rigline/plugins/<name>/…   each enabled plugin's directory, tests excluded, its entry's
                                       runtime imports pointed at runtime/

The two lines:

    import"./rigline/pre.js";/*RIGLINE-PRE*/
    …the bundle, byte for byte…
    /*RIGLINE-POST*/import("./rigline/post.js").catch((e)=>console.error("[rigline] post-hook",e));

The static import at the head evaluates before the bundle body, which is the only way to wrap
`acquireVsCodeApi` before the app's single call to it. The dynamic import at the tail runs after
`createRoot().render()`, and its `catch` is what stops a post-hook failure reaching the app.
Neither line names anything from the bundle. Relative specifiers resolve against the bundle's own
resource URI, so `webview/rigline/` sits inside `localResourceRoots` without touching the host
bundle, and module scripts pass their nonce to what they import, which is what the CSP admits.

The backup file, never the marker comment, decides whether a bundle is patched (D38). Status
compares live bytes against the backup and answers `unknown` rather than guessing when there is no
backup. Restore copies backups back, removes `webview/rigline/`, and re-reads to confirm.

## pre.js

Statically imported, so nothing in it may throw: every statement is inside one `try`, and no code
from outside this file is reachable. It is version-independent by construction: it names no
harvested identifier and reads no generated table. What it does:

- Wraps `acquireVsCodeApi`, caching the single real call, and installs itself as the one egress.
- Taps both directions. Outbound: the wrapped `postMessage`. Inbound: a `message` listener
  registered at static-import time, so it precedes the app's own. Each message is recorded under
  its outer type and, for `request` and `response` envelopes, under the inner type as well, so a
  tap on `rename_tab` sees the request payload and a tap on `request` sees every envelope.
  `io_message` is never unwrapped: it carries a protocol nested inside ours.
- Buffers from boot for replay to read taps that register late, and seals the buffer when the post
  hook reports plugin loading complete (D3). Live delivery clones once per message for all taps and
  deep-freezes the clone; replay clones per late tap. A message that cannot be cloned is skipped
  for taps and still delivered to the app.
- Runs the outbound rewrite chain: per message type, in registration order, each rewriter given a
  frozen view with earlier patches applied, returning a patch or nothing; the result is a copy,
  never an edit of the app's object; the app's message goes to the extension host whatever a
  rewriter does (D20). Keeps the app's last original message per outbound type for `resend`, mints
  a fresh request id for it, and refuses a resend while the chain is running.
- Counts outbound sends per type at the egress, so a rewriter registering late can be told how many
  it missed.
- Installs or chains the React devtools hook, and coalesces the app's commit notices to one per
  animation frame. The first renderer to inject is the app's, since react-dom initialises in the
  bundle body before `post.js` can load another: its version and `findFiberByHostInstance` are kept,
  and a later renderer — a plugin's own React, or Rigline's — is counted in
  `diagnostics.react.foreign` and otherwise ignored.
- Publishes all of this on `globalThis.__rigline` as the bridge the post hook drives, with a
  `diagnostics` object the probe reads. The bridge is host-internal; no plugin sees it.

## post.js: the kernel

Dynamically imported after boot. In order:

1. Import `./generated.js`. If that fails, load nothing and say why: empty tables would refuse
   every plugin naming an identifier that has not gone.
2. Import `./registry.js`. Publish the recorded patch outcomes to diagnostics.
3. For each registry entry, in registry order:
   a. If the injector recorded a required patch as not applied, refuse with that reason.
   b. Check the manifest's `uses` against the tables through the capability contracts (below).
      A violation refuses the plugin by name with the specific identifier and never imports it.
   c. Check `surfaces` against the current surface; a plugin not for this surface is skipped
      with status `inactive`, which is not a failure.
   d. Dynamically import the entry in its own try/catch.
   e. Build the plugin's `ctx` by asking every capability module for its slice, each scoped to
      what this plugin declared. A method the plugin did not declare for throws when called, and
      the throw disables the plugin.
   f. Call `setup(ctx)` in its own try/catch; keep its teardown.
4. Seal the replay buffer, in a `finally`.
5. Start the shell (D88): place the RIG pill beside the footer spacer, or in a corner where there is
   none; start the once-a-second check run that sets its failing count; and import
   `runtime/shell.js`, the React root that draws the pill and the menu. Failing to load it is an
   error in `diagnostics.errors` and costs the menu, never a plugin.

## The shell

Rigline's one React root, built with the runtime so it shares React and `@rigline/plugin-api/ui`
with every plugin it renders (D87, D88). It renders into a container on `body` and portals only the
pill into the host-placed node beside the spacer. The menu stays out of the footer, which
re-measures on any mutation inside it (D54).

The menu itself is `@rigline/plugin-api/ui`'s, not the shell's: the panel, its levels and its keys
live beside the components plugins build entries from, because those components read a context the
panel provides, and a context is shared only by code importing the same module instance. The shell
takes the panel from `@rigline/plugin-api/ui/internal`, which is in the runtime build's shared
chunks and not in `RUNTIME_MODULES`. The runtime build resolves plugin-api through its `exports`
with tsconfig off, for the same reason: `paths` would give the shell the source and the served
entries the build, and two copies of the context mean every plugin's `MenuItem` throws.

Each contribution renders, grouped by plugin in registry order with a divider between plugins
(D89), inside an error boundary that disables its plugin through the plugin's own error path; the
root's `onCaughtError` is silenced because that path already logs it, attributed. Contributions
mount when the menu opens and unmount when it closes. A submenu portals its level into the panel and
only the top level shows, so the levels beneath keep their state. The panel listens for keys on
`window`, in capture, and stops the ones it takes, so the app's own `document` listeners never see
an Escape that closed the menu.

Per-plugin status is `loaded`, `refused`, `error` or `inactive`, each with a reason, on
`diagnostics.plugins` in registry order. Disabling a plugin at runtime runs every teardown it
registered and the one it returned.

The kernel knows no capability by name. It owns the plugin lifecycle, the per-React-commit pass
that re-places mounts and re-anchors watches (D52), the mount arbitration (host-placed nodes ordered
by registry order and stamped `data-rigline-mount`), and the diagnostics object. Everything a plugin can do comes from a
capability module.

## The capability module contract

Two halves, in two packages, joined by a key.

**The contract** (plugin-api, `capabilities/<key>.ts`) is data and pure functions, usable in Node
and in the webview:

```ts
interface CapabilityContract<K extends UsesKey> {
  readonly key: K;
  /** The ctx members this capability grants, for the advisory source scan and for documentation. */
  readonly grants: readonly string[];
  /** This key's fragment of the manifest JSON schema, so an editor validates before anything runs. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** Validate the manifest's value for this key: shape only. A string is the reason it is malformed. */
  shape(value: unknown): string | null;
  /** Every identifier this declaration depends on that the tables lack, one reason each. */
  gaps(declared: Declarations[K], tables: IdentifierTables): readonly string[];
  /** One line per thing the declaration lets the plugin do, for `describeUses`. */
  summary(declared: Declarations[K]): readonly string[];
}
```

`gaps` returns a list rather than the first answer because both verdicts read it. A required
declaration is refused on the first gap — the name is what makes a refusal attributable, and a
module that has gone loses every class in it at once — while an optional one is reported on all
of them, since each is a decoration the plugin will go without and the author is owed the whole
list (D41). `schema` states the same rule `shape` enforces, in the one language editors read;
neither can be derived from the other, so a test holds them together.

`capabilityViolation(uses, tables)` walks every contract; it is what the update flow asks before
injecting and what the kernel asks before importing, so the two cannot disagree.

**The module** (host, `capabilities/<key>.ts`) is the runtime half:

```ts
interface CapabilityModule<K extends UsesKey> {
  readonly contract: CapabilityContract<K>;
  /** The slice of ctx for one plugin, or the methods that throw when the plugin did not declare the key. */
  grant(grant: Grant): Partial<PluginContext>;
  /** The slice of ctx.optional, for the lookups that may answer null (D41). */
  grantOptional?(grant: Grant): Partial<OptionalContext>;
  /** The lines this capability contributes to `core`, registered once at boot (D63). */
  checks?(kernel: Kernel): readonly Check[];
}
```

`Grant` is what a module is handed for one plugin: its `PluginRecord` (name, entry, surfaces,
`uses`, patch verdict, registry order), the `Kernel`, `own(teardown)` to register what the disable
path must undo, `disable(reason)` for the plugin in hand, and `guard(what, fn)` to wrap a plugin
callback so a throw disables rather than escapes.

`grantOptional` is a second method rather than a nested key in `grant`'s return, so the kernel's
merge stays a flat `Object.assign` and one capability's slice cannot clobber another's. Only the
two lookup-shaped capabilities implement it: everything else optional needs no API, because a
handler that never fires is already what absence does.

`Kernel` is what a module may reach through: the bridge's bus and react halves, the tables, the
surface, the diagnostics, the registry as the injector baked it, and the shared services — mounts,
session, tools, transcript, checks. Modules do not import each other; a capability that needs
another's state (the transcript needs the session) asks the kernel for a shared service the kernel
owns.

`checks` is called once per module, before any plugin loads, so `core` is the first contributor in
the panel. A module is handed the `Kernel` because a module's check is a reading of state it already
owns — where a plugin's check is handed nothing (D63). Two of the three switch modules read
`kernel.plugins` first, through `usedOnSurface`: a capability nothing on this surface declared
reports `n/a` and why, and the tap such a check would need is never installed for a panel that was
not going to install it anyway.

### Initial capabilities

| key | manifest value | grants | expands to |
| --- | --- | --- | --- |
| `anchors` | `AnchorName[]` | `anchor(name)` | the anchor table's classes |
| `classes` | `{ [module]: local[] }` | `cls(module, local)` | those classes |
| `messages` | `MessageType[]` | `onMessage(type, handler)` | those message types |
| `rewrites` | `{ [type]: field[] }` | `rewrite(type, transform)`, `resend(type)` | those outbound fields |
| `mount` | `true` | `mount`, `mountAfter`, `mountBefore`, `watch` | nothing |
| `style` | `true` | `style(css)` | nothing |
| `tools` | `true` | `onToolUse(handler)` | `io_message` |
| `session` | `true` | `onSessionId(handler)` | `update_session_state` |
| `transcript` | `true` | `decorateTranscript(build)` | `get_session_response`, `io_message`, anchor `transcriptRow` |
| `menu` | `true` | `menu(Component)` | nothing |

`decorateTranscript` registers nothing on a surface where `transcriptRow` is measured as not
rendering, the same reading `watch` makes of its own anchor (D68). Not merely tidy: the sweep runs on
the React commit signal, so a decorator registered where no row can exist queries for one per commit
for the life of the window. A missing React renderer is the other case and still throws, because
that one is a fault.

`surface` and `check` are on every `ctx` without a declaration. `surface` is a string, and knowing
which one you are on grants nothing; `check(name, run)` hands the host a function and takes nothing
back, so there is no identifier for a manifest to name and no gap a declaration could report (D63).
The rule both rest on, and that a third undeclared member would have to satisfy: **an undeclared
member may not widen what a plugin can reach.**

`watch(anchor, onFound)`: the host calls `onFound(element)` when an element for the anchor is
present and again whenever the element it last handed over leaves the document and a new one
appears, returning that call's teardown before the next; the plugin polls nothing. It runs on the
same per-React-commit pass as mount re-placement (D52), not on a mutation observer.

It watches nothing, cleanly, in two cases that are the same answer to the plugin — there is nothing
to mount on. An optional anchor this *extension* has not got (D41), and an anchor the table records
as not rendering on this *surface* (D68). The second reads `ANCHORS[name].surfaces` and acts only
when it is present, because absent means *not yet measured* and half the table is still absent. A
plugin that has no work at all on a surface says so with `surfaces` in its manifest instead, and is
skipped as `inactive`.

`mount`, `mountAfter`, `mountBefore`: inside the target, immediately after a sibling, immediately
before one. Mounts sharing an anchor are ordered by the host in registry order, which for both
sibling placements reads left to right — so the *highest* order ends up nearest a `before` anchor.
Choosing between them is not only about where a decoration looks right: a container whose owner
measures its element children makes every child part of that owner's layout decision, and a
decoration that enters and leaves such a container fights the measurement it is part of. The
composer footer is one, which is what `footerSpacer` and `mountBefore` exist for (D54).

Both re-placement and re-anchoring stop after a bounded run of corrections that never settles. The
mount or the watch is abandoned by name in `diagnostics.mounts.abandoned`, its node is removed, and
the plugin is disabled through its own error path — a decoration is never worth a panel flickering
at frame rate.

`style(css)`: a host-managed `<style>` element, removed on teardown, its text checked by the
install-time scan for a raw six-character hash outside a resolved class (advisory).

`rewrite` and `resend` together, for anything the app sends at boot: `rename_tab` fires from a
reactive effect at session creation, before any dynamically imported plugin can have registered a
rewriter, so a rewrite of an early message type always misses the first sends (`missed` in the
rewrite log says how many). `resend(type)` is therefore the normal pattern for such a type, not a
fallback: register the rewrite, and once the app has sent the type, resend it. The app answers a
resent request's fresh id with a console warning that no handler matched, and drops it; nothing
else happens.

## The manifest, `rigline.json`

```json
{
  "$schema": "node_modules/@rigline/plugin-api/schema/manifest.json",
  "api": 1,
  "name": "session-id",
  "description": "The panel's session id, beside the model pill.",
  "entry": "dist/index.js",
  "surfaces": ["editor", "sidebar"],
  "uses": {
    "anchors": ["modelPill", "footerMenuPopup"],
    "classes": {},
    "messages": ["io_message"],
    "rewrites": {},
    "mount": true,
    "style": true,
    "tools": false,
    "session": true,
    "transcript": false
  },
  "patches": [
    { "find": "…", "replace": "…", "why": "…", "required": false }
  ]
}
```

- `api` is `1` and is the version of this shape and of `ctx`; it moves only when the meaning of
  something existing changes, never for growth.
- `name` must match the plugin's directory name and be a valid npm package name segment.
- `entry` is relative to the manifest and must exist.
- `surfaces` is optional; absent means all three.
- `uses` holds every dependency; a key absent is the same as its empty value. Shape is validated
  by each contract; identifiers are validated against the installed tables.
- `patches` is validated for shape at read time (equal byte length, non-empty, `find !== replace`)
  and applied at install time (D25).

The manifest is read as data and never evaluated (D12, D14). Package metadata lives in
`package.json`.

## The registry, `registry.js`

Baked by the injector per extension directory:

```js
export const engine = "<the rigline version that wrote this>";
export const plugins = [
  { name, entry: "./plugins/<name>/<entry>", surfaces, uses, patchRefusal: null | "reason" },
];
export const patches = [{ plugin, why, required, applied, reason? }];
```

Registry order is discovery order: the configured plugin directories in order, each `readdirSync`
sorted, with the probe last. It is the order mounts sharing an anchor appear in and the order
rewriters compose in.

`engine` is the payload's stamp (D75), and it is here rather than in a file of its own because the
webview cannot fetch: anything the probe reads has to be a module the post hook already imports, and
this is the one `install` bakes. The kernel copies it onto `diagnostics.engine`, so a plugin reads
it the way it reads every other host-provided value and never imports the host (D18, D63). Node-side,
`parseRegistry` reads it back out with a bounded regex and `doctor` reports it against `CORE_VERSION`;
absent means a payload injected before the stamp existed, which is a fact about its age and never a
problem with the registry.

## Diagnostics

`globalThis.__rigline.diagnostics` carries what the probe reports: timing of the two hooks, whether
the wrapper was installed and called, inbound and outbound counts, buffer size and sealed state,
clone counts and the worst clone by type, resend count, the per-plugin status list, the rewrite
log (plugin, type, fields, ran, applied, missed), the recorded patch outcomes, the version the
tables were harvested from, the React hook state and commit and notice counts, the transcript
sweep counters, the mount counters, a per-second peak for every hot path (D53), and the storage
ring's own state. It is read by the probe and by nothing a plugin can declare.

Two of those are findings rather than numbers to weigh, and both are empty in the ordinary case.
`mounts.multiple` names an anchor declared to mean one element whose selector matched several, so a
decoration may be on the wrong control (D7). `mounts.abandoned` names a mount or a watch the host
gave up on, so a decoration is gone and the panel was flickering before it went (D54); the `rebind`
meter's peak is the early warning for the same condition.

## The check registry

Beside `diagnostics` on the bridge, and filled in by the kernel: `globalThis.__rigline.checks`, null
until the kernel has run and null forever if it never did. Beside rather than inside, because
`diagnostics` is data the recorder snapshots into the storage ring.

`add(contributor, name, run)` registers one line and returns its removal; `run()` executes every
registered check now and returns them grouped — `core` first, then each contributor in the order it
first appeared, which for plugins is registry order because setup runs in it (D66). Nothing sorts on
the verdicts: a list that reorders as they change slides a line out from under a pointer mid-click.

Three contributors, two paths. The kernel's own nine lines and each capability module's come through
`kernelChecks` and `CapabilityModule.checks`, and are handed the `Kernel`. A plugin's come through
`ctx.check`, and are handed nothing. The host runs them all the same way: a check that throws, or
returns something that is not a verdict, becomes one failing line naming its contributor, and
nothing else happens — no disable, and nothing in `diagnostics.errors`, which would count one fault
twice under the wrong layer's name (D65).

The cadence belongs to whoever renders. The probe asks once a second, for the life of the window,
because the badge's failing count is on screen whether or not the panel is open — which is what
makes *a check reads, it does not compute* a rule rather than a preference (D64).

## Verification

Node tests, against throwaway copies and the corpus: the injector (byte delta, contiguous original,
CRLF preserved, backup authority, every-version behaviour, host patches rebuilt from backup and
written only on change, restore round-trip, status verdicts); discovery and registry baking; the
built `pre.js` against a stubbed `acquireVsCodeApi` (immutability, unwrapping, buffer, chain,
resend, counts); every contract's `gaps` and `summary`.

The probe plugin, live: every contributor's lines under its own heading, `n/a` where a check cannot
apply on a surface, and the `RIG` badge green or red with the total count. Leo reloads webviews and
reads the badge on the full editor, the sidebar and the session list. The probe renders the registry
and contributes six of its own; the verdict logic behind `core` is unit-tested in
`packages/host/test/verdicts.test.ts` and the registry's own behaviour in `checks.test.ts` beside it,
because neither needs a browser to be argued about.

The Playwright spike, if it boots the real bundle: a third tier for host and plugin DOM behaviour
that needs no VS Code.
