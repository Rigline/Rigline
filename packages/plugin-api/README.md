# @rigline/plugin-api

What a [Rigline](https://github.com/Rigline/Rigline) plugin is written against: the plugin context,
the manifest type and its JSON schema, `definePlugin`, and the anchor names.

A plugin is one browser ES module and a `rigline.json`. This package is a **devDependency** — the
build bundles everything the entry imports, so a published plugin has no runtime dependency to
resolve, which is what lets `rigline add` install one without running a package manager.

    npm install -D @rigline/plugin-api

## A plugin

```ts
import { definePlugin, type PluginContext, type Teardown } from "@rigline/plugin-api";

export default definePlugin({
  setup(ctx: PluginContext): Teardown {
    const stop = ctx.watch("footerSpacer", (spacer) =>
      ctx.mountBefore(spacer, () => {
        const badge = document.createElement("span");
        badge.textContent = "hello";
        return badge;
      }),
    );
    return stop;
  },
});
```

```json
{
  "$schema": "node_modules/@rigline/plugin-api/schema/manifest.json",
  "api": 1,
  "name": "hello",
  "description": "A badge in the composer footer.",
  "entry": "dist/index.js",
  "surfaces": ["editor", "sidebar"],
  "uses": { "anchors": ["footerSpacer"], "mount": true }
}
```

## What `ctx` carries

Every capability is declared in the manifest and granted from the declaration, so a plugin reaching
for something it did not declare finds nothing there, and a plugin whose declaration no longer holds
against the installed extension is refused by name rather than failing at runtime.

`cls` and `anchor` for class names; `onMessage` for the bus; `mount`, `mountAfter`, `mountBefore`
and `watch` for the DOM; `style`; `rewrite` and `resend` for outbound messages; `onToolUse` and
`onToolResult`; `onSessionId`; `decorateTranscript`; and `surface`. Anything declared under
`uses.optional` arrives on `ctx.optional` instead, returning null where this extension version does
not have it — so losing a borrowed class to an upstream change costs a plugin some polish rather
than its load.

**Never name a minified identifier.** Class names are `<local>_<hash>` CSS-modules output and the
hash is rebuilt on every upstream build, so reach for a curated anchor name, or `cls(module, local)`
where the table has no entry yet.

## Identifier types

`rigline codegen --out generated.ts` writes the identifiers harvested from *your* installed
extension and augments this package's types with them, so the anchors and message types your editor
actually has are the ones your editor offers you. No published type union doubles as a version pin.

[Authoring guide](https://github.com/Rigline/Rigline/blob/main/docs/authoring.md) ·
[anchors](https://github.com/Rigline/Rigline/blob/main/docs/anchors.md)

MIT.
