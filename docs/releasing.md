# Releasing

Four packages go to npm: `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin`. `@rigline/host` and `@rigline/harness` are `private` and never do.

A release is two commands and one click, cut from a commit `ci.yml` has already been green on:

    pnpm release prerelease   # cut it: changelog, manifests, commit, tag, push
    # then approve the four staged packages on npmjs.com — see step 3
    pnpm release:finish       # reconcile `next`, and the GitHub release

Between them, the pushed tag triggers `.github/workflows/release.yml`, which **stages**: GitHub
Actions authenticates to npm over OIDC, so no npm credential sits in this repository, and a staged
version is one nobody can install. `release:finish` then **approves** with 2FA, from your own
machine. An approved stage says the owner meant to ship, and nothing more than that (D46).

The split is the point, and it is also what makes a tag safe to trigger on: a tag pushed by mistake
produces a stage nobody approves, which expires. Nothing here asks which dist-tag to use — that is
derived from the version and what the registry already holds (D61), and reconciled after approval.

`stage publish -r` stages every publishable package whose version is not already on the registry, in
dependency order, replacing each `workspace:*` with the exact version. So running it twice stages
nothing the second time, and the four are either internally consistent or they are not published at
all. Approval takes the whole batch under a single authentication.

**`rigline` is outside that guarantee**, and it is the one package where being outside it hurts. The
consistency above is a property of the dependency graph, and the wrapper declares no Rigline package
(D69) — but it installs `@rigline/core@<its own version>` at runtime, so a `rigline` that goes up
without its engine is broken on the first command anybody runs. The two are checked together by eye
at step 3.

**The workflow filename is load-bearing.** Each npm trusted publisher names `release.yml` by path,
so renaming the file breaks the OIDC exchange for all four packages until every entry is edited to
match.

**A release run is a weaker check than a local one.** It runs lint, typecheck, build and the full
Node tier, but the harness tier skips itself there — it needs a corpus snapshot of the extension
bundle, and that lives outside the repository. So the cut runs all four locally before it writes
anything, on a machine that has the corpus, and refuses if any of them fails.

That gate is there because **a version cut on a red tree is spent**: the tag and the commit are
pushed before the workflow ever looks at them, so a failure in the run the tag triggers cannot be
retried on the same number. `pnpm test` alone is the trap it closes — `vitest` does not typecheck,
so lint, build and tests can all be green while `tsc` has never been asked, which is exactly how
`1.0.0-alpha.3` was burned.

**The local gate runs on one platform, and cannot see a platform assumption.** That is how
`1.0.0-alpha.7` was burned: all four checks green on Windows, and the run its own tag triggered
failed on Linux, because two test files hardcoded `;` as the PATH separator and `C:\…` as a
directory. The production code was right — it reads `delimiter` and `isAbsolute` from the running
platform — so only the tests believed in Windows, and they asserted real behaviour here and nothing
at all in CI.

**So cut from a commit CI has already been green on.** Push, watch `ci.yml` go green across its
matrix, and only then run `pnpm release`. That costs one CI run and closes the whole class, not just
the platform half — it is the only check that sees what the release run will see. Finish any tidying
before that push: the cut refuses a dirty tree, an untracked file included, and `ci.yml` cancels an in-progress run when a newer
push arrives, so a fix made while waiting starts the wait again.

`pnpm release` now asks GitHub for that verdict on the exact commit it would tag, and refuses on a
known failure. It is advisory in the other direction on purpose: no `gh`, no run yet, or a push
still racing its own workflow all say so and carry on, because a check that blocks a contributor
without the GitHub CLI would be a worse gate than none. Only a *failure* stops the cut.

**A Linux loop, for this machine.** WSL Ubuntu carries a second checkout at `~/rigline-linux`, with
its own `node_modules`, because a shared one cannot hold both platforms' native binaries:

    wsl.exe -d Ubuntu -- bash -ic "cd ~/rigline-linux && git pull --quiet && pnpm install --frozen-lockfile && pnpm build && pnpm test"

`git pull` takes what is on GitHub, so as written the loop tests a commit only after it is pushed.
To run it before the push, pull from this checkout instead: `git pull --ff-only
/mnt/c/dev/lee/rigline main`. The Linux checkout is then ahead of `origin` until the push, and the
next plain pull fast-forwards.

