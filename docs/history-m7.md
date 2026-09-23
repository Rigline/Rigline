# Milestone 7: distribution

Archaeology for the milestone that made an installed Rigline work. Built 2026-09-21: 7a shipped in
`1.0.0-alpha.5`, and 7b in `1.0.0-alpha.6`. The argument is D69 to D75 in
[decisions.md](decisions.md); the reference is [architecture.md](architecture.md) for the packages,
the update pipeline and where state lives, and [verification.md](verification.md) for tier 4.
Nothing here is load-bearing.

## The problem

`npm install -g rigline && rigline install` threw `payload is missing pre.js`, and had for two
releases. The CLI found the payload by a relative path from its own `dist`, which reached
`packages/host/dist` in this checkout and nothing in a published install, because `@rigline/host`
is private. No published package carried the thing that gets injected, or any plugin.

The root cause was not a missing copy step: nothing had ever exercised the published artefact.
Every tier drove the workspace, where those paths happen to resolve. Tier 4, which packs the
tarballs, installs them offline and runs `install` out of them, is the answer that stops it
recurring.

## The fork it opened on

*Where does `update` live?* A process cannot replace the package it is running out of, so whatever
performs an update sits above the thing being updated (D69). That split Rigline in two: `rigline`, a
retrieval layer that declares no Rigline package and forwards every verb it does not own, and
`@rigline/core`, the engine behind `rigline-engine`. Everything else followed. The wrapper vets the
container and the engine vets the content, so there is one `add`, in the engine, taking a path
(D70). The engine lives in `<RIGLINE_HOME>/engine` and nowhere else (D73), and the engine owns
`config.json` (D74).

## 7a: the published artefact works

Core ships `dist/bundled`: the payload and the four first-party plugins, discovered in place and
versioned with the engine (D71, D72). Discovery gained the bundled root, with an override recorded on
the winner rather than logged per version. `disable` and `enable` arrived, because switching off is
the only way to decline a bundled plugin. `registry.js` carries the engine that wrote it (D75).
Rolldown became a lazy import, which took 20 MB of native binding out of every published tarball.

Read live on `alpha.5`, from `npm i -g rigline` on a machine with no checkout: 27 of 27 anchors on
each version, all four plugins baked, the badge green on both surfaces, and the payload stamp naming
the engine that was installed.

## 7b: the wrapper and the engine separate

Five steps, ordered so the tree was green at each. This repository's own scripts had to move off the
wrapper in the same step as the wrapper dropped core, because `pnpm build` runs `rigline build` in
four packages and there is no green tree between the halves. The template followed, then the docs.

Read on the published `alpha.6`, from the registry. `npm install rigline` was one binary with no
dependencies. `--version` named the absent engine. `check` installed `@rigline/core` and forwarded.
`list` and `status` returned the engine's output and exit code with nothing of the wrapper's in
front. The same run gave D75 its first real reading: both installed versions reported a payload
written by engine `alpha.5`.

## What the first real update found

Minutes after `alpha.6` went out, the first `rigline update` on a fresh machine refused the engine
as too young, installed it anyway, and skipped the re-injection, because the re-inject decision read
the outcome the refusal had written. The gate is about staying on what you have, so it now applies
only when an engine is installed. The result type says which outcomes carry which versions, so
"staying on undefined" is a shape the compiler refuses.

## Left open

Whether a *published* older engine upgrades cleanly under `rigline update`. The check needed two
published versions carrying `rigline-engine`, and `alpha.5` had no `bin`. Cutting a throwaway version
to be the older half was offered and declined, so it was carried as unrun. Every release from
`alpha.6` on makes it possible, and [plan.md](plan.md)'s Next session holds it.
