# Writing a Rigline plugin

A plugin is one browser ES module and a `rigline.json` manifest. It runs inside the Claude Code
panel, in the app's own realm, and adds something to it: a decoration on a row, a badge in the
footer, a change to a message on its way out.

This is the guide to writing one. [anchors.md](anchors.md) covers the names you target UI by, and
repairing one that breaks; read it when something stops resolving.

## Start

    pnpm create rigline-plugin my-plugin
    cd my-plugin
    pnpm install
    pnpm codegen
    pnpm build
    pnpm rigline add plugins/my-plugin

Then **Developer: Reload Webviews**. The scaffolded plugin puts a small badge in the composer
footer; replace its body and keep its shape.

While you work, `pnpm rigline dev plugins/my-plugin` rebuilds and re-injects on every save. Each
change still needs a webview reload — nothing can avoid that.

## The two files

`rigline.json` is what the installer reads, as data, without running a line of your code:

```json
{
  "$schema": "../../node_modules/@rigline/plugin-api/schema/manifest.json",
  "api": 1,
  "name": "my-plugin",
  "description": "What it does, in a sentence somebody will read in a list.",
  "entry": "dist/index.js",
  "surfaces": ["editor", "sidebar"],
  "elements": {
    "hello": {
      "title": "Hello",
      "placements": [{ "anchor": "footerSpacer", "at": "before" }, "rigRow"],
      "default": { "anchor": "footerSpacer", "at": "before" }
    }
  }
}
```

`src/index.tsx` is the module:

```tsx
import { definePlugin, type PluginContext } from "@rigline/plugin-api";
import { Pill } from "@rigline/plugin-api/ui";

export default definePlugin({
  setup(ctx: PluginContext) {
    return ctx.element("hello", () => <Pill>hello</Pill>);
  },
});
```

`setup` runs once per panel. What it returns is torn down when the plugin is disabled or the panel
goes away; everything `ctx` hands you returns its own teardown, and returning one that calls them
all is the shape to keep.

## `uses` is a dependency list

Every key under `uses` names something you need the installed extension to still have. That is the
whole of its job, and the reason to fill it in honestly.

The extension updates about weekly. When an update retires something you declared, the install says
so, by identifier, and refuses **your plugin** rather than letting it half-work:

    2.1.271 refuses "my-plugin": anchor "worktreePill" (OOQiHg.worktreePill) is not in this extension

That message is also your bug report. A plugin that reached for things without declaring them gets
no such message; it just stops doing something, and the person running it has no idea why.

Run `pnpm rigline check` to ask the question without installing anything.

### Surfaces

`surfaces` names the webviews your plugin is for, and absent means all of them. There are three:
`editor` (the full panel), `sidebar` (the same panel, narrow), and `sessionList` (the list of
sessions). `ctx.surface` tells you which one you are in.

They are not the same page. The session list has no composer, so no composer footer and no
`footerSpacer` to hang anything from: a plugin that wants a badge there mounts on `document.body`
and positions it itself. A plugin that decorates the transcript belongs in `editor` and `sidebar`
and should say so, rather than loading into a surface with no transcript.

**If none of your plugin works on a surface, say so here.** That is what this key is for, and it is
the difference between `inactive`, which is not a failure, and a plugin that loaded and can do
nothing. If only *part* of it does not apply, you need nothing: the anchor table records which
surfaces each anchor renders on, so `ctx.watch` for one this surface has not got watches nothing and
tears down cleanly, exactly as an optional anchor this extension has not got does.

### Optional dependencies

A dependency you can do without goes under `uses.optional`, which mirrors `uses` key for key:

```json
"uses": {
  "anchors": ["footerSpacer"],
  "optional": { "anchors": ["worktreePill"] }
}
```

It is checked the same way and reported the same way, and costs you that one decoration instead of
the whole plugin. Resolve an optional name through `ctx.optional.anchor()`, which returns
`string | null` so the compiler makes you handle the absence.

### The capabilities

| key | what it grants |
| --- | --- |
| `anchors` | `ctx.anchor(name)` — the class a curated name resolves to |
| `classes` | `ctx.cls(module, local)` — a raw module-scoped class, for UI nobody has curated |
| `messages` | `ctx.onMessage(type, fn)` — a tap on the bus, either direction |
| `mount` | `ctx.mount`, `ctx.mountAfter`, `ctx.mountBefore`, `ctx.watch` |
| `style` | `ctx.style(css)` — a stylesheet, removed on teardown |
| `rewrites` | `ctx.rewrite(type, fn)`, `ctx.resend(type)` — change an outbound message |
| `tools` | `ctx.onToolUse`, `ctx.onToolResult` |
| `session` | `ctx.onSessionId` |
| `transcript` | `ctx.decorateTranscript` |
| `menu` | `ctx.menu(Component)` — a React component in Rigline's menu, behind the RIG pill |

