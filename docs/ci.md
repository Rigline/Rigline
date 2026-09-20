# CI and releasing: the model

Two workflows, three commands, and one rule about branches that the other two derive from. This is
the shape and the argument; [releasing.md](releasing.md) is the runbook for actually cutting one,
and [decisions.md](decisions.md) holds the decisions cited here by number.

The property worth holding on to while reading: **nothing in the pipeline knows about branches.** A
version is computed from the checkout, a dist-tag is computed from that version and the registry,
and a tag names a commit. The branching rule below is therefore a convention for people, not an
input to any script — which is what keeps two release lines from costing anything in machinery.

## The branching rule

**`main` is always the line `latest` points at.** Every other live line is a `<major>.x` branch
(D62).

- Routine work and maintenance releases happen on `main`, which is where you already are.
- The next major lives on one long-lived branch — `2.x` — from the day it diverges until it ships.
- When `2.0.0` ships, `2.x` *becomes* `main`. If the old line still needs support, cut `1.x` from
  the last 1.x tag at that point.

Merge `main` into `2.x` regularly and never the reverse. The branch then carries every maintenance
fix as it lands, and the handover at the end is a fast-forward rather than a reconciliation.

One consequence to plan for rather than discover: `CHANGELOG.md` conflicts on every merge between
live lines, because both branches append under `## Unreleased`. Resolve by keeping both sides in
version order. It is the only file that reliably conflicts, and it is the price of two lines.

## Versions are derived, never typed

`pnpm release <increment>` computes the version with `semver.inc` from what is in the tree, so there
is no number to get right and no second place it could be wrong (D60). The increments are `patch`,
`minor`, `major`, `prerelease`, and `prepatch`, `preminor`, `premajor` for opening a prerelease
line; `--preid` sets the identifier, and without it the current one carries forward.

This is what makes the branching rule free. Each branch's `package.json` holds its own line's
version, so the same command with the same argument computes `1.2.4` on `main` and `2.0.0-alpha.2`
on `2.x`. You never tell it which line you are on: the checkout already knows.

Read what it prints before it writes. From a prerelease, all three of `patch`, `minor` and `major`
resolve to the same release — `1.0.0-alpha.2` plus any of them is `1.0.0`, because that is the
version the prerelease was already aimed at.

## Both dist-tags are derived, never chosen

Two sentences define them, and every case falls out (D61):

- **`next`** points at the newest version.
- **`latest`** points at the newest version a naive `npm install` should get — the newest stable
  one, or the newest of any kind while no stable one exists.

So the tag a release stages under is computed: `latest` when the version is above what `latest`
holds and is either stable or the line has no stable version yet; otherwise `next` when it is above
what `next` holds. After approval, `next` is pointed at the released version when `semver.gt` says
the release is newer, and left alone otherwise.

| the release | stages under | and `next` |
| --- | --- | --- |
| a new alpha, no stable line yet | `latest` | follows it |
| a preview, once a stable line exists | `next` | set by the publish |
| a maintenance release on the `latest` line | `latest` | untouched, if a preview is ahead |
| the major that ends a preview line | `latest` | follows it |
| a release on a superseded major | refused — see below | |

The comparison is `semver.gt` throughout and never a string compare, which sorts `1.0.0-alpha.10`
below `1.0.0-alpha.2` and would move a tag backwards on exactly the release nobody would check. The
derivation is tier 1, in `scripts/lib/tags.test.mjs`, because both mistakes it could make are
invisible until somebody installs the wrong thing.

## The three commands

    pnpm release <increment>   # local: changelog, manifests, commit, tag, push
    pnpm release:check         # CI: verify, and emit the dist-tag
    pnpm release:finish        # local: approve with 2FA, reconcile `next`, GitHub release

`release` writes the tag that triggers the release workflow, so a release never leaves the terminal
it started in. It refuses a dirty tree, an empty `## Unreleased`, and a version that is not above
what the registry holds. `--dry-run` shows the whole plan and writes nothing.

`release:check` runs before anything is built. It establishes that the changelog describes the
version, that a tag-triggered run is on the tag naming that version, and that a dist-tag exists to
stage under — all reads, so no credential and no permission. It is also the only branch guard the
release has: matching the tag against the tree is a stronger claim than any branch rule, and it
works on `main` and on a `<major>.x` branch alike.

`release:finish` needs a person, and cannot be automated. npm's OIDC exchange authenticates
`publish` and `stage publish` and nothing else, and `otplease` — the wrapper every 2FA'd npm write
goes through — re-throws unless stdin and stdout are a TTY. It refuses to run unless HEAD is the
commit the tag names, because approval takes whatever is staged while the version comes from the
tree, and a checkout that has moved between the two makes those different things.

## The two workflows

**`ci.yml`** runs `lint`, `typecheck`, `build` and `test` on every push to `main` and every pull
request, over Node 22.12.0, 24 and 26 on Linux plus 22.12.0 on Windows (D59). It cancels a
superseded run, including on `main`, which is a deliberate trade: the newest commit is the one worth
a verdict.

**`release.yml`** triggers on a pushed `v*` tag, and keeps `workflow_dispatch` for dry runs against
the trusted publishers. It re-runs the full gate on one rung rather than the matrix — a release is a
smoke test over code the matrix has already seen, and the matrix is where breadth is paid for. Its
filename is load-bearing: every npm trusted publisher names `release.yml` by path.

A pushed tag is safe to trigger on because of what staging is. Nothing the workflow does is
installable: an accidental tag produces a stage nobody approves, which expires. Tag-triggering a
pipeline that published directly would be a different proposition, and would want the manual
dispatch back as a speed bump.

**What neither can reach** is the corpus, which lives outside the repository (D36), so tier 2 skips
in full and the corpus-backed half of tier 1 skips with it. A green release run is therefore weaker
than a local one. See [verification.md](verification.md).

## Outstanding

**Line tags, for a superseded major.** `1.2.6` after `2.0.0` has shipped is refused today, because
both available tags would be wrong and one would be a downgrade for everybody. The answer the
refusal already names is a line tag: a version below `latest` that is the newest on its own major
stages under `<major>.x`, touching neither `latest` nor `next`, and `npm install rigline@1.x` is how
somebody stays on the old line. It is one more branch in `stageTag` with the same shape as the
others, plus `--latest=false` on the GitHub release so a late 1.x does not display as the newest
thing.

The branching rule above walks into this the day `2.0.0` ships, which is a bad moment to discover
work. Recommended: build it when the `2.x` branch opens, not when the major lands.

**The pipeline has never run end to end.** Every part is exercised — the derivation in tier 1, the
local command by dry run, the workflow's checks by CI — but no tag has been pushed through it. The
first release is the test, and the handovers are what to watch: that `release:check` derives the tag
you expect, and that `release:finish` finds the stage where it looks for it.

**Whether reconciling `next` costs one authentication or four.** `release:finish` issues a separate
`npm dist-tag add` per package, and whether npm's web flow challenges once or per call is not
knowable without a live stage. If it is four, the question is whether the token `otplease` gets back
can be reused across them.

**macOS is untested anywhere.** The matrix is Linux plus one Windows row, so the third platform a
VS Code user might be on has never run this code.
