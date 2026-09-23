# Architecture: what runs where, and the seams between

The map of the system, for somebody about to change part of it. [plan.md](plan.md) says what is
being built and in what order; [decisions.md](decisions.md) says why the shape is this shape; this
says where things are and what may talk to what. The five other topic docs go a level down:
[identifiers.md](identifiers.md), [bus.md](bus.md), [patches.md](patches.md),
[transcript.md](transcript.md), [verification.md](verification.md). [host.md](host.md) is the
injected runtime in detail, and [companion.md](companion.md) the VS Code extension.

## Two machines, one channel

Everything here happens in one of two places, and the split is not organisational — it is forced.
The webview's CSP is `default-src 'none'` with no `connect-src`, so nothing running in the panel can
read a file, fetch, or ask anybody a question. Whatever the panel needs to know, some Node process
has to have written down beforehand.

**Node, at install time.** Locate the installed extension directories, read their bundles, harvest
the identifiers, resolve the anchor table against them, discover plugins, apply host patches, and
write the loader and its data beside the bundle. This is `@rigline/core`, with `rigline` as a thin
command surface over it.

**The webview, at boot.** Two injected lines load a pre hook and a post hook. The pre hook wraps the
bus before the app touches it; the post hook reads the data Node left, builds a `ctx` per plugin and
loads them. This is `@rigline/host`, built to the two hook files and, beside them, the runtime
modules plugins import: one React for every plugin (D87).

The channel between them is a directory of files, and nothing else. There is no protocol, no
handshake, and no way for the panel to ask a follow-up question:

    webview/rigline/generated.js   the identifier tables harvested from this directory's bundle
    webview/rigline/registry.js    the enabled plugins, their declarations, and patch outcomes
    webview/rigline/plugins/<name>/  each enabled plugin's directory

Two consequences run through everything. **The payload is version-independent** (P7): `pre.js` and
`post.js` name no harvested identifier, so one build of them serves every installed version, and
everything version-specific is data in `generated.js` written per extension directory. And **a fact
Node has and does not write down is a fact the panel cannot have** — which is why the outcome of
each host patch is carried into `registry.js` rather than derived: nothing in a webview can read
`extension.js`.

## Packages

| path | package | what it is |
| --- | --- | --- |
| `packages/plugin-api` | `@rigline/plugin-api` | The shared vocabulary: `PluginContext`, the manifest type and its JSON schema, the anchor names and specs, the capability *contracts*, and the pure derivations (session rule, stream shape, transcript join). Pure data and pure functions, so both machines import it. Its `/ui` subpath is the React half, which the panel serves and core never imports (D87). |
| `packages/core` | `@rigline/core` | The engine. Node: locate, harvest, codegen, inject, restore, discover, bake, the install flow, the anchor table, the plugin manager, and every command but `update`, behind the bin `rigline-engine`. Also ships the assets — see below. |
| `packages/cli` | `rigline` | The retrieval layer (D69). It installs the engine under `~/.rigline/engine`, spawns it, owns `update` and the remote half of `add`, and forwards the rest. Depends on no Rigline package. |
| `packages/host` | `@rigline/host` (private) | The injected runtime: `pre.js`, `post.js`, and `runtime/` (D87). |
| `packages/create-plugin` | `create-rigline-plugin` | The scaffold, as real files under `template/`. |
| `packages/vscode` | `@rigline/vscode` (private) | The companion extension: a second retrieval layer that acquires the engine and spawns it when an extension update lands (D80). Built to `rigline.vsix`. |
| `packages/harness` | (private) | Playwright over the real bundle. See [verification.md](verification.md). |
| `plugins/*` | first-party plugins | `session-id`, `worktree-prefix`, `time-marks`, `probe`. |

**Core carries the assets, in `dist/bundled/`** (D71): `pre.js`, `post.js`, `runtime/`, and each
first-party plugin's `rigline.json` and built entry. `@rigline/host` is private and `plugins/*` are not
published, so without this nothing a person installs holds the thing that gets injected — which is
what `rigline install` threw `payload is missing pre.js` over. Core rather than the wrapper, because
core is what injects and what discovers. The companion's `rigline.vsix` ships there too, so
`rigline vscode-setup` installs the companion the engine was built with and fetches nothing.

The copy is a workspace step, `scripts/bundle-assets.mjs`, run by the root `build` after `pnpm -r
build`: the plugins are built by `rigline-engine build`, which is core's own bin, so a build-order
edge from core to the plugins would be a cycle. `bundledDir()` in
[assets.ts](../packages/core/src/assets.ts) resolves it — by walking up to core's own
`package.json`, which is one answer under vitest's alias, in `dist`, and in `node_modules` — and
refuses a bundle older than the builds it was copied from.