`bash -ic` rather than `-lc`: nvm installs into `.bashrc`, which a login shell does not read. The
corpus lives at a Windows path so its tests skip there with a reason, which is the designed
behaviour and not a failure — expect 126 skipped. The count grows with every corpus version and
harness test. To re-measure it on Windows, point `CORPUS` in `packages/core/test/corpus.ts` at a
directory that does not exist for one `pnpm test`, then put it back with an edit, not `git checkout`,
which would also drop any change to that file you have not committed. Nothing skips by platform, so
that count is the Linux one. This is the fast loop; the CI run above is the gate, because it also
covers the Node matrix and the `--frozen-lockfile` install.

## One-time setup

This part cannot be automated, and it has to happen in this order: each step names the one before
it. It is also the part that decides visibility, ownership and billing, which is why it is a
person's.

**1. The GitHub repository.** `Rigline/Rigline`, public, workflow at
`.github/workflows/release.yml`. Done, and everything below names it.

**2. The `@rigline` npm organisation.** It owns the scope, so the two scoped packages belong to it
by virtue of their names. The two unscoped ones do not, and cannot be made to: npm has no transfer
that moves `rigline` or `create-rigline-plugin` into an organisation the way a scope does. What it
has instead is granting the organisation write access on them, which is what they carry. The
practical difference is worth knowing rather than discovering: their owner is still a person, so
they need that grant maintained deliberately where the scoped pair get it from the namespace.

The unscoped names stay unscoped on purpose. `npm create rigline-plugin` and `npm i -g rigline` are
what somebody types, and `@rigline/cli` would be worse ergonomics for nothing (D50).

**3. A bootstrap publish of each package.** A package that does not exist yet can be neither staged
nor trusted-published: there is nothing for the registry to attach a publisher to. So the first
version of each goes up by hand, from your machine, after `pnpm login`:

    pnpm publish -r --tag next --otp 123456

**Supply a one-time password; do not create a token for this.** `pnpm login` alone gets a 403 —
npm requires proof of presence to publish, and a session is not that. The two ways to supply it are
an OTP and a granular token with *bypass 2FA* enabled, and the OTP is the one to take, because it
creates no credential: nothing to store, nothing to revoke, nothing to forget. A bypass-2FA token
would be worse here than the general case, because a granular token can only name packages that
already exist — so for the two unscoped names it would have to carry write on **all packages**, and
that is precisely the credential the last step of this list exists to eliminate.

One OTP covers all four if they go up inside its window. If a later package fails on an expired
code, run it again with a fresh one: `-r` skips whatever the registry already has, so a partial
bootstrap resumes rather than needing to be unpicked.

A bootstrap is the one place a tag is typed, and it barely matters which is typed: a package's
first publish pins `latest` whatever `--tag` says, which is the first of the traps below.
Nothing is typed after it. Both tags are derived from the version and what the registry already
holds (D61), and while no stable line exists the newest alpha is what `latest` should point at —
there is no input for it anywhere, and no run that asks.

**4. A trusted publisher per package**, on npm, under each package's settings. Four entries, all
naming `Rigline/Rigline` and `release.yml`, because npm's OIDC exchange is per package — pnpm asks
`/-/npm/v1/oidc/token/exchange/package/<name>` once for each. Set each one's permission to **stage
only**.

**5. Audit what can publish.** There is no org-wide or package-wide switch that *requires* staging,
so the gate holds exactly as long as every credential able to publish is stage-limited: one
forgotten full-rights token silently voids it, for all four packages, with no signal that it has.
Taking step 3 by OTP means there is nothing to revoke here — which is the point of taking it that
way. Check anyway, and check again whenever a token is issued for anything else. Both kinds support
the limit: `Read and write (stage only)` on a granular token, stage-only permissions on a trusted
publisher.

## What you need on the machine

**An npm session.** `npm whoami` should name your account. Both commands refuse without one —
`release` before it pushes the tag, so a lapsed session costs a minute rather than a cycle. `npm
login` prints `Login at:` and one URL, then goes quiet while it polls; it does not open a browser
for you, and the silence reads as a hang.

**`npm` itself, not only `pnpm`.** The retag goes through `npm dist-tag`, because `pnpm dist-tag`
takes a typed one-time password and nothing else — which an account with a security key cannot
give it. The `pnpm dist-tag` trap below argues this at length; it is listed here because it is a
requirement, and the argument is no use to somebody who has not installed the thing.

**`gh`, authenticated**, for the GitHub release at the end. Without it you get a message naming
the command to run by hand, and the release is otherwise finished; `--no-github-release` skips the
step deliberately.

