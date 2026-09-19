# Rigline — agent notes

A plugin layer for the Claude Code VS Code extension: a loader injected into the installed
extension's webview bundle, a capability-scoped context plugins are written against, and the
tooling that keeps it working across the extension's roughly weekly updates. Built to be
community-maintained.

**Start with [docs/plan.md](docs/plan.md)** for where the work is and what comes next, and
[docs/decisions.md](docs/decisions.md) for the principles and decisions the architecture is derived
from. Update the plan before writing code; log status there, not here.

## Knowledge base

- [docs/plan.md](docs/plan.md): what Rigline is, the physics that shape it, the architecture,
  phases with acceptance criteria, status log.
- [docs/decisions.md](docs/decisions.md): principles P1 to P8 and decisions D1 to D58.

The internals, for a contributor to Rigline itself. The shape, not the argument — the argument is in
decisions.md, and each doc cites the decisions it rests on.

- [docs/architecture.md](docs/architecture.md): the map. What runs in Node and what in the webview,
  the one channel between them, the packages, the three registries, the install and boot pipelines,
  failure isolation, where state lives, which reload a change needs. Start here.
- [docs/identifiers.md](docs/identifiers.md): the layer contract, the five layers and what each
  anchors on, floors and views, the stability diff, codegen's two outputs, adding a layer.
- [docs/bus.md](docs/bus.md): the protocol's three shapes, the single egress, what a tap is handed,
  the replay buffer, the rewrite chain and its refusals, `resend`, the session and tool services.
- [docs/host.md](docs/host.md): the injected runtime — what lands on disk, `pre.js`, the `post.js`
  kernel, the capability module contract, the manifest, the registry, diagnostics.
- [docs/patches.md](docs/patches.md): byte substitutions in `extension.js` — why the capability
  exists, rebuild-from-backup, the three refusals, and how to write one.
- [docs/transcript.md](docs/transcript.md): the three-way join behind an entry, row identity through
  React, the sweep, and what a decoration must never do to a row.
- [docs/verification.md](docs/verification.md): the three tiers, the corpus, the harness, the probe,
  and which tier a question belongs to.
- [docs/releasing.md](docs/releasing.md): the four published packages, the stage-then-approve split,
  the one-time npm setup and why each step of it is a person's, and cutting a release.

Written for somebody else, so don't rewrite them for us:

- [docs/anchors.md](docs/anchors.md): what an anchor is, and repairing one through
  `~/.rigline/anchors.json` without waiting for a release. Written for a user.
- [docs/authoring.md](docs/authoring.md): writing, testing and shipping a plugin. Written for a
  plugin author; `packages/create-plugin/template/` is the scaffold it starts from.
- [docs/archive/0.x/](docs/archive/0.x/README.md): the 0.x prototype's design record and source
  inventories, the evidence behind the measurements the decisions cite. OCR-recovered; read its
  caveats before quoting a number or a regex from it.

## Rules that will cost you if you break them

- **Never name a minified JS identifier.** Bundler-generated, changes every build. Plugin-facing
  hooks come from harvested layers or the curated anchor table. Build-time harvesting may anchor on
  unminified property names only because codegen asserts every anchor and fails loudly.
- **Never put third-party code in the static import.** A throw there blanks the panel with no
  attribution. Plugins load after boot, dynamically, each in its own try/catch.
- **Look classes up module-scoped, and remember a class still is not an identity.** Local names are
  reused across modules, which is what module-scoping fixes. It does not fix the other half: one
  module-scoped class can be applied to several different controls, because a class names a look and
  sharing a look is what a style is for. `modelPill_gGYT1w` is on the model picker *and* the
  agent-map button, and resolving it to `[0]` put three decorations on the wrong one for an
  afternoon while every check reported green. Five of fifteen identity anchors have this property
  (D7). So an anchor resolves to a *selector* and the host queries with `querySelector`: never add a
  `kind: "singleton"` entry without checking what else wears its class, and never reach for a class
  where a selector is what you want.