`plugin-api` is the load-bearing one, and the rule that keeps it honest is that it may import
nothing from core or host and its root must run in both — which is why the React half is a subpath
that the root never imports. A capability's *contract* lives there — the manifest
shape, what it depends on, what it says about itself — and its *grant* lives in host. That is what
lets `rigline install` and the kernel ask the same question of a manifest and be unable to disagree:
both call `capabilityViolation(uses, tables)`, from `plugin-api`.

## The three registries

Three kinds of thing get added over the life of this project, and each has a registry so that adding
one is a module or a table row rather than an edit in five places.

**Identifier layers**, in `core/src/layers/`. A layer is one place in the extension plugins may
depend on, plus the harvest that reads it out of a bundle. `LAYERS` in `layers/index.ts` is the one
list; codegen, the stability diff and the install gate all iterate it. Adding a layer is a module
implementing `Layer` plus an entry there and a field on `Harvest`. See
[identifiers.md](identifiers.md).

**Capabilities**, split across three packages by what each half needs. The contract
(`plugin-api/src/capabilities/<key>.ts`) is data and pure functions: the manifest key, its schema
fragment, its shape check, the identifiers it expands to, and the sentences `describeUses` prints.
The module (`host/src/capabilities/<key>.ts`) is the runtime grant. Core needs neither — it asks the
contracts. The kernel knows no capability by name: it builds a `ctx` by asking every module in
`MODULES` for its slice. See [host.md](host.md) for the contract in full.

**Anchors**, in `core/src/anchors/`, with the names flowing to plugin-api so a manifest and a
`ctx.anchor()` call are typed. The table maps a stable name to a module-scoped class plus what tells
that class's element apart from anything else wearing it; resolution happens per extension directory
at install time and the answer is written into `generated.js` as data. See [anchors.md](anchors.md),
which is written for a user repairing one, and D7 for why an anchor resolves to a *selector* and not
to a class.

## The install pipeline

`rigline install` is the one write command about the injection, and `check` is the same report
writing nothing (D55). The flow in `core/src/update/flow.ts` runs over every installed extension
directory; per directory, `inject.ts`'s `install()` does this, in this order, and the order is
load-bearing at three points:

0. **Refuse a directory that is not whole**: a file missing, or one still growing between two
   samples a quarter of a second apart (D81, D83). See [partial-bundles.md](partial-bundles.md).
1. **Settle the webview backup.** `index.js.orig` is the authority on whether a bundle is patched
   (D38), and everything downstream harvests from it, so it is made trustworthy first: no backup
   means the live bytes become one; live equal to the backup, or equal to this loader's own patch
   over it, means nothing to do; the backup appearing *inside* the live bytes with some other head
   or tail means a patch this installer did not write, rolled back; no relation at all means the
   extension was replaced in place and the live bytes are the new baseline.
2. **Write the payload before the bundle is patched.** A static import pointing at a file that is
   not there yet blanks the panel on the next reload. Superseded payload directory names are removed
   here too — an orphaned one is not inert, because a webview opened before the rollback goes on
   running a whole second loader generation until the window reloads.
3. Harvest the bundles, generate, and write `generated.js` — the merged anchor table, so a local
   override reaches the loader and not just the report about it (D44).
4. Discover plugins, read `config.json`, and take the enabled set.
5. Rebuild `extension.js` from `extension.js.orig` plus every enabled plugin's declared patches, and
   write it only if the bytes changed. See [patches.md](patches.md).
6. Copy each enabled plugin's directory through the output filter, and bake `registry.js`.
7. Check every enabled plugin's declarations against this version's tables and report by identifier
   (D43). This changes nothing — a refused plugin is still copied and still baked, and the kernel
   refuses it at load exactly as it would have. Enforcement stays in one place.
8. **Only now** decide whether the two-line patch needs writing at all. After step 1 the live bytes
   are in exactly one of two shapes, so a rebuild-and-reinstall — the whole development loop —
   rewrites nothing.

A plugin's problem never blocks any of this (D27). Two things do: a harvest under its own floor,
which means our regex has drifted rather than that the extension has, and a failure in Rigline's own
build.

`restore` is the inverse and the recovery path: copy both backups back, re-read to confirm the bytes
match, remove the payload directory. It needs only Node and the engine — not VS Code, and not a
working extension.

## The update pipeline

`rigline update` is the wrapper's (D69), and its order is the engine first, so the new engine does
the placing and the injecting:

