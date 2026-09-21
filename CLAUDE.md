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
- [docs/m8-companion.md](docs/m8-companion.md): the open milestone. The companion extension that
  stops an update silently reverting the injection — the fork it derives from (it spawns the
  installed engine, never embeds core), what it watches, what it may reload, and the three phases.
- [docs/decisions.md](docs/decisions.md): principles P1 to P8 and decisions D1 to D75.

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
- [docs/verification.md](docs/verification.md): the four tiers, the corpus, the harness, the probe,
  the packed install, and which tier a question belongs to.
- [docs/ci.md](docs/ci.md): the delivery model. The branching rule, why versions and both dist-tags
  are derived rather than chosen, the three release commands, the two workflows, and what is still
  outstanding.
- [docs/releasing.md](docs/releasing.md): the four published packages, the stage-then-approve split,
  the one-time npm setup and why each step of it is a person's, and cutting a release.

Written for somebody else, so don't rewrite them for us:

- [docs/anthropic-compliance.md](docs/anthropic-compliance.md): what Rigline does and does not do to
  Anthropic's extension, how we read their terms, and the standing invitation to correct us. Written
  for Anthropic, linked from the top of the README. The position it commits to is D77; changing what
  it claims is a decision, not an edit.
- [docs/plugin-policy.md](docs/plugin-policy.md): what the host makes impossible for a plugin, what
  is asked of an author, and what we explicitly do not police. Written for a plugin author. Keep the
  two halves apart — a guarantee the architecture backs, and an obligation nobody is checking. We do
  not claim to review plugin source, and the licence stays MIT (D79).
- [docs/anchors.md](docs/anchors.md): what an anchor is, and repairing one through
  `~/.rigline/anchors.json` without waiting for a release. Written for a user.
- [docs/authoring.md](docs/authoring.md): writing, testing and shipping a plugin. Written for a
  plugin author; `packages/create-plugin/template/` is the scaffold it starts from.

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
- **Cite a decision, never restate it.** The argument lives in [docs/decisions.md](docs/decisions.md);
  a source comment gets the one sentence a reader needs *here* plus `(D74)`. Re-explaining the
  reasoning inline gives it two homes that drift, and it is how a comment grows to four lines when
  one was required. Comments here have been running long — keep them to the minimum the code and its
  surroundings cannot supply.
