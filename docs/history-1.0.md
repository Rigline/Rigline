# The road to 1.0, and 2.0

Archaeology for the work from the first commit to `2.0.0`: the phases, milestones 7 and 8, plugin
UI, the 1.0 bar, and the crossing to 2.0. The argument is in [decisions.md](decisions.md), the
releases in the [CHANGELOG](../CHANGELOG.md) and the tags, and the reference in
[architecture.md](architecture.md) and its siblings. [history-m6.md](history-m6.md),
[history-m7.md](history-m7.md) and [history-m8.md](history-m8.md) go deeper on three pieces of it;
[todo-1.0.md](todo-1.0.md) and [todo-1.0-mac.md](todo-1.0-mac.md) are the closed 1.0 lists. Nothing
here is load-bearing, and nothing appends to it: git and the CHANGELOG are the status log now.

## The phases

The work ran in numbered phases, each closed by a commit, from 2026-09-13 to 2026-09-21.

- **0 and 1**, 2026-09-13: the archive, the corpus and the workspace, then the identifier layers and
  codegen, every regex derived against the 2.1.270 bundle. The first toolchain was TypeScript 7,
  Rolldown, Vitest and Biome; TypeScript 6, ESLint and Prettier replaced two of those (D136).
- **2**, 2026-09-14: inject, restore and status with the backup as the authority, the kernel and its
  capability modules, and the probe. The Playwright spike ([spikes/playwright-harness.md](spikes/playwright-harness.md))
  answered its acceptance question and became `packages/harness`.
- **3**, 2026-09-14: `uses.optional`, the augmentable identifier interface, the build preset, the
  install-time check, successor suggestions and the CLI. Three bodies of work landed after it closed
  and belong to it: anchor ambiguity (D7 amended, anchors resolving to selectors), the composer-footer
  damper (D54) and observability (D53).
- **4**, 2026-09-19: the local anchor override, `add`, `remove` and `update` over a tar reader of our
  own, the authoring guide and template, the six topic docs, and the release pipeline, first proven on
  `1.0.0-alpha.1`. **4b**, 2026-09-20: the CHANGELOG and `pnpm release` ([ci.md](ci.md)).
- **5**, the companion, outgrew its entry and became milestone 8.
- **6**, 2026-09-21: diagnostics contributed by each plugin and capability rather than written into
  the probe ([history-m6.md](history-m6.md)).

Milestone 7, 2026-09-23, split `rigline` into a retrieval layer over the `@rigline/core` engine
([history-m7.md](history-m7.md)). Milestone 8, 2026-09-25, was the companion
([history-m8.md](history-m8.md)). Plugin UI in React closed the same day (D87 to D97).

## The 1.0 bar

Agreed 2026-09-26, and cleared on `1.0.0-alpha.13`: a written statement of what 1.x holds stable
([stability.md](stability.md)); a wrapper that installs the engine and forwards everything else
(D106); `ctx.style` refusing an undeclared class (D107); an unknown manifest key refusing only its
plugin (D12); VS Code alone; no console window when the companion runs Rigline; a macOS row in CI
and a live run on a Mac; and reads of a remote window and of a reused transcript row. Checking
stability.md against the code produced D108 to D112.

## What the live reads found

What the harness could not have said, and git does not.

- **`1.0.0-alpha.7` was spent.** The release gate ran on one platform and could not see a platform
  assumption, so releases are cut from green CI, and a Linux checkout exists beside this one.
- **The Mac run on `alpha.13` stood in for the remaining 1.0 reads** — restore, Save, the companion
  adding itself, the upgrade. It was not run rigorously and nothing it tried failed, so those were
  assumed rather than shown. Save through a released engine, owed since plugin UI, was finally seen
  in the 2.0.0 crossing.
- **A remote window**, read in WSL on 2026-09-27: a vanilla panel, and a companion there saying it is
  not in this editor. Remote windows have been unsupported since.
- **One engine injects at a time (D105)** was seen working only by accident, when Claude Code went
  back to 2.1.280 with several windows open: one window's engine waited out another's install, then
  found both versions current and wrote nothing.
- **Transcript row keying moved twice.** 2.1.285 keyed rows by message rather than by index, and
  2.1.289 by uuid ahead of API message id; under both, React still hands a row to another record, and
  2.1.289's keying made the reuse case reachable by streaming a response (D22 amended, D103).
- **2.1.286 was the first update to break a harvest**: the push loop's body became a block, and the
  push switch has been found by proximity since, as the request switch was (D104 did its job).
- **time-marks' minute padding failed only in the first ten hours of UTC.** Under `h23` the locale
  decides whether `hour: "numeric"` pads, so an en-AU machine passed the unit tier while the harness
  failed by time of day. The app pins `en-US`, and so does time-marks now (D135).
- **model-favourites was wrong on its first live use**, and so was what it rested on: `update_state`
  carries the user setting and the host's stale cache of `settings.json`, not the session's choice,
  and requests sent around the panel left its picker showing the old one. The harness missed it
  because its fake host never acts on a write and nothing looked at Claude Code's own picker after a
  click. Both now go through the panel's session (D120 amended).
- **A row's two fibers disagreeing by silence** had been read as an ambiguity, and was costing a third
  of a live transcript and a mark blinking once per React commit (D134).

## 2.0

Rigline requires its companion (D143). `2.0.0` went to `latest` on 2026-10-20, and its crossing
from 1.2.0 was read as a user on a second machine: the 1.x companion's *needs you*, the global
install and `vscode-setup` moving the engine and every profile's companion, the reload, saves, and
`uninstall` and back.