Calling one you did not declare throws and disables the plugin. That is deliberate: a declaration
you can forget is a declaration the install cannot check. `rigline install` scans your built source
and says so when the two disagree, in either direction.

Two members of `ctx` are on it without a declaration, because neither widens what you can reach:
`ctx.surface`, which is a string, and `ctx.check`, below. `ctx.element` is declared by `elements`
rather than by `uses`, also below.

### React, and state that outlives a component

`ctx.menu` takes a React function component. Write it in a `.tsx` file with `react` and
`@rigline/plugin-api/ui` imported as usual; the panel serves both, one copy for every plugin, so
`rigline-engine build` leaves them out of your bundle. A component that throws while rendering
disables your plugin and leaves the menu to everyone else.

Ordinary UI state is `useState`. Two kinds of state are not: state your components share with
anything outside them, and state from the panel's startup, which an effect in a component runs too
late to catch. Put those in a store made in `setup` and read it with `useStore`:

```tsx
import { definePlugin, storeFrom } from "@rigline/plugin-api";
import { MenuItem, useStore } from "@rigline/plugin-api/ui";

export default definePlugin({
  setup(ctx) {
    const sessionId = storeFrom(ctx.onSessionId, null);
    ctx.menu(() => <MenuItem label="Session" description={useStore(sessionId) ?? "none yet"} />);
  },
});
```

### Building a menu entry

Build what you add to the menu from `@rigline/plugin-api/ui`'s components, which draw in the app's
own colours and work from the keyboard alongside every other plugin's entries:

- `MenuItem` — `label`, an optional `description`, and `onSelect`. Choosing it closes the menu
  unless `onSelect` calls `event.preventDefault()`, which is what you want for a copy that flashes
  "copied", or a toggle whose check should visibly change. Give it `checked` and it becomes a
  checkbox, with a check on the right while `checked` is true.
- `Submenu` — a `label` and children. Choosing it shows the children in place of the menu, under a
  row that leads back. The children can be items, notes, further submenus, or any content of your
  own.
- `MenuNote` — a line of text that is not an item, for "nothing here yet".

Your entries sit together, in the order you called `ctx.menu`, with a divider between your plugin
and the next. They mount when the menu opens and unmount when it closes, so an effect in one costs
nothing while the menu is shut, and anything that must survive closing it belongs in a store.
A throw in `onSelect` disables your plugin, as a throw while rendering does.

```tsx
import { definePlugin, store } from "@rigline/plugin-api";
import { MenuItem, useStore } from "@rigline/plugin-api/ui";

export default definePlugin({
  setup(ctx) {
    const shown = store(true);
    shown.subscribe(() => {
      /* switch the feature on or off */
    });
    ctx.menu(() => {
      const on = useStore(shown);
      return (
        <MenuItem
          label="Show the thing"
          checked={on}
          onSelect={(event) => {
            event.preventDefault();
            shown.set(!on);
          }}
        />
      );
    });
  },
});
```

## Elements

Something you add to the panel itself — a badge in the footer, a line under the composer — is an
element. Declare each under `elements` in `rigline.json`, as in the example above, and render it with
`ctx.element(id, Component)`:

- `title` is what the element is, for a person deciding where it goes.
- `placements` is every place it may go: a zone, or a slot `before`, `after` or `inside` one element
  the anchor table names. The one zone so far is `rigRow`, a row at the foot of the composer box,
  under its controls, which appears only while something is in it.
- `default` is where it goes until the person using it says otherwise: one of `placements`, or
  `null` for off. Every element states one, so off is a choice rather than something forgotten. A
  fresh install should show something; that is yours to see to.

Rigline places the element, keeps it placed across re-renders, and renders your component there in
a boundary of its own, so a throw while rendering disables your plugin and nothing else. A place
this extension version cannot provide costs that element and nothing else, and the install and the
diagnostics panel say which; its anchor is not repeated under `uses`. An element you declare and
never bind is a failing line on the diagnostics panel.

Each element renders in a form of its own. The composer box and its footer are inside the
composer's form, where a button with no type would send the prompt; yours cannot. `Pill` from
`@rigline/plugin-api/ui` is the small label the composer's rows are made of, and a button when
given `onClick`.

Keep what you place steady. An element in the footer whose text keeps changing makes the footer
re-measure each time, and one in `rigRow` whose height keeps changing re-renders the whole panel.

`ctx.mount*` still places plain DOM, and is the tool for decorating every row of something, where
there is no single place for an element to be.

## Say when you are working: `ctx.check`