**The corpus**, for the local test run. The release workflow cannot reach it and skips the harness
tier, so the local run is the stronger one.

## Cutting a release

1. `pnpm release <increment>` — `patch`, `minor`, `major`, `prerelease`, or one of `prepatch`,
   `preminor` and `premajor`. It runs lint, typecheck, build and test first and refuses to cut if any
   of them fails; then it computes the version, rolls `## Unreleased` into a section headed by it,
   writes it into every manifest **and into core's own `CORE_VERSION`**, commits, tags `v<version>`
   and pushes. Add `--dry-run` to see all of that without writing anything, or `--skip-checks` when
   you have just run them by hand.
2. Watch the run the tag triggered. Its summary names each package and version staged, because
   nothing notifies you that a stage is waiting. A green tick is not the check. `npm stage list
   --json` is: all four at the new version, each with `"actorType": "trusted automation"`, which only
   a successful OIDC exchange leaves. Reading the log for the absence of `[WARN] Skipped OIDC` says
   the same thing less directly.
3. **Approve the four** at `https://www.npmjs.com/settings/<user>/staged-packages`. `pnpm
   release:finish` will try to do it for you, and can only succeed for an account that can type a
   one-time password; a security key has none to give, and the website is the route that always
   works. **This is the step to expect to do by hand**, not the exception — every release so far has
   ended up here.

   **Check `rigline` and `@rigline/core` by eye, together.** The dependency-order skip in step 4
   protects every package whose dependency did not make it — and `rigline` no longer declares one
   (D69), so it is the only package that can go up alone. A `rigline` published without the
   `@rigline/core` beside it installs an engine version the registry has not got, on the first
   command anybody runs, and nothing before a user's terminal would say so.
4. `pnpm release:finish`. It approves the batch if it can — in dependency order, so a package whose
   workspace dependency could not be approved is skipped rather than published against a dependency
   the registry never received — then points `next` at this version if the release is ahead of it,
   and creates the GitHub release from the changelog section. Run it again if anything goes wrong
   partway through: every step of it skips what is already done and retries only the rest, so
   running it after approving on the website does exactly the half that is left.

**The version is an increment, not a number you type.** `semver.inc` computes it from what is in the
tree, so there is no second place to get it right. Read what the command prints before it writes:
from a prerelease, all three of `patch`, `minor` and `major` resolve to the same release version —
`1.0.0-alpha.2` plus any of them is `1.0.0`, because that is the version the prerelease was already
aimed at. Use `--preid` to change the identifier; without it, the current one carries forward.

**Which dist-tags move is derived, never chosen** (D61). `next` points at the newest version and
`latest` at the newest version a naive `npm install` should get. So a new alpha goes to `latest`; a
preview goes to `next` once a stable line exists; and a maintenance release goes to `latest` without
disturbing a preview ahead of it. A release on a superseded major is refused by name, because it
belongs on a line tag such as `1.x` and neither tag on offer would be right.

**`next` is not maintained while no stable release exists**, and is unset rather than stale. `latest`
already names the newest of any kind then, so a `next` beside it would say nothing — and saying it
costs one authenticated write per package per release, since `npm dist-tag` cannot batch and each
call wants its own second factor. It comes back on its own when it means something: a preview opens
its line by staging *under* `next`, which publishes to the tag rather than moving it.

**Dry runs go through the Actions tab.** The workflow keeps its `workflow_dispatch` for exactly
that: it builds, tests and packs without staging, which is worth doing after any change to the
pipeline or to the publishers, since its log shows whether every exchange succeeded.

## The three shapes a release comes in

The steps above are the same every time. What changes is which line you are on and what the
version means, and there are only three answers.

### Steady state

`main` is the line `latest` points at, nothing is in preview, and a release is one increment.

    git push                  # and wait for ci.yml to go green on that commit
    pnpm release patch        # or minor; runs lint, typecheck, build and test first
    # watch the run, approve the four on npmjs.com, then
    pnpm release:finish

The version stages under `latest`, and `next` follows it after approval once a stable line exists —
before then it is left unset and there is nothing to authenticate. Nothing else moves, and there is
no branch anywhere. This is the case the whole pipeline is shaped around, and most releases are this.

### A preview line, and the promotion that ends it

Open the line with a `pre*` increment, which sets the identifier the rest of the line carries:

    pnpm release preminor --preid beta     # 1.2.3 -> 1.3.0-beta.0
    pnpm release prerelease                # 1.3.0-beta.0 -> 1.3.0-beta.1