1. Resolve `@rigline/core`'s tag and install it into `<RIGLINE_HOME>/engine` only if the version
   differs. The release-age gate applies unless no engine is installed yet (D48), and a failed
   resolution is reported while the run carries on with the engine it has.
2. Resolve each recorded plugin source, and fetch, vet and stage the ones that moved; the engine
   `add`s each, which re-injects (D70).
3. If the engine moved, run one `install`, or the payload on disk stays the previous engine's (D75).

The companion does step 1 and then an `install` on every activation and every arriving Claude Code
version ([companion.md](companion.md)).

## The boot pipeline

    import"./rigline/pre.js";/*RIGLINE-PRE*/
    …the extension's bundle, byte for byte…
    /*RIGLINE-POST*/import("./rigline/post.js").catch(…);

The static import evaluates before the bundle body, which is the only moment at which
`acquireVsCodeApi` and the React devtools hook can still be wrapped — the app calls the first
exactly once at boot, and react-dom looks for the second when it initialises. The dynamic import at
the tail runs after `createRoot().render()`, and its `catch` is what stops a post-hook failure
reaching the app.

So `pre.js` is the file that may never throw: every statement is inside one `try`, and no code from
outside it is reachable. Plugins load in `post.js`, dynamically, each in its own try/catch. That
split is the whole of D2, and it is why a plugin can be arbitrarily broken without blanking a panel.

`post.js` imports `generated.js` and `registry.js`, builds the kernel services, and walks the
registry in order: patch verdict, declaration check, surface check, dynamic import, `ctx` from the
capability modules, `setup()`. Then it seals the replay buffer in a `finally`. [host.md](host.md)
has the step list and the diagnostics the probe reads.

## Failure isolation, by layer

Each layer catches what the one below it can do, and the property is structural rather than a
promise:

- A **plugin** that throws in `setup`, in a handler, or on import is disabled by name, its teardowns
  run, and every other plugin loads (P3).
- A **capability** a plugin did not declare throws when called, which disables that plugin.
- The **post hook** as a whole is behind the injected `.catch()`, so the app boots without plugins.
- The **pre hook** cannot fail, by construction.
- The **injection** is reversible from the backups, without VS Code.
- A **host patch** that does not locate cleanly is refused rather than guessed at, and only a
  *required* one refuses its plugin.

## Where state lives

**In the repo**, `generated.ts` at the workspace root: our own harvest, committed as the baseline
the first-party plugins compile against and the install flow diffs the next version against (D29,
D40). At the root rather than inside a package, so that keeping a harvest out of the published
package is a property of the layout, and so one file serves every plugin in the workspace the way
the template needs (D50). It imports nothing.

**On a user's machine**, under `~/.rigline/`: `config.json` (enabled plugins, per-plugin settings,
and the `sources` record `update` reads — all of it the engine's to write, never the wrapper's,
D74), `plugins/` (installed third-party plugins), `anchors.json` (local overrides and additions to
the anchor table), `baseline.json` (the last harvest), and `engine/` (the npm prefix the wrapper
installs `@rigline/core` into, D73 — the one directory here that `rm -rf` is the documented repair
for), and `.lock`, held while an engine installs so the CLI and the companion cannot install over
each other. A clone of this repo is for developing Rigline, not for using it.

**In the extension directory**, everything under `webview/rigline/` plus the two `.orig` backups.
All of it is derived and all of it is disposable — except the backups, which are the only recovery
from a blank panel or a broken extension host. `registry.js` also carries the engine version that
wrote it (D75), which is the one thing there that is not derivable from the directory: without it a
payload three releases old is indistinguishable from the one this engine would write, and after an
upgrade that is exactly the question.

**Discovery roots**, in precedence and load order (D56, D71): this checkout's `plugins/` when the
engine is running from it, then `~/.rigline/plugins`, then core's `dist/bundled/plugins`. The user's
directory outranks the bundled set, so a fork installed over a bundled name wins — the escape hatch
that repairs a broken first-party plugin without waiting for a release. A bundled plugin cannot be
removed, only switched off, which is what `rigline disable` is for (D72).

## What a change costs to see

Three different reloads, and picking the wrong one is the commonest way to debug code that is not
running:

| changed | what it takes |
| --- | --- |
| a plugin, or `pre.js`/`post.js` | `rigline install`, then **Developer: Reload Webviews** — current window only, and it ends the in-flight turn of any Claude session in it |
| `extension.js`, via a host patch | **Developer: Reload Window** |
| the extension itself updated | a new versioned directory, so the injection is gone: `rigline install` again |

The harness is the way to avoid the reload loop for anything it can answer; see
[verification.md](verification.md).
