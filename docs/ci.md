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

A review on 2026-09-20 read the pipeline as a new contributor would, and found the model sound and
several of its edges wrong. Everything below is agreed and specified; none of it is an open
question, and the cuts near the end were deliberate. Until it lands, two claims in the sections
above are known to be false — the branching invariant as stated, and `release:check` refusing on
every run — and items 9 and 5 are what make them true.

### Must fix before the first release

1. **CI never runs on a line branch.** `ci.yml` is `push: branches: [main]`, so every `<major>.x`
   branch this model creates has nothing running on it until a release does — the failure D50's
   amendment argues against, one level out. Make it `[main, "*.x"]`.

2. **`release:finish` cannot be re-run, and its second half is unreachable.** The `pnpm stage
   approve` call sits in a `catch` that calls `fail()` with a message about the workflow still
   running, so a re-run after a successful approval dies there; and the `npm dist-tag add` loop
   below it is uncaught, so a cancelled authentication on the third package exits with a stack
   trace, `next` half-moved, and no recovery in any document. Three changes:
   - Gate on `npm whoami` before anything else, so a stale session fails before the tag is pushed
     rather than after the workflow is green.
   - Decide the approval three ways, per package, by reading `versions`: none published, approve;
     all published, skip to the retag; **some** published, approve again. Partial approval is real —
     `stage approve` skips a package whose workspace dependency did not make it — and a binary check
     answers it wrongly and strands the stragglers permanently, because the next release stages a
     different version.
   - Wrap each `dist-tag add` individually: name the package, print the literal command, carry on,
     report at the end. `npm dist-tag add` is idempotent, so re-running the whole command corrects
     itself and needs no resume state.

   **Do not merge the two registry reads.** `versions` must be read before the approval and
   `dist-tags` after it, because approval is what sets `next` when the stage went up under `next` —
   which is what the `next === version` guard at the top of the retag loop is for. A single
   pre-approval snapshot sees the old value, and on the commonest preview release you spend four
   authenticated writes where you should spend none.

3. **`releasing.md` contradicts D61 in two places.** It says the workflow "asks which tag every
   time" and tells you to "release with `dist_tag: latest`". That input does not exist; the only
   input is `dry_run`. The first is also wrong on substance — it says a prerelease goes to a tag
   that is not `latest`, which is the opposite of what D61 derives while no stable line exists.

4. **The workspace is `packages/*` and `plugins/*`; `manifestPaths()` reads only `packages/`.** The
   four plugins sit at `1.0.0-alpha.2` and are never bumped, while `pnpm stage publish -r` reads
   `pnpm-workspace.yaml` and would stage one the day somebody drops its `private`. Glob both.

5. **The dry run is already broken, and passes only by luck.** A dispatch runs `release:check`
   against an unchanged tree, so the version is one already published and `stageTag` refuses it. It
   works today only because `next` lags `latest` by one version; the first clean release closes that
   gap and the dry-run path — the documented way to check the trusted publishers — starts failing.
   GitHub's *Re-run jobs* on a release run hits the same wall, and that is a button pressed by
   somebody already rattled. Fix: the workflow tells `release:check` explicitly whether this run
   will stage — a flag, not an inference from `GITHUB_REF`, which is the same dispatch-shaped test
   in another costume. When it will not stage, print the derivation including any refusal as
   information, and emit `dry-run` as the tag. Not `next`: a wrong-but-plausible tag that leaks into
   a real stage is invisible, an obviously fake one is spotted in a minute.

   A consequence worth having: this also makes `workflow_dispatch` with `dry_run: false` refuse,
   since the tree's version is by construction already published. Staging becomes tag-only, which is
   what D60 claims and nothing currently enforces.

6. **Quote the dist-tag interpolation.** Both `stage publish` lines render `--tag ${{ ... }}`
   unquoted. An empty value turns the dry-run step into `--tag --dry-run --report-summary ...`, and
   if pnpm's parser takes `--dry-run` as the tag's value it has eaten the flag that made it a dry
   run. Quoting fails loudly on empty instead, and nobody has to find out what pnpm's parser does.
   One guard beside it: the **Stage** step refuses the literal `dry-run`, so the two expressions
   that decide whether a run stages — that step's `if:` and the flag in item 5 — cannot drift into
   publishing under the placeholder on a green run nobody reads.

