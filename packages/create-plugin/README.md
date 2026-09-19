# create-rigline-plugin

Scaffolds a workspace for [Rigline](https://github.com/Rigline/Rigline) plugins — plugins for the
Claude Code VS Code extension.

    npm create rigline-plugin my-plugins

## What you get

A pnpm workspace with `plugins/*` and one plugin in it, rather than a single-plugin repository. The
multi-plugin shape scaffolds correctly for one plugin and a second is then a directory copy, where a
single-plugin template could not grow into a workspace without a restructure.

    my-plugins/
      generated.ts              the harvested identifiers, shared by every plugin here
      pnpm-workspace.yaml       with the supply-chain settings written down rather than inherited
      tsconfig.base.json        pulls the root harvest into every plugin's program
      plugins/my-plugin/
        rigline.json            what the plugin declares it needs from the extension
        src/index.ts            the plugin
        src/index.test.ts

Then:

    pnpm install
    pnpm codegen                # harvest your installed extension, and commit the result
    pnpm build
    pnpm rigline add plugins/my-plugin

and *Developer: Reload Webviews*.

`generated.ts` ships as a placeholder so a fresh scaffold typechecks before `codegen` has ever run.
Once you run `codegen` it holds the identifiers *your* extension version actually has; commit it,
and the diff when you run against a newer extension is how you find out what moved.

## Why a workspace root at all

The identifiers are harvested once, at the root, and imported by every plugin in the repository,
because they all compile against the same installed extension. Module augmentation is per-program,
so each plugin's tsconfig has to pull that harvest in — which the shared base config does, and which
is the one ordering dependency in the whole arrangement.

[Authoring guide](https://github.com/Rigline/Rigline/blob/main/docs/authoring.md)

MIT.
