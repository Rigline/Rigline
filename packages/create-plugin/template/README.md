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

## Testing

`pnpm test` runs the pure half — the functions that do not touch the DOM. Whether a decoration
lands in the right place, survives a re-render, or costs a row a line of height is a question only
the app can answer: build, add, reload, look.

## Publishing

A plugin is published as an ordinary npm package carrying `rigline.json` and its built entry, and
installed with `rigline add <name>`. Nothing about publishing is special: `rigline build` bundles
everything the entry imports, so a published plugin has no runtime dependency to install, and
`@rigline/plugin-api` stays a *devDependency*.

    pnpm --filter rigline-plugin-__NAME__ publish

## Rules that will cost you if you break them

- **Never name a class from the bundle by hand.** They are minifier output and change every build.
  Use `ctx.anchor("footerSpacer")` for curated names, and `ctx.cls(module, local)` — declared in the
  manifest — for anything not curated yet.
- **Never scope a stylesheet rule to an anchor's bare class.** One class is applied wherever that
  look is wanted, so a rule written against it lands on every control wearing it. Scope to something
  you placed.
- **Ask what a container does about its children before decorating it.** The composer footer
  measures its own element children and re-measures on any foreign change inside it; footer
  decorations go beside `footerSpacer`, with `ctx.mountBefore`.
- **Do not poll for an element.** `ctx.watch(name, …)` hands it over when it appears and again when
  the app replaces it.
