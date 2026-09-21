# Changelog

All four published packages — `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin` — share this file and one version number, so an entry names the package
only where the change is specific to one.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the line is `1.0.0-alpha.*`,
anything may change between releases.

## Unreleased

## 1.0.0-alpha.5 — 2026-09-21

### Fixed

- `npm install -g rigline && rigline install` now injects. No published package carried the loader
  or a plugin, so it failed with `payload is missing pre.js` and the only way to get a working
  install was to clone the repository. `@rigline/core` now ships the loader and the four first-party
  plugins, and a new test installs the published tarballs into a clean prefix and runs `install` out
  of it, so this cannot come back unnoticed.

### Added

- session-id, time-marks, worktree-prefix and the `RIG` diagnostics badge are bundled with
  `@rigline/core`, so a fresh install has them. They are discovered where they are rather than
  copied into `~/.rigline/plugins`, which means an update to Rigline is an update to them; your own
  plugin of the same name installs over one and wins, so a broken one can be replaced without
  waiting for a release.
- `rigline disable NAME` and `rigline enable NAME`. This is how you decline a bundled plugin: there
  is nothing to delete, and `rigline remove` now says so and sends you here. Both re-inject, so the
  change takes effect on the next webview reload.
- `rigline list` shows each plugin's version and says which of the bundled ones you are overriding.
- The injected payload records the version of Rigline that wrote it, so `rigline doctor` can say
  whether what is installed in the extension is what your Rigline would write now, `rigline check`
  says which version is running a payload left by an older one, and the probe's copied report names
  it. An upgrade that you forgot to follow with `rigline install` used to look identical to one you
  did.

### Changed

- `rigline` no longer depends on rolldown, which it only ever used for `rigline build`. The download
  is about 20 MB smaller. A plugin workspace scaffolded by `create-rigline-plugin` now declares
  rolldown itself; an existing one needs `pnpm add -D rolldown`, and `rigline build` says so by name
  if it is missing.

## 1.0.0-alpha.4 — 2026-09-21

### Added

- `ctx.check(name, run)`: a plugin contributes its own line to the diagnostics panel, grouped under
  its own name. It declares nothing, and the host hands it nothing — your own state answers it. The
  host calls it about once a second, so read state you already keep rather than computing an answer.
  A check that throws shows as a failing line naming your plugin and never disables it.
- The panel groups every line by who contributed it: the host's own under `core`, then each plugin.
  A plugin that has quietly stopped working can now say so, where before the badge stayed green.
- Scaffolded plugins ship with a check, so a new plugin starts with one rather than adding it after
  the first silent failure.
- A changelog, and `pnpm release <increment>` to cut and push a version with one command. A pushed
  tag starts the release; `pnpm release:finish` approves it, moves `next` if the release is ahead of
  it, and creates the GitHub release.
- CI on every push and pull request, over Node 22.12.0, 24 and 26 on Linux plus 22.12.0 on Windows.
- Scaffolded plugin workspaces ship a CI workflow alongside the release one, so an author's tests
  run on a pull request rather than first running during a release.
- Dependabot watches the GitHub Actions pins, one grouped pull request a week.

### Fixed

- `ctx.watch` no longer waits for an anchor the extension does not render on the current surface. It
  watches nothing and tears down cleanly, as it already did for an optional anchor the extension has
  not got, so a plugin that spans surfaces is not reported as broken on the one where its decoration
  was never going to appear.
- The diagnostics badge no longer flashes red for a second at startup. A check asking whether a
  decoration is on screen now says "not yet" until the host has had a chance to place one.
- session-id no longer loads on the session list, which has no composer footer for its badge.
- `ctx.decorateTranscript` no longer starts the transcript sweep on a surface that renders no
  transcript rows. The session list had been searching for rows once per React commit, for the life
  of the window, on a page that cannot have any.

## 1.0.0-alpha.2 — 2026-09-20

### Added

- `create-rigline-plugin` scaffolds a workspace that is ready to publish: a release workflow, the
  `rigline-plugin` keyword a plugin is discovered by on npm, and `publishConfig.access`.

### Fixed

- Published to `latest` as well as `next`, correcting a `latest` left pointing at `1.0.0-alpha.0`
  by the bootstrap publish — which `npm create rigline-plugin` resolves, so the documented command
  had been producing a scaffold that a later version already fixed.

## 1.0.0-alpha.1 — 2026-09-19

### Fixed

- The published packages no longer ship source maps referring to sources that are not in the
  tarball.
- The CLI reports its own version from its manifest rather than from a constant that could drift
  out of step with it.

## 1.0.0-alpha.0 — 2026-09-19

First publish: the injector and host runtime, the capability-scoped plugin context, the CLI, and
the scaffolder.