- **Bound any regex you run over a stringified record.** `JSON.stringify` output is one line;
  `.*` and `(.+?)` cross into unrelated fields. Exclude `"` and `\` and cap the length.
- **Patch bundles byte-faithfully.** Read and write bytes; text-mode I/O rewrites every line
  ending on Windows. Line endings in the repo are git's problem, not yours: `* text=auto`
  normalises to LF on commit and checks out native, so write files however your tools write
  them. Only `generated.ts` and `packages/plugin-api/schema/manifest.json` are pinned to LF,
  because we generate their bytes and then compare them against what is on disk.
- **Code that parses a repo file must not assume LF.** The working tree carries whatever git
  checked out, which here is CRLF, so `indexOf("## Heading\n")` finds nothing and `/^\n+/` strips
  nothing — on the machine this is developed on, not somebody else's. Find the end of a line rather
  than the newline you assume ends it, and compose with the endings the file already has. It is
  quiet in both directions: a search that fails reads as "the section is missing", and a rewrite
  that fails reads as a successful no-op, which is how it survives a green run.
- **Keep `index.js.orig` and `extension.js.orig` intact.** They are the only recovery from a blank
  panel or a broken extension host.
- **Never point a test at the live extension directory.** Copies only.
- **Run `pnpm build`, not `pnpm -r build`, before any test run.** The recursive one builds each
  package and stops; the copy into `dist/bundled` is the *root* `build` script's second step, so
  `pnpm -r build` leaves a stale bundle and `bundledDir()` refuses — in core's own `assets` tests as
  readily as in the harness, which is where this actually bites. The harness is the reason the guard
  exists: it drives the *real* bundle in a browser and `preparePayload` copies
  `dist/bundled/{pre,post}.js`, so vitest alone exercises whatever was last built, not your source. `dist/bundled` is a copy, so the chain is `src` -> each `dist` ->
  `dist/bundled`, and a break anywhere in it means the payload is not what your source says.
  `bundledDir()` checks the whole chain and refuses with the build command — so this costs you a
  re-run rather than a green result about code that is not loaded, but the rebuild is still yours to
  do.
- **A plugin's problem never blocks the install.** Report it by name, inject around it, refuse it
  at load. Only a collapsed harvest or Rigline's own build failure blocks.

## Working on the live extension

    pnpm build              # host, core, cli, the first-party plugins, then core's dist/bundled
    pnpm rigline install    # inject every version, bake plugins, report drift, record the baseline
    pnpm rigline check      # the same report, writing nothing
    pnpm rigline add SPEC   # install a plugin from a directory or npm, name it, re-inject
    pnpm rigline remove N   # delete a plugin rigline installed, and re-inject
    pnpm rigline disable N  # switch a plugin off in config.json, and re-inject
    pnpm rigline enable N   # switch it back on, and re-inject
    pnpm rigline list       # every plugin, in load order: version, origin, source, switch, uses
    pnpm rigline status     # per version: vanilla or patched, by backup
    pnpm rigline restore    # every version back to the extension's bytes
    pnpm rigline codegen    # regenerate plugin-api's generated.ts
    pnpm rigline diff A B   # identifier drift between two extension dirs
    pnpm rigline doctor     # install state per version, as a pasteable report

`pnpm rigline <command>` is a root script forwarding to `rigline-engine`, core's bin, linked by the
root's `@rigline/core` devDependency. **This checkout does not use the `rigline` package**, and must
not: that is the retrieval layer a user installs, and running it here would fetch an engine from npm
(D69). Every verb below is the engine's and reads the same either way — `rigline check` is what a
user types, `pnpm rigline check` is what you type — and `update` is the one verb only the wrapper
has, so it does not work here.

Rebuilding the payload or a plugin and running `install` again refreshes the files in place
without rewriting the bundle. `restore` is the undo and the recovery from a blank panel; it needs
only Node and this checkout.

`install` is the one write command about the injection, and `check` is its read-only half. `add`,
`remove`, `disable` and `enable` change the plugin set and re-inject afterwards, so a plugin is one
reload away rather than one reload and a command a person has to know about (D55, D56). `rigline
update` is the wrapper's: it moves the engine and the plugins, and re-injects behind both (D55,
D69).

The four first-party plugins are bundled inside `@rigline/core` and discovered in place, so this
checkout's `plugins/` shadows them and `disable` is the only way to decline one (D71, D72). In a
published install they are the only root that has them; here they are found twice, quietly.

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

**A user-visible change updates `CHANGELOG.md` in the same commit**, under `## Unreleased` (D60).
User-visible means somebody installing a package would notice: behaviour, the CLI's surface, what a
plugin can do, what the scaffolder emits, a dependency floor. Refactors, docs and tests are not,
and padding the file with them makes the real entries harder to find. It is written for somebody
reading it on npm, not for us — say what changed for them, not which function moved.
`pnpm release <increment>` cuts and pushes a version — changelog, manifests, commit, tag — and
`pnpm release:finish` approves it; the release refuses a version the changelog has no section for.
[docs/releasing.md](docs/releasing.md) is the runbook.

Toolchain: pnpm 12, Node 22.12+ (26 here), TypeScript 7, Rolldown, Vitest, Biome. Semicolons are
required. CI runs lint, typecheck, build and test on every push and pull request, over a Node
matrix whose lowest rung is the `engines` floor the published packages declare (D59) — so moving
that floor means moving the rung and six manifests together.
