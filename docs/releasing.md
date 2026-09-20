# Releasing

Four packages go to npm: `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin`. `@rigline/host` and `@rigline/harness` are `private` and never do.

A release is two commands, both in a terminal:

    pnpm release prerelease   # cut it: changelog, manifests, commit, tag, push
    pnpm release:finish       # when the workflow is green: approve, reconcile `next`

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

**The workflow filename is load-bearing.** Each npm trusted publisher names `release.yml` by path,
so renaming the file breaks the OIDC exchange for all four packages until every entry is edited to
match.

**A release run is a weaker check than a local one.** It runs lint, typecheck, build and the full
Node tier, but the harness tier skips itself there — it needs a corpus snapshot of the extension
bundle, and that lives outside the repository. So run `pnpm test` on a machine that has the corpus
before you dispatch, and read the skips.

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

The version in the repository is a `1.0.0-alpha` prerelease, and a prerelease goes to a tag that is not
`latest`, so that `npm install rigline` keeps meaning the stable line even before there is one.
Moving a tag later is cheap; un-recommending an alpha that `latest` pointed at is not. The release
workflow asks which tag every time, for the same reason.

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

## Cutting a release

1. Run `pnpm test` locally, with the corpus, and read the skips.
2. `pnpm release <increment>` — `patch`, `minor`, `major`, `prerelease`, or one of `prepatch`,
   `preminor` and `premajor`. It computes the version, rolls `## Unreleased` into a section headed
   by it, writes it into every manifest, commits, tags `v<version>` and pushes. Add `--dry-run` to
   see all of that without writing anything.
3. Watch the run the tag triggered. Its summary names each package and version staged, because npm
   returns no stage id for the workflow to print and nothing notifies you that a stage is waiting.
4. `pnpm release:finish`. It approves the batch — in dependency order, so a package whose workspace
   dependency could not be approved is skipped rather than published against a dependency the
   registry never received — then points `next` at this version if the release is ahead of it, and
   creates the GitHub release from the changelog section.

**The version is an increment, not a number you type.** `semver.inc` computes it from what is in the
tree, so there is no second place to get it right. Read what the command prints before it writes:
from a prerelease, all three of `patch`, `minor` and `major` resolve to the same release version —
`1.0.0-alpha.2` plus any of them is `1.0.0`, because that is the version the prerelease was already
aimed at. Use `--preid` to change the identifier; without it, the current one carries forward.

**Which dist-tags move is derived, never chosen** (D61). `next` points at the newest version and
`latest` at the newest version a naive `npm install` should get. So a new alpha goes to `latest` and
takes `next` with it while no stable line exists; a preview goes to `next` once one does; and a
maintenance release goes to `latest` without disturbing a preview ahead of it. A release on a
superseded major is refused by name, because it belongs on a line tag such as `1.x` and neither tag
on offer would be right.

**Dry runs go through the Actions tab.** The workflow keeps its `workflow_dispatch` for exactly
that: it builds, tests and packs without staging, which is worth doing after any change to the
pipeline or to the publishers, since its log shows whether every exchange succeeded.

## Three traps, all already paid for

**`latest` does not move unless you publish to it.** A package must have a `latest`, so the very
first publish pins one whatever `--tag` says — and nothing moves it afterwards except another
publish to `latest` or a `dist-tag` change. That stranded `latest` on `1.0.0-alpha.0` here while
`next` went ahead, which mattered because `npm create rigline-plugin` resolves `latest`: the
documented command went on producing a scaffold that a later version had already fixed. While
everything is a prerelease the newest good build should hold both tags, so release with
`dist_tag: latest` unless there is a stable line to protect.

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

`npm login` prints `Login at:` and one URL, then goes silent while it polls, and does not open a
browser for you — easy to read as a hang. `npm stage list` and `npm stage approve <id>` then work on
stages pnpm created, because the stages live on the registry and do not care which client made them.

npm is meanwhile closing off the alternative on its own account. `npm login` now prints:

    npm tokens that bypass 2FA are being restricted for account changes and direct publishing

Which is the credential-inventory argument above arriving from the other direction: the bypass-2FA
token D46 declined is being taken away regardless.

**`pnpm dist-tag` cannot do 2FA with a security key.** It takes `--otp` and nothing else, so an
account whose second factor is a passkey or Windows Hello — no typed code to give it — gets:

    You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.

pnpm does ship browser-based auth (its `network-web-auth` crate prompts to open a URL, which is how
`pnpm stage approve` works with a key), but `dist-tag` does not appear to route through it, and
`--auth-type` is neither a flag nor a key `pnpm config set` accepts. **Use `npm dist-tag` instead**,
which does — for the reason the trap above gives. This is the whole of the difference: the operation
is fine, one client cannot authenticate it.

Publishing to the tag you want is still the better path where there is a choice, because it leaves a
version behind it rather than a pointer with nothing new under it. Moving a tag is for the case that
has no version to publish: a release to `latest` that should carry `next` forward with it (D61),
where the two tags name one version and only one of them can be set at publish time.

## If something goes wrong

**A staged version you do not want to ship**: do not approve it. It expires. Fix the code, bump
again, stage again.

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
