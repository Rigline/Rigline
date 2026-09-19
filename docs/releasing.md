# Releasing

Four packages go to npm: `rigline`, `@rigline/core`, `@rigline/plugin-api` and
`create-rigline-plugin`. `@rigline/host` and `@rigline/harness` are `private` and never do.

A release has two halves, and the split is the point. CI **stages**: GitHub Actions authenticates to
npm over OIDC, so no npm credential sits in this repository, and a staged version is one nobody can
install. A person then **approves** it with 2FA, from their own machine. An approved stage says the
owner meant to ship, and nothing more than that (D46).

    pnpm stage publish -r     # .github/workflows/release.yml, from main
    pnpm stage approve        # on your machine, afterwards

`stage publish -r` stages every publishable package whose version is not already on the registry, in
dependency order, replacing each `workspace:*` with the exact version. So bumping one package
releases one package, running it twice stages nothing the second time, and the four are either
internally consistent or they are not published at all. `stage approve` with no arguments lists what
is waiting and takes the batch under a single one-time password.

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

**2. The `@rigline` npm organisation**, for the two scoped packages. The two unscoped names,
`rigline` and `create-rigline-plugin`, are first-come — check both are free before committing to
them.

**3. A bootstrap publish of each package.** A package that does not exist yet can be neither staged
nor trusted-published: there is nothing for the registry to attach a publisher to. So the first
version of each goes up by hand, from your machine, under a granular access token with write on
those four packages and nothing else:

    pnpm publish -r --tag next

The version in the repository is `1.0.0-alpha.0`, and a prerelease goes to a tag that is not
`latest`, so that `npm install rigline` keeps meaning the stable line even before there is one.
Moving a tag later is cheap; un-recommending an alpha that `latest` pointed at is not. The release
workflow asks which tag every time, for the same reason.

**4. A trusted publisher per package**, on npm, under each package's settings. Four entries, all
naming `Rigline/Rigline` and `release.yml`, because npm's OIDC exchange is per package — pnpm asks
`/-/npm/v1/oidc/token/exchange/package/<name>` once for each. Set each one's permission to **stage
only**.

**5. Revoke the bootstrap token.** It has served its purpose, and while it exists the gate is
decoration: there is no org-wide or package-wide switch that *requires* staging, so the gate holds
exactly as long as every credential able to publish is stage-limited. One forgotten full-rights
token silently voids it — for all four packages, without any signal that it has.

That is the one control worth auditing, and it is worth auditing again whenever a token is issued
for anything else. Both kinds support the limit: `Read and write (stage only)` on a granular token,
stage-only permissions on a trusted publisher.

## Cutting a release

1. Run `pnpm test` locally, with the corpus, and read the skips.
2. Bump the version of each package that is going out. Leave the others alone; `-r` skips whatever
   the registry already has.
3. Commit and push to `main`.
4. Run the **Release** workflow from the Actions tab, choosing the dist-tag. `Dry run` builds,
   tests and packs without staging, which is how you check a change to the pipeline itself.
5. Read the run summary: it names each package and version that was staged, because npm returns no
   stage id for the workflow to print and nothing notifies you that a stage is waiting.
6. `pnpm stage approve` on your machine, and give it the OTP.

Approving in dependency order matters and `stage approve` does it for you — a package whose
workspace dependency could not be approved is skipped rather than published against a dependency
the registry never received.

## If something goes wrong

**A staged version you do not want to ship**: do not approve it. It expires. Fix the code, bump
again, stage again.

**The workflow cannot get a token.** `id-token: write` in the job's `permissions` block is what lets
the runner ask GitHub for one; without it the exchange has nothing to send. Then check the trusted
publisher entry matches the repository *and* the workflow path exactly, including a rename of the
file.

**Provenance fails.** It needs the `repository` field to match the repository doing the building,
and a public repository. Under `--provenance` pnpm asks GitHub for a second token with
`audience=sigstore`; a failure there is about the attestation, not about the publish.

**A package was published outside this path.** It installs identically and nothing in Rigline reads
a publishing arrangement as evidence about a package (P6). What it costs is the audit trail, so say
so in the release notes rather than leaving the gap to be inferred.