Each of those stages under `next` once a stable line exists, and `latest` does not move. While the
line is open, `main` is the `next` line rather than the `latest` one, and two things follow from
that. A hotfix to the released `1.2.3` needs a `1.2.x` branch cut from its tag, because no
increment from `1.3.0-beta.1` produces `1.2.4`. And only one preview line may be open at a time,
because two of them both want `next`.

**Ending it is a promotion, and a promotion is a release.** The stable version is cut with an
increment like any other, from the same tree the last preview was cut from.

First the changelog, because this is the one release that may have nothing new to say and the
command refuses an empty `## Unreleased`. Write the promotion's own entry and commit it — *`1.3.0`
promotes `1.3.0-beta.1` unchanged* is a true and useful line for somebody reading the changelog on
npm, who otherwise cannot tell whether the stable release differs from the preview they were on —
and the tree has to be clean before the next command anyway. Then:

    pnpm release minor                     # 1.3.0-beta.1 -> 1.3.0

From a prerelease, `patch`, `minor` and `major` all resolve to the version the line was aimed at,
so the argument matters less here than anywhere else. It stages under `latest` and takes `next`
with it, and the shipped code is the code the last beta shipped.

Do **not** reach for `npm dist-tag` to promote. Moving `latest` onto `1.3.0-beta.1` publishes
nothing, leaves `latest` pointing at a prerelease forever, and skips the changelog entry, the tag
and the GitHub release.

### Two lines at once

`main` carries 1.x and a long-lived branch carries the next major (D62). Cut the branch, and open
its line the same way:

    git switch -c 2.x
    pnpm release premajor --preid alpha    # 2.0.0-alpha.0

Nothing in the pipeline is told which line you are on. CI runs on `2.x` as it does on `main`, a
dispatch dry run can check the trusted publishers from it before the first release goes out, and
`pnpm release` reads the version out of that branch's own `package.json`.

Then, while both lines are live:

- Maintenance releases happen on `main`, exactly as in steady state. Each stages under `latest`
  and leaves `next` alone, because the preview on `2.x` is ahead of it.
- Previews happen on `2.x` and stage under `next`.
- Merge `main` into `2.x` after each maintenance release, and never the reverse. `CHANGELOG.md`
  conflicts every time; resolve it by keeping both sides in version order.
- Run `pnpm release:finish` from the line the tag was cut on — it refuses when the tag is not in the
  checkout's history, and this is the case it refuses for: cut `2.0.0-alpha.1` on `2.x`, switch back
  to `main` while CI runs, and approval would publish the right version while every tag below it
  pointed at `main`'s. Carrying on committing to that same line between the cut and the approval is
  fine and expected; nothing in the approval wants the tip.

When `2.0.0` ships it is a promotion, from `2.x`, and it stages under `latest`. After that `2.x`
*becomes* `main`, and `1.x` is cut from the last 1.x tag if the old line still needs support. A
release on that line is then refused by name: it belongs under a line tag such as `1.x`, which
this pipeline does not set, and the two tags it does set would both be wrong.

## Traps, all already paid for

**`latest` does not move unless you publish to it.** A package must have a `latest`, so the very
first publish pins one whatever `--tag` says — and nothing moves it afterwards except another
publish to `latest` or a `dist-tag` change. That stranded `latest` on `1.0.0-alpha.0` here while
`next` went ahead, which mattered because `npm create rigline-plugin` resolves `latest`: the
documented command went on producing a scaffold that a later version had already fixed. While
everything is a prerelease the newest good build should hold both tags, which is exactly what the
derivation gives: `latest` is the newest version a naive install should get, and with no stable
line that is the newest there is (D61). Nothing to set, and nothing to remember.

**A security key is the only second factor you can still enrol, so plan around what it can do.** npm
stopped accepting new TOTP enrolments in September 2025 and is retiring the ones it grandfathered,
which turns "some CLI paths accept only a typed code" from an inconvenience into a wall: there is no
code to type and no way to arrange one. Recovery codes from an earlier enrolment still work wherever
an OTP is asked for, once each, and that is the whole of the fallback.

The npm CLI is the one to reach for when pnpm will not do the browser flow, and it is worth knowing
*why* rather than treating it as a quirk of one command. Every npm write that can need a second
factor goes through one wrapper, `otplease`; its first branch opens a browser when the registry
answers with an `authUrl`, and only its second asks for a typed code. So `npm publish`,
`npm dist-tag` and the rest all complete against a key, and they do it because the registry offered
the flow — not because of `auth-type`, which only `login` and `adduser` read. The same wrapper is
also why none of them work in CI: it re-throws unless both stdin and stdout are a TTY.

