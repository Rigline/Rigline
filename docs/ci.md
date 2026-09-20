# CI and releasing: the model

Two workflows, three commands, and one rule about branches that the other two derive from. This is
the shape and the argument; [releasing.md](releasing.md) is the runbook for actually cutting one,
and [decisions.md](decisions.md) holds the decisions cited here by number.

The property worth holding on to while reading: **nothing in the pipeline knows about branches.** A
version is computed from the checkout, a dist-tag is computed from that version and the registry,
and a tag names a commit. The branching rule below is therefore a convention for people, not an
input to any script — which is what keeps two release lines from costing anything in machinery.

## The branching rule

**`main` is the line `latest` points at, or the line that will next point at it.** Every other
live line has a branch named for it (D62).

- Routine work and maintenance releases happen on `main`, which is where you already are.
- The next major lives on one long-lived branch — `2.x` — from the day it diverges until it ships.
- When `2.0.0` ships, `2.x` *becomes* `main`. If the old line still needs support, cut `1.x` from
  the last 1.x tag at that point.

The second clause of the rule is doing work. Through a preview window `main` carries
`1.3.0-beta.1`, which is on `next`, and `latest` sits several commits behind it — so an invariant
that said *always* would be false for as long as the preview takes. It is also the window in which
a hotfix needs a branch: no increment from `1.3.0-beta.1` produces `1.2.4`, so patching the
released `1.2.3` means cutting `1.2.x` from its tag. A line narrower than a major is named for what
it is, `<major>.<minor>.x`.

**One preview line at a time**, until line tags exist. Two of them both want `next` and only the
higher one can have it. The pipeline refuses rather than mis-tagging — the lower line's next
release is below both tags — but it refuses at the end of a green run, which is a poor place to
learn it.

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
it started in. It refuses a dirty tree, an empty `## Unreleased`, a version that is not above what
the registry holds, and — when the registry has just answered, so the question is about the
session and not the weather — a machine with no npm login, because that one is otherwise found by
`release:finish` after a whole cycle has been spent. `--dry-run` shows the whole plan and writes
nothing.

`release:check` runs before anything is built. It establishes that the changelog describes the
version, that a tag-triggered run is on the tag naming that version, and that a dist-tag exists to
stage under — all reads, so no credential and no permission. It is also the only branch guard the
release has: matching the tag against the tree is a stronger claim than any branch rule, and it
works on `main` and on a `<major>.x` branch alike.

Only the last of the three is conditional, and the workflow says which way with `--no-staging`
rather than leaving it to be inferred. A run that stages nothing is by construction a run against a
tree whose version is already published, so deriving a tag for one refuses — correctly, and
uselessly, since nothing is going anywhere. Told that it will not stage, the check prints the
derivation and any refusal as information and emits the tag `dry-run`, which the staging step
refuses by name. An obviously fake tag that leaks into a real stage is spotted in a minute; a
plausible one is not.

The flag is a flag, and not `GITHUB_REF` or the event name, because every inference available is
the same shape as the question: a re-run of a real release looks exactly like the thing that must
not stage. One consequence falls out and is worth having — a dispatch with `dry_run: false` now
refuses, since the tree's version is already published, so staging is tag-only, which is what D60
claims and nothing else enforces.

`release:finish` needs a person, and cannot be automated. npm's OIDC exchange authenticates
`publish` and `stage publish` and nothing else, and `otplease` — the wrapper every 2FA'd npm write
goes through — re-throws unless stdin and stdout are a TTY. It refuses to run unless HEAD is the
commit the tag names, because approval takes whatever is staged while the version comes from the
tree, and a checkout that has moved between the two makes those different things.

Every step of it repeats, because a half-finished release is the likeliest way to arrive here
twice. It reads each package's `versions` before approving and decides three ways rather than two
— none published, approve; all published, skip to the retag; **some** published, approve again,
since `stage approve` skips a package whose workspace dependency did not make it and a straggler
left behind can never be caught up, the next release staging a different version. Then it moves
`next` one package at a time, each one caught and named, since `npm dist-tag add` is idempotent
and the recovery for a cancelled authentication partway through is the whole command again rather
than resume state somebody has to understand. The two registry reads stay apart for a reason:
`versions` before the approval and `dist-tags` after it, because approval is what sets `next` when
the stage went up under `next`, and a single pre-approval snapshot spends four authenticated
writes where it should spend none.

## The two workflows

**`ci.yml`** runs `lint`, `typecheck`, `build` and `test` on every push to a release line — `main`
or a `<major>.x` branch — and every pull request, over Node 22.12.0, 24 and 26 on Linux plus
22.12.0 on Windows (D59). It cancels a superseded run, including on `main`, which is a deliberate
trade: the newest commit is the one worth a verdict.

**`release.yml`** triggers on a pushed `v*` tag, and keeps `workflow_dispatch` for dry runs against
the trusted publishers, from `main` or any line branch — checking the publishers before the first
release on a new line is most of what a dry run is for. It re-runs the full gate on one rung rather than the matrix — a release is a
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

The model above is implemented. What is left is one capability that was deferred, one gap in the
matrix, and the two questions only a real release can answer.

### Deferred, with the reason

**Line tags, for a superseded major.** `1.2.6` after `2.0.0` has shipped is refused, because both
available tags would be wrong and one would be a downgrade for everybody. The rule is unambiguous —
a version below `latest` that is the newest on its own major stages under `<major>.x`, touching
neither tag — and it is one more branch in `stageTag` plus `--latest=false` on the GitHub release.
Deferred to the day the `2.x` branch opens (Leo, 2026-09-20): the naming and the flag want the real
case in view, and until a second line exists there is nothing to maintain.

It is also what *one preview line at a time* is standing in for. Two preview lines both want
`next`, and a line tag is how the lower one stops needing it.

**macOS is untested anywhere.** The matrix is Linux plus one Windows row.

### Settled, so nobody re-asks

`npm login` is done on this machine, and the stage queue was confirmed empty on 2026-09-20 — which
makes the first release safe whatever a bare `pnpm stage approve` turns out to batch, since with an
empty queue every reading of it approves the same thing.

Two questions can only be answered by the first real release, and both want `npm stage list` open:
whether a bare `stage approve` takes this run's batch or everything on the account, and whether
reconciling `next` costs one authentication or four. Until the first is answered, `releasing.md`
should not tell anybody an unwanted stage is safe to leave alone.

**The pipeline has not been driven end to end.** Every claim above is derived from the code and
from one bootstrap publish done by hand. The first release is the test of it.