### Smaller, all agreed

7. **Split the refusal message** (`tags.mjs`). It always says a release on a superseded major needs
   a line tag, including when the version is simply already published or the line moved on — where
   the suggested `1.x` is the line `latest` is already on. Both dry-run paths in item 5 surface this
   text, which raises its value rather than lowering it.

8. **A prerequisites block in `releasing.md`.** Be logged in to npm before cutting, and the
   `npm login` trap already written up — one URL, then silence while it polls — is what you will hit
   doing it. `gh` on PATH, and `--no-github-release` if you do not want one. `npm` distinctly from
   `pnpm`, which is argued at length as a trap but never stated as a requirement.

9. **D62's invariant is false during a preview window**, and the naming rule runs only one way. When
   `main` carries `1.3.0-beta.1` it is on `next` and `latest` is a commit behind — and no increment
   from `main` produces a hotfix. Restate as: *`main` is the line `latest` points at, or the line
   that will next point at it*; every live line that is not `main` has a branch named for it,
   `<major>.x` or `<major>.<minor>.x`. Then add the constraint the naming now makes it possible to
   violate: **one preview line at a time** until line tags exist, because two preview lines both
   want `next` and only the higher one can have it.

10. **Name the promotion.** The second half of a preview cycle is a stable release of the same code.
    The docs describe it correctly and never label it, so a reader looking for "promote" lands on
    the `npm dist-tag` trap and may move `latest` by hand.

11. **Catch the push in `release.mjs`** and print two commands — the retry, and the undo
    (`git tag -d v<version>` and a reset). A failed push leaves a local commit and tag, and
    re-running answers `v1.2.4 already exists`, which is true and useless. Prose only for the other
    half: a version burned by a red run leaves a changelog section describing changes that will ship
    under a different number, and it folds into the next release's section.

12. **Say why `currentVersion()` reads only the root**, at the function. Reading all seven manifests
    and refusing when they disagree is exactly the hardening a contributor would call obvious, and
    it would fire on every merge between two lines: every manifest conflicts, and only the root is
    worth a person's attention, because `release` rewrites the rest from it.

13. **Let a dispatch come from a line branch** — `main` or `*.x`. A dry run is how the trusted
    publishers get checked before the first release on a new line, which is exactly where the guard
    refuses today. One `if:`, and nothing written about it anywhere.

14. **`plan.md` still names `pnpm release:prep`**, which does not exist.

15. **Assert the delimiter after the heading in `changelogSection()`.** It matches as a prefix, so
    `1.0.0-alpha.1` finds `## 1.0.0-alpha.10`. Unreachable while the newest section is first — which
    stops being guaranteed in a changelog merged between two lines. One line, no test, no prose.

### Cut deliberately

A sentence noting that an unreachable registry moves the refusal from local to post-push. The
refusal itself should say so when it happens; nobody reads a document in advance for the offline
case. What accumulates in this repository is prose, not code, and a sentence explaining a subtlety
competes with the sentences already carrying weight.

### Deferred, with the reason

**Line tags, for a superseded major.** `1.2.6` after `2.0.0` has shipped is refused, because both
available tags would be wrong and one would be a downgrade for everybody. The rule is unambiguous —
a version below `latest` that is the newest on its own major stages under `<major>.x`, touching
neither tag — and it is one more branch in `stageTag` plus `--latest=false` on the GitHub release.
Deferred to the day the `2.x` branch opens (Leo, 2026-09-20): the naming and the flag want the real
case in view, and until a second line exists there is nothing to maintain.

**macOS is untested anywhere.** The matrix is Linux plus one Windows row.

### Settled, so nobody re-asks

`npm login` is done on this machine, and the stage queue was confirmed empty on 2026-09-20 — which
makes the first release safe whatever a bare `pnpm stage approve` turns out to batch, since with an
empty queue every reading of it approves the same thing.

Two questions can only be answered by the first real release, and both want `npm stage list` open:
whether a bare `stage approve` takes this run's batch or everything on the account, and whether
reconciling `next` costs one authentication or four. Until the first is answered, `releasing.md`
should not tell anybody an unwanted stage is safe to leave alone.