`npm stage list` and `npm stage approve <id>` work on stages pnpm created, because the stages live on the registry and do not care which client made them.

npm is meanwhile closing off the alternative on its own account. `npm login` now prints:

    npm tokens that bypass 2FA are being restricted for account changes and direct publishing

Which is the credential-inventory argument above arriving from the other direction: the bypass-2FA
token D46 declined is being taken away regardless.

**`pnpm dist-tag` cannot do 2FA with a security key.** It takes `--otp` and nothing else, so an
account whose second factor is a passkey or Windows Hello — no typed code to give it — gets:

    You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.

pnpm ships browser-based auth somewhere — its `network-web-auth` crate prompts to open a URL — but
neither `dist-tag` nor `stage approve` routes through it, and `--auth-type` is neither a flag nor a
key `pnpm config set` accepts. **Use `npm dist-tag` instead**, which does — for the reason the trap
above gives. This is the whole of the difference: the operation is fine, one client cannot
authenticate it.

**`pnpm stage approve` cannot either, and the website is the answer.** This was written down the
other way round — that approval was the one pnpm path a key *could* take — and the first real
release proved it false: it prompts for a one-time password like `dist-tag` does. Approve at
`https://www.npmjs.com/settings/<user>/staged-packages` instead, which lists what is waiting and
publishes it on a click. A stage lives on the registry and does not care what approved it, so this
is the same operation by another door, and `pnpm release:finish` run afterwards skips the approval
and does the rest.

Publishing to the tag you want is still the better path where there is a choice, because it leaves a
version behind it rather than a pointer with nothing new under it. Moving a tag is for the case that
has no version to publish: a release to `latest` that should carry `next` forward with it (D61),
where the two tags name one version and only one of them can be set at publish time.

**Promoting a preview to stable is not that case**, and it is what somebody arriving at this
section is most likely to be looking for. It has a version to publish — the stable one — so it is
a release, cut with an increment, and the runbook above walks it.

## If something goes wrong

**A staged version you do not want to ship**: do not approve it. It expires. Fix the code, bump
again, stage again.

Do not leave it unwatched, though. The staged-packages page lists everything waiting on the
account, so an unwanted stage sits beside the next release's and can be approved with it by a
careless click. Run `npm stage list` before you approve anything, and make sure what is waiting is
what you mean to ship.

**A version burned by a red run.** The tag and the commit are already pushed, so the number is
spent: the fix is the next version, not this one. What is left behind is a changelog section
headed by a version that never shipped, describing changes that will ship under a different
number. Fold it into the next release's section — move its entries back under `## Unreleased` and
delete the heading — rather than leaving a section on npm for a version nobody can install.

**`[WARN] Skipped OIDC` in the log.** Read this one carefully, because it is a *warning*: pnpm got a
token from GitHub, the registry refused to exchange it, and pnpm carried on unauthenticated. The
failure you then see is about authentication, and says nothing about the publisher that actually
caused it. A 404 from the exchange means the registry has no trusted publisher for that package —
either none is configured, or its repository or workflow path does not match. Before that, check
`id-token: write` is in the job's `permissions`: without it the runner cannot ask GitHub for a token
at all, and there is nothing to exchange.

**A dry run performs the exchange but does not gate on it.** It asks GitHub for a token and offers
it to the registry for every package, exactly as a real stage does; what it skips is the upload. So
the run goes green whether the exchange succeeded or failed, and the green tick is not the signal
— the *absence of* `Skipped OIDC` in its log is. Read the log and a dry run is a genuine check that
every trusted publisher is configured; trust the tick alone and it tells you nothing about any of
them.

**Provenance fails.** It needs the `repository` field to match the repository doing the building,
and a public repository — npm refuses to attest a private one, since an attestation nobody can check
against the source is not an attestation. Trusted publishing itself is unaffected either way. Under
`--provenance` pnpm asks GitHub for a second token with `audience=sigstore`; a failure there is
about the attestation, not about the publish.

**A package was published outside this path.** It installs identically and nothing in Rigline reads
a publishing arrangement as evidence about a package (P6). What it costs is the audit trail, so say
so in the release notes rather than leaving the gap to be inferred.
