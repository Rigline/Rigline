# Identifier layers: harvesting what the extension has

Everything a plugin depends on in the extension is a name somebody else chose and rebuilds weekly.
The identifier layers are how Rigline reads those names out of whichever bundle is installed, so
that an extension update is a diff to read rather than a breakage to chase. This is the layer
contract, the five layers, and what to do when you add a sixth. The reasoning is D5 to D11 and D40
in [decisions.md](decisions.md); the code is `packages/core/src/layers/`.

## What may be harvested at all

**P1: anchor only on names that cross a serialisation boundary, or on unminified property names
asserted against the bundle.** A minified local identifier is the bundler's own choice and changes
every build; a CSS-module class, a message type string and a payload key are values the extension
*sends* or *writes to the DOM*, so they are as stable as the behaviour they encode.

The second half of that is the licence the harvest has and a plugin does not. `sendRequest`,
`fromHost` and `processRequestInner` are unminified property names, and the protocol harvest anchors
on them — safely, because codegen asserts every anchor against the bundle in front of it and fails
loudly when one moves. A *plugin* naming one of those would find out at runtime, in a webview, with
a blank panel or a silently dead feature. Build-time assertion and runtime dependency are not the
same risk wearing different clothes.

## The layer contract

```ts
interface Layer<T> {
  readonly id: string;
  readonly describe: string;
  harvest(bundles: Bundles): T;                     // pure, no I/O; throws HarvestError
  readonly views: Record<string, (data: T) => ReadonlySet<string>>;
}
```

`Bundles` is one extension directory read once: `version` (from its `package.json`, never its
directory name), `webview` (`webview/index.js`), `host` (`extension.js`), and `css`
(`webview/index.css`, used only to report unreachable classes, never harvested from).

**A harvest either succeeds or throws.** `HarvestError` names the layer and what it could not find.
There is no partial result, because the failure mode of one is specific and terrible: gutted tables
regenerate, and every plugin is then refused with a confident-looking "unknown class" that points at
the extension when the fault is our regex. The React layer is the exception, below.

**Floors are smoke alarms for the regex, not judgements about the extension.** Each layer carries
minimums well under anything a real bundle has ever held — 30 modules and 300 classes against a real
104 and 1009; 60 outbound requests against a real 97 to 111. A bundle that changed shape enough to
defeat a pattern trips them; a bundle that merely got smaller does not. When you tighten a pattern,
check the floor still sits under every corpus version and well under the count you measure.

**Views are the unit of reporting.** A layer projects its harvest onto flat identifier sets, named,
because "a module was retired" and "a local name was renamed" are different news, and a reply-only
regression diluted into a message-type percentage reads as nothing having happened.

## The five layers

### `classes` — the CSS-module class map, with application counts

The webview's CSS modules are compiled ahead of time, so the bundle carries the mapping as a plain
object literal per module: `{modelPill:"modelPill_gGYT1w",modelPillRow:"modelPillRow_gGYT1w"}`. The
hashed string is what reaches the DOM, so harvesting it anchors on the bundle's own output.

Grouped by the six-character hash, never flattened, because a local name is not unique — `tab` is
defined by more than one module (D6), and a flat map would resolve the wrong one in silence.

The same pass counts **how many places the bundle applies each class** (D7), because a class names a
look and not a thing: knowing a class exists says nothing about whether it names one control or
three. Two passes over the same bytes — find the variable each module's map is bound to, then count
property accesses on those variables in one alternation. The count is approximate in both directions
and deliberately biased: it counts a class handed somewhere as a value, and it cannot see a
destructured read. Over-counting asks for a refinement that may not be needed, by name.
Under-counting would pass an ambiguous anchor silently.

A module whose variable was not found goes in `uncounted` rather than being reported as zero sites.
"No sites" and "not counted" lead to opposite verdicts, and an unknown read as one site is exactly
the pass this layer exists to stop.

Views: `classes` (full hashed names, the one view a manifest can name directly), `modules`,
`locals`, and `reused` — every class applied at more than one site. `reused` is the only view whose
members can move without any identifier having changed, and it is the ambiguity early warning:
`modelPill_gGYT1w` crossed from one site to two in 2.1.269, which is the release the agent-map
button arrived in.

### `protocol` — the four directions