Your plugin's characteristic failure is silent. An extension update, a class that moved, a message
that changed shape — and it stays loaded, declared, styled, and drawing nothing, while every other
line in the diagnostics panel says it is fine. `ctx.check` is where you say what working looks like,
so that a red badge naming your plugin replaces a green one and a feature nobody noticed going.

```ts
ctx.check("marks are being placed", () => {
  if (!enabled) return { verdict: "n/a", detail: "switched off" };
  if (rowsSeen === 0) return { verdict: "n/a", detail: "no transcript rows yet" };
  if (rowsMarked > 0) return { verdict: "pass", detail: `${rowsMarked} of ${rowsSeen}` };
  return { verdict: "fail", detail: `${rowsSeen} rows, none carried a time` };
});
```

It declares nothing, and the host hands it nothing, because nothing needs handing in: your own
bookkeeping is in scope, and so is your own `ctx`, so a check that asks whether your anchor still
resolves calls `ctx.anchor()` inside the closure.

Three things are worth knowing.

**`n/a` is a real verdict, not a soft failure.** A plugin the user switched off is not one that is
failing, and a badge that goes red for a deliberate choice teaches people to ignore the badge. Say
`n/a` with the reason, which is more use to a reader than a green line meaning the same thing.

That includes *not yet*. Your check runs from the moment `setup` returns, before the host has handed
you an element, so a check that goes straight to `fail` when your decoration is not on screen is red
for the first second of every panel. Say `n/a` until you have been given something to decorate.
Whether an anchor that should have appeared never did is not your question — `core`'s
*mount: watches have found their element* owns it, has a clock, and waits before it fails.

**A check reads; it does not compute.** The host calls it about once a second for the life of the
window, whether or not anybody has the panel open, because the failing count is always on the badge.
Walking the DOM or re-deriving an answer here is work done every second for nobody. Count as the
events happen — a `rowsSeen++` where the row is already being handled — and have the check read the
counter.

**A check that throws costs you the line, not the plugin.** It shows as a failing line naming your
plugin, with the message as its detail, and nothing is torn down: a broken sentence about a feature
is not evidence against the feature. So there is no reason to be defensive in one, and no reason to
wrap it in a `try`.

Ask the question only your own state can answer. Whether the host derived a session id, whether
mounts are being re-placed and whether the anchor table still resolves are already lines under
`core`; what nothing else can say is whether *your* plugin turned any of that into what it promised.

## What you may do, and what is asked of you

A plugin runs in the app's realm with full DOM access and can read every message on the bus. That
is the same trust a VS Code extension asks for, and it is written down rather than dressed up:
installing a plugin is the act that says yes, and nothing after it asks again. `rigline list` and
`rigline add` print what a manifest declares so the person installing yours can read it.

What the system adds is shape rather than restraint. A read tap is handed a frozen clone and cannot
write. A rewrite is a patch over declared fields of a message the app already chose to send, and the
app's message reaches the extension host whatever you do. One plugin's failure never costs another
its load. And every host patch is reversible from the backup without anybody having predicted
anything.

