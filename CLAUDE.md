# Rigline — agent notes

*Renamed from Prototype on 2026-09-14 — nothing was published under the old name; see the status log
in [docs/plan.md](docs/plan.md).*

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
- [docs/decisions.md](docs/decisions.md): principles P1 to P8 and decisions D1 to D39.
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
  (D7).
- **Bound any regex you run over a stringified record.** `JSON.stringify` output is one line;
  `.*` and `(.+?)` cross into unrelated fields. Exclude `"` and `\` and cap the length.
- **Patch bundles byte-faithfully.** Read and write bytes; text-mode I/O rewrites every line
  ending on Windows. The repo forces LF for the same reason.
- **Keep `index.js.orig` and `extension.js.orig` intact.** They are the only recovery from a blank
  panel or a broken extension host.
- **Never point a test at the live extension directory.** Copies only.
- **A plugin's problem never blocks the install.** Report it by name, inject around it, refuse it
  at load. Only a collapsed harvest or Rigline's own build failure blocks.

## Working on the live extension

    pnpm build              # host, core, cli, and the first-party plugins
    pnpm rigline install    # inject every installed version; bake plugins
    pnpm rigline status     # per version: vanilla or patched, by backup
    pnpm rigline restore    # every version back to the extension's bytes
    pnpm rigline codegen    # regenerate plugin-api's generated.ts
    pnpm rigline diff A B   # identifier drift between two extension dirs
    pnpm rigline doctor     # install state plus VS Code's own logs, as a pasteable report

`rigline` is a workspace devDependency of the repo root (`workspace:*`, resolving to
`packages/cli`), so `pnpm install` links its bin and `pnpm rigline <command>` runs the local
build directly — no path to `packages/cli/dist/index.js` needed. `pnpm exec rigline <command>`
is equivalent, if `pnpm <command>` ever collides with a real pnpm subcommand.

Rebuilding the payload or a plugin and running `install` again refreshes the files in place
without rewriting the bundle. `restore` is the undo and the recovery from a blank panel; it needs
only Node and this checkout.

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