The webview talks to the extension host over `postMessage`, and every message type is written down
at exactly one of four sites: `sendRequest({type:…})` for a correlated request, `send({type:…})` for
a bare notification, the `for await (… of this.fromHost) switch(…)` loop for inbound pushes, and
`processRequestInner(…){switch(…)` for inbound requests.

The harvest anchors on those four sites rather than scanning for `type:"…"` generally (D8), because
that scan pulls in every other protocol sharing the JSON shape — markdown AST node types, Zod issue
codes, MCP tool names, the Anthropic streaming events nested inside `io_message` — and still misses
every inbound request type.

Both switch walks track brace depth and are string-literal aware, so a nested switch's cases sit at
depth 2 and fall out by construction, and a brace inside a string cannot perturb the walk. The
inbound-request anchor is the `Inner` method, not its caller: the caller only sets up an
`AbortController` and delegates, so anchoring there would mean stepping over a function body and
would latch onto some other switch if the delegation were ever inlined.

`request` and `response` are envelope wrappers rather than message types. A plugin may tap either —
both travel the same bus — but their fields are correlation state, which is why the fields layer
never lets one be declared. See [bus.md](bus.md).

### `fields` — declarable outbound payload fields

One level under the protocol: the field names of every outbound payload, walked from the same two
send-site patterns, tracking `{`, `(` and `[` so that `args:f(a,b)` and `opts:{x:1,y:2}` are each
one entry.

**Intersected across send sites, never unioned** (D10). A field present at one site of three is not
present in every message of that type, and the host refuses to apply a patch to a field the message
does not carry. A site with a `...spread` or a computed key marks the type `partial`: its list is a
lower bound, and the generated file says so in a comment.

The asymmetry is the point. Reads never declare fields, because a missing read degrades visibly as
`undefined`. Writes always do, because a missing write lands on nothing, in silence.

### `replies` — the reply types reachable from this webview

Reply type names exist only in the extension-host bundle, nearly all as `{type:"…_response"}`
literals. Not every literal there is reachable from here: `control_response` belongs to the CLI's
own control protocol, and `get_auth_status_response` has a handler with no sender in this webview.
Declaring either would tap nothing, silently.

So a reply is declarable exactly when this webview sends the request it answers, and the set is
*derived* from the request side by naming convention (D9) — `x` to `x_response`, with the
`x_request` to `x_response` and `get_x` to `x_response` exceptions — rather than taken wholesale
from the host bundle. Scanning forward from a host dispatch case to the literal that follows was
tried and mispairs: a case that delegates to a method has no literal of its own, so the scan runs
into the next case.

This layer's floor is a fraction rather than a count, because it measures a relationship between two
harvested sets: at least half the outbound requests must pair. An absolute floor would encode
today's protocol size and fire on every smaller fixture.

### `react` — asserted, not collected

The transcript capability rests on react-dom's devtools integration: the global hook name,
`supportsFiber` and `isDisabled` (which react-dom checks before accepting a hook),
`onCommitFiberRoot`, `findFiberByHostInstance`, and `memoizedProps`.

None of those is a class or a message type, so nothing else in the system could notice one moving,
and every one of them fails *silently* — a capability that quietly resolves no rows. So this layer
asserts each literal against the bundle and names what breaks when one is absent (D11). It also
reads react-dom's version, anchored beside `rendererPackageName:"react-dom"` rather than searched for
alone, because `version:"…"` is not a safe anchor in a bundle this size.

It never throws. What is missing goes into the tables as `react.missing`, and the transcript's
contract turns each entry into a refusal of the plugins that require it. Every other plugin loads,
because nothing else rests on react-dom's internals (D102). What makes the other layers throw
doesn't apply here: this is a list of named assertions, not a pattern that could quietly match less.
The corpus tests are what fail loudly when one of them stops holding.

`__REACT_DEVTOOLS_GLOBAL_HOOK__` is spelled literally twice — here and in `pre.ts`, which is
statically imported and so cannot read a generated table — and a test holds the two spellings to
each other.

## The anchor table, on top

The anchor table is curated rather than harvested: a stable name to a module-scoped class plus what
tells its element apart from anything else wearing that class. It resolves against the class layer's
harvest, per extension directory, at install time, and the answers are written into `generated.js`
as data — the anchor a plugin asks for at runtime is looked up, never recomputed.

