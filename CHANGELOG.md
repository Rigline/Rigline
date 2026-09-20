# Changelog

All four published packages — `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin` — share this file and one version number, so an entry names the package
only where the change is specific to one.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the line is `1.0.0-alpha.*`,
anything may change between releases.

## Unreleased

### Added

- A changelog, and `pnpm release:prep <version>` to cut a version with one command.
- CI on every push and pull request, over Node 22.12.0, 24 and 26 on Linux plus 22.12.0 on Windows.
- Scaffolded plugin workspaces ship a CI workflow alongside the release one, so an author's tests
  run on a pull request rather than first running during a release.
- Dependabot watches the GitHub Actions pins, one grouped pull request a week.

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