Some of the shape is hard enough to be worth knowing you have. The webview's CSP is `default-src
'none'` with no `connect-src`, so no plugin can make a network request, read a file or reach the
extension host — not because we forbid it but because the egress is absent. Nothing runs at install
time. A host patch is not code: it is a declared equal-length byte substitution the installer
applies.

What that leaves is the part no boundary covers, and it is
[plugin-policy.md](plugin-policy.md) — one page, worth the minute. Rigline modifies Anthropic's
extension and publishes a [compliance position](anthropic-compliance.md) about what it does and does
not do; your plugin runs inside that modification, so the position has to hold for it too. In short:
do not deceive the person using it, do not reach for credentials, do not carry conversation content
off the machine by a route the closed network does not cover, and keep a host patch to switching on a
capability the extension already has. Anthropic's terms apply to your plugin as they apply to us,
and publishing has nothing to do with it: a plugin you wrote for yourself and will never share
modifies their extension exactly as much as a published one does.

We do not review plugin source and do not claim to — the policy is a statement of obligations, not a
filter, and it says so.

## Four rules that will cost you

**Never name a class from the bundle by hand.** They are minifier output — `modelPill_gGYT1w` —
and the hash changes on every upstream build. Use `ctx.anchor("footerSpacer")` for a curated name,
or `ctx.cls(module, local)` for UI that has none yet. Both are declared, so both are checked.

**Never scope a stylesheet rule to an anchor's bare class.** A class names a look, and the
extension applies a look wherever it wants one: `modelPill_gGYT1w` is on the model picker *and* on
the agent-map button. A rule written against it lands on both. Scope every rule to a class you put
on an element you placed.

**Ask what a container does about its children before decorating it.** The composer footer sums the
widths of its own element children to pick one of three fit stages, and resets that measurement on
any foreign change inside it — so a decoration there is part of the layout decision *and* a trigger
for it. Footer elements go before `footerSpacer`, and so do plain decorations, with
`ctx.mountBefore`. A decoration anchored
instead to the model pill, which the widest stage moves out of the footer, oscillates at one cycle
per frame and makes the composer unclickable.

**Do not poll for an element.** `ctx.watch(name, onFound)` hands it over when it appears and again
whenever the app replaces it, through one observer shared by every plugin. `ctx.mount*` keeps your
node in place across a re-render without rebuilding it, so a reference you keep stays good.

## Generated types

`pnpm codegen` writes `generated.ts` at your workspace root: a module augmentation naming every CSS
module, class, message type and payload field the installed extension has. Commit it. With it,
`ctx.cls("gGYT1w", "modelPill")` and `ctx.onMessage("rename_tab", …)` are checked at your desk
rather than at install time.

Nothing harvested is published, and there is no version matrix to pick from: the file describes the
extension *you* have, and the next person's `rigline codegen` describes theirs. Delete it and
everything still compiles, with every identifier widened back to `string` — the narrowing is
ergonomics, and the contract is the install-time check on the user's machine.

Re-run it after an extension update and read the diff. That is the fastest way to find out what
moved.

## Testing

Three tiers, and knowing which one a question belongs to is most of the work.

- **Pure functions**, under plain `vitest`: formatting, parsing, anything that does not touch the
  DOM. Export them and test them. This is the tier the scaffold ships an example of.
- **The real app.** Whether a decoration lands in the right place, survives a re-render, or costs a
  row a line of height is a question about the extension, and only the extension can answer it.
  Build, add, reload, look — and read your own line in the diagnostics panel, which is the part of
  that loop you do not have to remember to do.
- **`rigline check`** for the question in between: does everything this plugin declares still exist
  in the version in front of me.

## Shipping

A plugin is an ordinary npm package carrying `rigline.json` and its built entry:

```json
{
  "name": "rigline-plugin-my-plugin",
  "keywords": ["rigline-plugin"],
  "files": ["dist", "rigline.json"],
  "repository": { "type": "git", "url": "git+https://github.com/you/your-repo.git" },
  "devDependencies": { "@rigline/core": "^1.0.0", "@rigline/plugin-api": "^1.0.0" }
}
```

`@rigline/plugin-api` stays a **devDependency**: `rigline-engine build` bundles everything your
entry imports, so what you publish has no runtime dependency for anyone to install. The exception is
React — `react`, `react/jsx-runtime`, `react-dom` and `@rigline/plugin-api/ui` — which the panel
serves, one copy for every plugin: the build leaves those imports as they are, and `rigline install`
points them at the panel's copy. Any other package you import must be bundled. Rigline runs no
package manager when it installs your plugin — it fetches the tarball, checks it against the
registry's integrity hash, unpacks it and validates the manifest.

`@rigline/core` is the other devDependency, and it is the engine: it carries `rigline-engine`, which
is what your `build` and `codegen` scripts run. Never `rigline` — that is the layer a *user*
installs to fetch the engine, and a workspace that can declare a dependency has no use for it.

Two of those fields are not decoration. `keywords` carries `rigline-plugin` because that is how
somebody finds a plugin on npm; nothing in Rigline reads it. `repository` is there because npm
binds a provenance attestation to it, so a package without one cannot be published with provenance
at all — the release workflow `create-rigline-plugin` scaffolds refuses by name before it builds
anything, rather than letting you find out two minutes into your first release.

Your users install it with `rigline add rigline-plugin-my-plugin` and keep it current with
`rigline update`. A published version has to be a day old before either will take it, which is
where a compromised publish is usually caught; `--now` overrides it, and a withheld version is named
rather than hidden.

The package name and the plugin name need not match. The manifest owns the plugin's name, and that
is what its directory, its registry entry in `config.json` and every report call it.

## When an update breaks something

Two kinds of breakage, and only one of them is yours.

**An anchor stopped resolving.** That is the anchor table's problem, not your plugin's, and it can
be repaired on a user's machine in minutes without a release from anybody — see
[anchors.md](anchors.md). Report it; it gets curated.

**Something you declared is gone** — a message type, a payload field, a raw class pair. That one is
yours: the install names it, and the fix is a new build. Raw `ctx.cls()` pairs are counted per
plugin at install for exactly this reason, because no table fix reaches them.

There is a third kind that neither of those catches, and it is the one `ctx.check` exists for:
everything you declared still resolves, the install is clean, and the feature has stopped working
anyway, because the shape of something you read changed without its name changing. Nothing at
install time can see that. Your own check can.

Backward compatibility is deliberately not a thing here. A plugin ships one build, and per-version
variants would ask you to predict a release that does not exist yet.
