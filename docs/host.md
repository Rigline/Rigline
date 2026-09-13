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
    webview/prototype/pre.js       the pre hook, one prebuilt file
    webview/prototype/post.js      the post hook, one prebuilt file
    webview/prototype/generated.js the identifier tables harvested from this directory's bundles
    webview/prototype/registry.js  the enabled plugins, their declarations, and patch outcomes
    webview/prototype/plugins/<name>/…   each enabled plugin's directory, tests excluded

The two lines:

    import"./prototype/pre.js";/*PROTOTYPE-PRE*/
    …the bundle, byte for byte…
    /*PROTOTYPE-POST*/import("./prototype/post.js").catch((e)=>console.error("[prototype] post-hook",e));

The static import at the head evaluates before the bundle body, which is the only way to wrap
`acquireVsCodeApi` before the app's single call to it. The dynamic import at the tail runs after
`createRoot().render()`, and its `catch` is what stops a post-hook failure reaching the app.
Neither line names anything from the bundle. Relative specifiers resolve against the bundle's own
resource URI, so `webview/prototype/` sits inside `localResourceRoots` without touching the host
bundle, and module scripts pass their nonce to what they import, which is what the CSP admits.

The backup file, never the marker comment, decides whether a bundle is patched (D38). Status
compares live bytes against the backup and answers `unknown` rather than guessing when there is no
backup. Restore copies backups back, removes `webview/prototype/`, and re-reads to confirm.

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
- Installs or chains the React devtools hook, records the renderer's version and its
  `findFiberByHostInstance`, and coalesces commit notices to one per animation frame.
- Publishes all of this on `globalThis.__prototype` as the bridge the post hook drives, with a
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

Per-plugin status is `loaded`, `refused`, `error` or `inactive`, each with a reason, on
`diagnostics.plugins` in registry order. Disabling a plugin at runtime runs every teardown it
registered and the one it returned.

The kernel knows no capability by name. It owns the plugin lifecycle, the shared mutation observer,
the mount arbitration (host-placed nodes ordered by registry order and stamped
`data-prototype-mount`), and the diagnostics object. Everything a plugin can do comes from a
capability module.

## The capability module contract

Two halves, in two packages, joined by a key.

**The contract** (plugin-api, `capabilities/<key>.ts`) is data and pure functions, usable in Node
and in the webview:

```ts
interface CapabilityContract<K extends UsesKey> {
  readonly key: K;
  /** The ctx methods this capability grants, for the drift scan and for documentation. */
  readonly grants: readonly (keyof PluginContext)[];
  /** Validate the manifest's value for this key: shape only. A string is the reason it is malformed. */
  shape(value: unknown): string | null;
  /** The identifiers this declaration depends on, checked against the tables. A string is the first violation. */
  violation(declared: Uses[K], tables: IdentifierTables): string | null;
  /** One sentence per thing granted, for the install-time permission summary. */
  summary(declared: Uses[K]): readonly string[];
}
```

`capabilityViolation(uses, tables)` walks every contract; it is what the update flow asks before
injecting and what the kernel asks before importing, so the two cannot disagree.

**The module** (host, `capabilities/<key>.ts`) is the runtime half:

```ts
interface CapabilityModule<K extends UsesKey> {
  readonly contract: CapabilityContract<K>;
  /** The slice of ctx for one plugin, or the methods that throw when the plugin did not declare the key. */
  grant(plugin: PluginRecord, kernel: Kernel): Partial<PluginContext>;
  /** Checks the probe runs for this capability, contributed rather than listed elsewhere. */
  readonly probes?: readonly ProbeCheck[];
}
```

`Kernel` is what a module may use: the bridge's bus and react halves, the tables, `mount` and
`place`, `disable(reason)` for the plugin in hand, and the plugin's registry order. Modules do
not import each other; a capability that needs another's state (the transcript needs the session)
asks the kernel for a shared service the kernel owns.

### Initial capabilities

| key | manifest value | grants | expands to |
| --- | --- | --- | --- |
| `anchors` | `AnchorName[]` | `anchor(name)` | the anchor table's classes |
| `classes` | `{ [module]: local[] }` | `cls(module, local)` | those classes |
| `messages` | `MessageType[]` | `onMessage(type, handler)` | those message types |
| `rewrites` | `{ [type]: field[] }` | `rewrite(type, transform)`, `resend(type)` | those outbound fields |
| `mount` | `true` | `mount`, `mountAfter`, `watch` | nothing |
| `style` | `true` | `style(css)` | nothing |
| `tools` | `true` | `onToolUse(handler)` | `io_message` |
| `session` | `true` | `onSessionId(handler)` | `update_session_state` |
| `transcript` | `true` | `decorateTranscript(build)` | `get_session_response`, `io_message`, anchor `transcriptRow` |

`surface` is on every `ctx` without a declaration: it is a string, and knowing which surface you
are on grants nothing.

`watch(anchor, onFound)`: the host calls `onFound(element)` when an element for the anchor is
present and again whenever the element it last handed over leaves the document and a new one
appears, returning that call's teardown before the next; the plugin polls nothing. It is built on
the same mutation observer as mount re-placement.

`style(css)`: a host-managed `<style>` element, removed on teardown, its text checked by the
install-time scan for a raw six-character hash outside a resolved class (advisory).

`rewrite` and `resend` together, for anything the app sends at boot: `rename_tab` fires from a
reactive effect at session creation, before any dynamically imported plugin can have registered a
rewriter, so a rewrite of an early message type always misses the first sends (`missed` in the
rewrite log says how many). `resend(type)` is therefore the normal pattern for such a type, not a
fallback: register the rewrite, and once the app has sent the type, resend it. The app answers a
resent request's fresh id with a console warning that no handler matched, and drops it; nothing
else happens.

## The manifest, `prototype.json`

```json
{
  "$schema": "node_modules/@prototype/plugin-api/schema/manifest.json",
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
export const plugins = [
  { name, entry: "./plugins/<name>/<entry>", surfaces, uses, patchRefusal: null | "reason" },
];
export const patches = [{ plugin, why, required, applied, reason? }];
```

Registry order is discovery order: the configured plugin directories in order, each `readdirSync`
sorted, with the probe last. It is the order mounts sharing an anchor appear in and the order
rewriters compose in.

## Diagnostics

`globalThis.__prototype.diagnostics` carries what the probe reports: timing of the two hooks, whether
the wrapper was installed and called, inbound and outbound counts, buffer size and sealed state,
clone counts and the worst clone by type, resend count, the per-plugin status list, the rewrite
log (plugin, type, fields, ran, applied, missed), the recorded patch outcomes, the version the
tables were harvested from, the React hook state and commit and notice counts, and the transcript
sweep counters. It is read by the probe and by nothing a plugin can declare.

## Verification

Node tests, against throwaway copies and the corpus: the injector (byte delta, contiguous original,
CRLF preserved, backup authority, every-version behaviour, host patches rebuilt from backup and
written only on change, restore round-trip, status verdicts); discovery and registry baking; the
built `pre.js` against a stubbed `acquireVsCodeApi` (immutability, unwrapping, buffer, chain,
resend, counts); every contract's `violation` and `summary`.

The probe plugin, live: one check per capability, contributed by its module, plus the kernel's
own; `n/a` where a check cannot apply on a surface; the `GRO` badge green or red with a count.
Leo reloads webviews and reads the badge on the full editor, the sidebar and the session list.

The Playwright spike, if it boots the real bundle: a third tier for host and plugin DOM behaviour
that needs no VS Code.
