# __NAME__

Plugins for the Claude Code VS Code extension, built with [Rigline](https://github.com/Rigline/Rigline).

A plugin is one browser ES module and a `rigline.json` manifest. This workspace holds one to start
with; adding a second is a directory copy.

## First run

    pnpm install
    pnpm codegen      # harvest the installed extension, and commit the result
    pnpm build
    pnpm rigline add plugins/__NAME__

Then reload the webview: **Developer: Reload Webviews** in the command palette. The badge appears
in the composer footer.

`pnpm codegen` writes `generated.ts` at this workspace's root: the identifiers the installed
extension actually has, as types every plugin here compiles against. Commit it. It is replaced when
you run against a newer extension, and the diff is how you find out what moved.

## The loop while you work

    pnpm rigline dev plugins/__NAME__

Rebuilds and re-injects on every save. Reload webviews to see each change.

## What a plugin declares

Everything in `uses` is a dependency on the installed extension still having something. An update
that retires one refuses this plugin by name, at install, rather than leaving it subtly broken —
which is the whole reason to declare rather than to reach.

    pnpm rigline check     # what this extension version would refuse, and why
    pnpm rigline list      # every plugin installed, and what each says it can do

Put a dependency you can do without under `uses.optional`: it is checked the same way and costs the
plugin that one decoration rather than the whole plugin.

`elements` is the other half: what the plugin contributes, each with the places it may go and where
it goes by default — or `null` for off. A place this extension version cannot provide costs that
element and nothing else, and `check` says so.

## The plugin policy

**This applies whether or not you ever publish.** A plugin you wrote for yourself and will never
share still runs inside a modification of Anthropic's extension, and Anthropic's terms still apply
to what it does on your machine. Read it once, at
[docs/plugin-policy.md](https://github.com/Rigline/Rigline/blob/main/docs/plugin-policy.md); it
takes a minute.

Rigline modifies Anthropic's extension and publishes a compliance position saying what it does and
does not do. Your plugin runs inside that modification, so the position has to hold for it too.

Most of it is not left to you — the webview has no network egress, no filesystem, and no way into
the extension host, so the usual ways to do harm are absent rather than forbidden. What the policy
asks is the part the architecture cannot cover: do not deceive the person using it, do not reach for
credentials, do not carry conversation content off the machine by a path the closed network does not
cover, and keep any host patch to switching on a capability the extension already has.

## Testing

`pnpm test` runs the pure half — the functions that do not touch the DOM. Whether a decoration
lands in the right place, survives a re-render, or costs a row a line of height is a question only
the app can answer: build, add, reload, look.

`.github/workflows/ci.yml` runs typecheck, build and test on every push and every pull request,
over three Node versions — the same set the release workflow runs, so nothing reaches a release
that a pull request would not already have failed on. Commit `pnpm-lock.yaml`: CI installs what it
says rather than resolving its own.

## Publishing

A plugin is published as an ordinary npm package carrying `rigline.json` and its built entry, and
installed with `rigline add <name>`. Nothing about publishing is special: `rigline-engine build`
bundles everything the entry imports, so a published plugin has no runtime dependency to install,
and both `@rigline/core` and `@rigline/plugin-api` stay *devDependencies*.

`.github/workflows/release.yml` does it from CI, with no npm token stored anywhere: GitHub
authenticates to npm over OIDC, and what the workflow does is *stage* — a version nobody can
install until you approve it from your own machine with 2FA.

    pnpm stage approve

**One field to fill in before the first publish: `repository`.** npm binds a provenance attestation
to it, and this workflow stages with provenance, so a package without one cannot be staged at all.
Nothing can scaffold it for you — a guessed URL would be a wrong one in the registry rather than a
missing one — so the workflow refuses by name, before it builds anything, until it is there:

    "repository": {
      "type": "git",
      "url": "git+https://github.com/you/your-repo.git",
      "directory": "plugins/__NAME__"
    }

`homepage` and `bugs` are worth the same minute; npm shows them on the package page. A `LICENSE`
file is not scaffolded either, because the copyright line is yours to write — the manifest says
MIT, and npm ships a licence file whatever `files` says, so adding one is the whole job. The
`rigline-plugin` keyword is already there: it is how somebody finds a plugin on npm.

Two things to set up once per package, the first time. Publish version one by hand, because a
package that does not exist yet has nothing for a trusted publisher to attach to — `pnpm publish -r
--otp <code>`, supplying a one-time password rather than creating a token, so there is nothing to
store or to revoke afterwards. Then add a trusted publisher in the package's settings on npmjs.com,
naming this repository and `release.yml` by path, with its permission set to stage-only. The
workflow's own header repeats both, where you will be when you need them.

Adding a second plugin later means one more of each: npm's exchange is per package, so a trusted
publisher is too. That is friction on a second plugin, never on a second release — `-r` stages only
what you bumped.

## Rules that will cost you if you break them

- **Never name a class from the bundle by hand.** They are minifier output and change every build.
  Use `ctx.anchor("footerSpacer")` for curated names, and `ctx.cls(module, local)` — declared in the
  manifest — for anything not curated yet.
- **Never scope a stylesheet rule to an anchor's bare class.** One class is applied wherever that
  look is wanted, so a rule written against it lands on every control wearing it. Scope to something
  you placed.
- **Ask what a container does about its children before decorating it.** The composer footer
  measures its own element children and re-measures on any foreign change inside it; footer
  elements go before `footerSpacer`.
- **Keep what you place steady.** An element in the footer whose text keeps changing makes the
  footer re-measure each time, and one in `rigRow` whose height keeps changing re-renders the panel.
- **Do not poll for an element.** `ctx.watch(name, …)` hands it over when it appears and again when
  the app replaces it.
