# CI and releasing: the model

Three workflows, three commands, and one rule about branches that the rest derive from. This is
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
- The next major lives on one long-lived branch — `3.x` — from the day it diverges until it ships.
- When `3.0.0` ships, `3.x` *becomes* `main`. If the old line still needs support, cut `2.x` from
  the last 2.x tag at that point.

2.0 is built on `main` instead, with no `2.x` branch and no maintained 1.x line, since nobody is on
1.x (D143). The rule binds from the next major, which will have users.

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
both. After approval, `next` exists only while a preview line is open (D61): a preview sets it, a
stable release removes a `next` at or below it, and one ahead of a maintenance release is left.

| the release | stages under | and `next` |
| --- | --- | --- |
| a new alpha, no stable line yet | `latest` | unset: `latest` names it |
| a preview, once a stable line exists | `next` | set by the publish |
| a maintenance release on the `latest` line | `latest` | untouched, if a preview is ahead |
| the release that ends a preview line | `latest` | removed, closing the line |
| a release on a superseded major | refused — see below | |

The comparison is `semver.gt` throughout and never a string compare, which sorts `1.0.0-alpha.10`
below `1.0.0-alpha.2` and would move a tag backwards on exactly the release nobody would check. The
derivation is tier 1, in `scripts/lib/tags.test.mjs`, because both mistakes it could make are
invisible until somebody installs the wrong thing.

## The three commands

    pnpm release <increment>   # local: changelog, manifests, commit, tag, push, then finish
    pnpm release:check         # CI: verify, and emit the dist-tag
    pnpm release:finish        # local: wait, approve with 2FA, reconcile `next`, GitHub release

`release` writes the tag that triggers the release workflow and then runs `release:finish`, so a
release never leaves the terminal it started in and ends when it is published (D146). It refuses a dirty tree, an empty `## Unreleased`, a version that is not above what
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
goes through — re-throws unless stdin and stdout are a TTY. It refuses to run unless the tag is in
HEAD's history: approval takes whatever is staged while the version comes from the tree, and a
checkout on another line makes those different things. The tip is free to have moved on, since
nothing it does acts on HEAD.

**It owns the verdict that the set is whole** (D146). Staging is consistent, but each approval
publishes one package and moves its `latest`, so a release reaches users package by package. So it
approves all of them or none: it waits until every package still unpublished has a stage that npm
has finished checking, then approves through `npm stage approve` in an order derived from the
manifests — each package after what it declares, and a package that declares nothing in the set
last, since it can only reach the set at runtime (D69). The first refusal stops it, which leaves
only packages whose dependencies are published. It reads the registry back before it calls the
release published.

Every step of it repeats, because a half-finished release is the likeliest way to arrive here
twice. It reads each package's `versions` first and approves only what is missing, so a second run
after an interruption, or after approving some by hand, carries on rather than starting again. A
straggler left behind could never be caught up, since the next release stages a different version.
Then it moves `next` one package at a time, each one caught and named, since `npm dist-tag add` is
idempotent and the recovery for a cancelled authentication partway through is the whole command
again rather than resume state somebody has to understand. The two registry reads stay apart for a
reason: `versions` before the approval and `dist-tags` after it, because approval is what sets
`next` when the stage went up under `next`, and a single pre-approval snapshot spends four
authenticated writes where it should spend none.

## The three workflows

**`ci.yml`** runs `lint`, `typecheck`, `build` and `test` on every push to a release line — `main`
or a `<major>.x` branch — and every pull request, over Node 22.12.0, 24 and 26 on Linux plus
22.12.0 on Windows and on macOS (D59). It cancels a superseded run, including on `main`, which is a deliberate
trade: the newest commit is the one worth a verdict.

Every step runs under bash, Windows included. Under the runner's default PowerShell, `pnpm` is the
`pnpm.ps1` shim npm writes for pnpm 12's native binary, which calls that binary by a path with no
extension; PowerShell hands such a file to the shell as a document rather than running it, so each
step printed nothing, set no exit code and passed. The step after `setup-node` fails when
`pnpm --version` prints nothing, so a runner where pnpm silently does nothing cannot pass.

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

**`registry.yml`** looks at what npm holds, every three hours and on dispatch, because nothing in a
release run can: approval comes after it (D146). From public data only, it goes red when a dist-tag
disagrees across the packages, when the most recently published version is missing from any of
them, or when the set at any dist-tag fails `npm install --dry-run`, which resolves the whole tree
without downloading it and is where `ETARGET` comes from. It never goes red over a stage nobody
approved, which is how an unwanted one is abandoned, and it cannot see stages at all.
`node .github/scripts/registry-check.mjs` runs it from a checkout.

It covers what `release:finish` cannot: a release approved on the website part of the way, or a
set that breaks after it shipped. Two things about scheduled workflows to know rather than
discover: they run only from the default branch, and in a public repository GitHub disables one
after sixty days without activity. The Actions tab re-enables it.

## Outstanding

The model above is implemented and has shipped every release since `1.0.0-alpha.4`. What is left
is one capability that was deferred.

### Deferred, with the reason

**Line tags, for a superseded major.** `1.2.6` after `2.0.0` has shipped is refused, because both
available tags would be wrong and one would be a downgrade for everybody. The rule is unambiguous —
a version below `latest` that is the newest on its own major stages under `<major>.x`, touching
neither tag — and it is one more branch in `stageTag` plus `--latest=false` on the GitHub release.
Deferred to the day the `2.x` branch opens (Leo, 2026-09-20): the naming and the flag want the real
case in view, and until a second line exists there is nothing to maintain.

It is also what *one preview line at a time* is standing in for. Two preview lines both want
`next`, and a line tag is how the lower one stops needing it.

### Settled, so nobody re-asks

**macOS is one row, not a matrix** (Leo, 2026-09-26). It runs at the floor, as Windows does, so a red
one means macOS rather than Node, and a full OS axis would triple the load for what the Linux rungs
already cover (D59).

The two questions only a real release could answer are answered, and [releasing.md](releasing.md)
is written around them. Which stages a bare `stage approve` takes no longer matters, because
`release:finish` passes the ids it reads from `npm stage list`. Approval goes through npm, because
a security key cannot take the pnpm path, and the website is the fallback rather than the route,
because it enforces no order and no completeness (D146). Reconciling `next` cost an authentication
per package, so `next` stays unset while no stable line exists (D61).

**`latest` is not held back until the set is whole.** That would stage under a holding tag and
move `latest` on every package afterwards, which is the one arrangement where a partial approval
never reaches a user. It costs an authenticated retag per package every release on top of the
approvals, and it undoes D61's *publish to the tag rather than move it*, to cover a route that
`release:finish` has made the fallback and `registry.yml` watches. Worth weighing again if one
authentication turns out to cover several writes (D146).