- **Never decorate a container whose owner measures its children.** The composer footer sums the
  widths of its own element children to pick one of three fit stages and resets that measurement,
  through `flushSync`, on any foreign mutation inside it — so a decoration there is part of the
  layout decision *and* a trigger for it. Anchoring one to the model pill, which the widest stage
  moves out of the footer, oscillates at one cycle per frame and makes the composer unclickable.
  Footer decorations anchor to `footerSpacer`, which renders in every stage, via `mountBefore`
  (D54). The general rule the anchor table now carries: before mounting, ask what the parent does
  about its children.
- **Bound any regex you run over a stringified record.** `JSON.stringify` output is one line;
  `.*` and `(.+?)` cross into unrelated fields. Exclude `"` and `\` and cap the length.
- **Patch bundles byte-faithfully.** Read and write bytes; text-mode I/O rewrites every line
  ending on Windows. Line endings in the repo are git's problem, not yours: `* text=auto`
  normalises to LF on commit and checks out native, so write files however your tools write
  them. Only `generated.ts` and `packages/plugin-api/schema/manifest.json` are pinned to LF,
  because we generate their bytes and then compare them against what is on disk.
- **Keep `index.js.orig` and `extension.js.orig` intact.** They are the only recovery from a blank
  panel or a broken extension host.
- **Never point a test at the live extension directory.** Copies only.
- **Rebuild the host before running the harness tests.** They drive the *real* bundle in a browser
  and `preparePayload` copies `packages/host/dist/{pre,post}.js`, so vitest alone exercises whatever
  was last built, not your source. `preparePayload` refuses when `host/src` is newer than
  `host/dist`, naming the build command — so this costs you a re-run rather than a green result
  about code that is not loaded, but the rebuild is still yours to do.
- **A plugin's problem never blocks the install.** Report it by name, inject around it, refuse it
  at load. Only a collapsed harvest or Rigline's own build failure blocks.

## Working on the live extension

    pnpm build              # host, core, cli, and the first-party plugins
    pnpm rigline install    # inject every version, bake plugins, report drift, record the baseline
    pnpm rigline check      # the same report, writing nothing
    pnpm rigline add SPEC   # install a plugin from a directory or npm, name it, re-inject
    pnpm rigline update     # move each npm plugin to what its tag resolves to, and re-inject
    pnpm rigline remove N   # delete a plugin rigline installed, and re-inject
    pnpm rigline list       # every plugin, in load order: origin, source, switch, what it can do
    pnpm rigline status     # per version: vanilla or patched, by backup
    pnpm rigline restore    # every version back to the extension's bytes
    pnpm rigline codegen    # regenerate plugin-api's generated.ts
    pnpm rigline diff A B   # identifier drift between two extension dirs
    pnpm rigline doctor     # install state per version, as a pasteable report

`rigline` is a workspace devDependency of the repo root (`workspace:*`, resolving to
`packages/cli`), so `pnpm install` links its bin and `pnpm rigline <command>` runs the local
build directly — no path to `packages/cli/dist/index.js` needed. `pnpm exec rigline <command>`
is equivalent, if `pnpm <command>` ever collides with a real pnpm subcommand.

Rebuilding the payload or a plugin and running `install` again refreshes the files in place
without rewriting the bundle. `restore` is the undo and the recovery from a blank panel; it needs
only Node and this checkout.

`install` is the one write command about the injection, and `check` is its read-only half. `add`
and `remove` change the plugin set and re-inject afterwards, so a plugin is one reload away rather
than one reload and a command a person has to know about (D56). `update` means *update my plugins*,
as it does in every package manager (D55), and never touches the injection on its own.

An update installs a new versioned directory and deletes the old one, so it silently reverts the
injection. A window that was open keeps running the old directory until *Developer: Reload Window*.
A payload change needs *Developer: Reload Webviews* (current window only, and it ends the in-flight
turn of any Claude session in that window). A changed host patch needs a window reload.

Reference bundles are at `c:\dev\kb\vscode-claude-code-versions\<version>\`. The extension deletes
superseded versions, so snapshot a new one there before it goes. Older VSIXs can be fetched from
the Marketplace.

## Workflow

Work on `main` and commit straight to it; commit at each checkpoint rather than accumulating a
large tree. Stage by path if `git status` shows changes you did not make. Commit messages go
through a file (`.commitmsg.tmp`, gitignored) and `git commit -F`.

Toolchain: pnpm 12, Node 26, TypeScript 7, Rolldown, Vitest, Biome. Semicolons are required.