Two resolved forms, because an anchor is used two ways (D7). A `style` anchor is borrowed, so it
resolves to a bare class, which is what `ctx.anchor()` returns. An element anchor is *queried*, so
it also resolves to a CSS selector: the class, plus whatever `refine` adds, under whatever `within`
names. A `singleton` whose class the bundle applies in more than one place with nothing to tell them
apart does not resolve at all — absent beats wrong (P8) — and the reason travels with the refusal.
[anchors.md](anchors.md) is the reference, written for somebody repairing one.

## Codegen: two renderings of one harvest

`generate(harvest, anchorTable?)` produces both from one object.

**`generated.ts`**, committed — at this workspace's root, and at an author's (D40, D50). It augments
`@rigline/plugin-api`'s empty `RiglineIdentifiers` with the extension's own vocabulary, so
`ctx.cls("gGYT1w", "modelPill")` and `ctx.onMessage("rename_tab", …)` are checked while you type.
Delete it and everything still compiles, every union widening back to `string` — which is what lets
a freshly scaffolded plugin build before codegen has ever run. It imports nothing, deliberately: it
sits outside any package, and a relative import out of one is the first thing to break when an
author moves it. Beside the augmentation it carries `EXTENSION_VERSION` and `SCAN`, the harvest
reduced to its layer views, which is the baseline the install flow diffs the next version against
(D29).

No harvested *types* are published. A published snapshot could never carry the version released
tomorrow, and a type union doubling as a version pin is the version matrix D40 exists to refuse.

**`generated.js`**, written per extension directory beside the loader, carrying the full tables as
data — the checks at load are made against data, not types.

Every union is emitted one member per line, so a class added upstream is one added line in a diff
rather than a reflowed block. Codegen is byte-stable under `--check`.

One guard fires here rather than in the layer: a stylesheet module the class map has only *partly*
is a `HarvestError`. A whole module the stylesheet defines and the map lacks is ordinary — markup
this build does not contain, tree-shaken without touching the CSS output — but a partial one means
the class harvest is dropping pairs from a module it otherwise reads, which would refuse plugins
over classes that exist.

## The stability diff

`diffScans(from, to)` compares two scans view by view: what is gone, what arrived, and what fraction
survives. **The percentages are for reading, not for gating.** Roughly one class name in sixteen
goes missing over a couple of months of releases, nearly all of them names nothing depends on. What
gates an install is whether something a plugin *declared* has gone, which is a question for the
declaration check, asked of the installed bundle alone (D28).

`successorSuggestions` names a likely replacement, and only where naming one is more than a guess
(D45). The only signal used is "same module" — no similarity score, no edit distance. A module that
lost exactly one name and gained exactly one gets a named pair; a module that changed by more than
one on either side gets a count and a pointer, because naming *a* pair there would be wrong as often
as right. A module that only lost names, or only gained them, produces nothing: that is a retirement
or an addition, not a rename.

Only `classes.classes` is grouped this way, and that is stated by name rather than sniffed from the
identifier shape. The react layer's own `__REACT_DEVTOOLS_GLOBAL_HOOK__` ends in six word characters
after an underscore and would parse as a local name in a fictitious module — the same coincidental
match the class harvest already guards against.

## Adding a layer

1. A module in `core/src/layers/` implementing `Layer`, with `defineLayer` so `views` type-check
   against `harvest`'s return.
2. Derive every pattern against a real bundle from the corpus, and **bound every regex**. A
   stringified record is one line; `.*` and `(.+?)` cross into unrelated fields. Match a string in
   any of `"`, `'` and `` ` ``, because the minifier chooses the quote (D101). `minifier.test.ts`
   holds every layer to that without being told about a new one.
3. A floor under every corpus version's count, with a message that says the anchor moved rather than
   that the extension shrank.
4. Views named for what a report would say about them.
5. An entry in `LAYERS` and a field on `Harvest` in `layers/index.ts`, plus a line in `scanOf`'s
   data map.
6. Tests both ways: synthetic fixtures pinning the pattern's edges, and the corpus proving it still
   reads a real bundle. See [verification.md](verification.md).

Nothing else enumerates the layers. If you find yourself adding a third place that lists them, the
registry has a hole in it.
