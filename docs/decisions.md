# Decisions

The durable record. Principles are the rules the architecture is derived from; decisions are
choices made under them. Amend by editing the entry and noting the date; the file should read as
what is true now, never as a history of what was once true.

A decision's number is its identity, not its position: source comments cite them, so a new entry
takes the next free number and sits in the section it belongs to, and numbering runs monotonically
within a section rather than down the file.

Measurements cited here were taken during the 0.x investigation across extension versions 2.1.200
to 2.1.268 and are documented in [archive/0.x/](archive/0.x/README.md). Treat them as indicative
and re-measure before quoting one as current.

## Principles

**P1. Anchor only on names that cross a serialisation boundary.** CSS-module class names, JSON
field names, unmangled property names. Never a minifier-chosen identifier, in any layer, for any
reason. Build-time harvesting may anchor on unminified property names (`sendRequest`,
`processRequest`, `memoizedProps`) because codegen asserts every anchor against the pinned bundle
and fails loudly; a plugin may not, because its failure is a blank panel with no attribution.
Match shapes, never a particular identifier: `processRequest($)` in one build is
`processRequest(e)` in another.

**P2. Declared dependencies are enforced, not trusted, and enforcement means identifiable and not
merely present.** The manifest is data, read without executing the plugin, checked against what the
installed extension contains, and a plugin whose declaration does not hold is refused by name with
the specific missing identifier. A capability that hands over derived state still declares what the
host taps for it, so a retirement upstream refuses the plugin instead of leaving a handler that
never fires. Proving an identifier *exists* is the easy half and was for a long time the only half:
a CSS-module class names a look, not a thing, so a check that stops at existence will pass a name
that points at two different controls and let a plugin decorate the wrong one in silence (D7).

**P3. One plugin's failure never costs another plugin, or the loader.** Refusal at load, isolation
at runtime, and an install that reports a plugin problem and injects around it. What blocks an
install is only what makes injecting itself wrong: a collapsed harvest, or a failure in Rigline's
own build.

**P4. Reads are immutable; writes are declared, patch-shaped, outbound and synchronous.** A tap is
handed a frozen deep clone. A rewrite returns a patch over declared fields of a message the app
chose to send, applied by the host, composed in registry order, and the app's message reaches the
extension host whatever a plugin does.

**P5. A derived value is null when unknown, never approximated.** The host owns a derivation when
getting it wrong is silent. A plausible substitute is worse than an absence because the consumer
cannot tell them apart.

**P6. The plugin contract is an output, not a toolchain.** One browser-target ES module plus a
manifest. A convenience build preset is shipped; "plugins are built with X" is never published.

**P7. Version-specific data is derived where it is installed, never shipped.** The payload is one
prebuilt pair that fits any version; the identifier tables beside it are harvested from the
bundle being patched, per installed directory. There is no version matrix. The same holds for the
identifier types an author compiles against, which is why none are published (D40).

**P8. Loud beats silent, and absent beats wrong.** Every failure mode must be attributable to a
plugin or to a named anchor. A feature that is cleanly missing is preferred to one that is subtly
wrong. Where a check cannot be made loud, the reason is written down beside it.

## Decisions

### Injection and boot

**D1. Injection is two lines added to the installed `webview/index.js`.** A static `import` at the
head, which runs before the app boots, and a dynamic `import()` at the tail, which runs after
`createRoot().render()`. Neither names a minified identifier, so the patch is version-independent.
Module scripts propagate their nonce to imported descendants, which is what lets the CSP admit it.

**D2. Only Rigline's own pre hook is in the static import.** A throw there fails the module graph
and the panel renders blank with no attribution. Plugins load after boot, dynamically, each in its
own try/catch.

**D3. The pre hook wraps `acquireVsCodeApi`, taps both directions, buffers the startup exchange
and replays it to read taps that register late.** Without replay a plugin misses the boot exchange,
which is where session and worktree state arrives. The buffer is sealed when plugin loading
completes, so it is bounded by boot traffic rather than growing for the life of a panel created with
`retainContextWhenHidden`. Replay is for reads only; a rewrite applies from registration forward.

**D4. Every installed extension version is patched, each with tables harvested from its own
bundle.** An update installs a new directory beside the old one and VS Code keeps serving the old
one to windows already open, so patching only the newest reads as the install having silently
failed.

### Identifier layers

**D5. Identifier layers are an open registry in core.** Each layer supplies a harvest, a floor that
guards the harvest's own regex, a diff and a declaration check. Initial layers: CSS-module classes,
the protocol in four directions, outbound payload fields, host replies, React internals. Adding a
layer is one module; nothing else enumerates them.

**D6. Class names resolve module-scoped, through a map harvested from the bundle, never through
substring selectors.** Local names collide across modules (`tab` lives in two), so a flat map
silently resolves the wrong one. The map is grouped by the six-character hash suffix, which is the
module identity and has never been observed to change while the module survives.

**D7. A curated anchor table maps stable names to module-scoped classes, refined where a class is
not an identity, and is the primary way a plugin targets UI.** `modelPill` rather than `("gGYT1w", "modelPill")`. The update flow validates
the table once per extension version; a retired anchor refuses only the plugins that use it. Raw
`cls(module, local)` stays as the escape hatch so curation never blocks an author. Confirmed by
Leo 2026-09-13. It is also the only thing that can repair a plugin whose author has not touched it,
which is what makes curation load-bearing rather than cosmetic (D44).

**A class names a look, not a thing (amended 2026-09-14).** `modelPill_gGYT1w` is on the model
picker *and* on the agent-map button, because both are pills and sharing a pill style is what a
style is for. `watch` resolved the class and took the first match, so three first-party decorations
spent an afternoon glued to the agent map — passing every check, including the probe's own ordering
check, because they were correctly placed against the anchor they were given. Measured across
2.1.270, five of fifteen identity anchors have this property: `modelPill` (3 application sites),
`transcriptRow` (3), `assistantRow` (8), `userRow` (3), `sessionListItemName` (2).

So three things change. `kind` splits three ways rather than two, because "element" conflates a
**singleton** (the model pill, the composer: exactly one, and a second match is a bug) with a
**collection** (transcript rows: many by design, where the question is whether everything carrying
the class really is one), and the uniqueness rule is not expressible until they are told apart.
`style` keeps its meaning and is exempt: a borrowed class being used in several places is the point
of borrowing it.

**An anchor resolves to a CSS selector, and the host queries with `querySelector`.** Resolving to a
bare class and reaching for `getElementsByClassName(...)[0]` is what made a refinement look like a
new feature needing a new word; against a selector it is simply the rest of the selector, and
`.modelPill_gGYT1w[role="combobox"]` is plain CSS with no vocabulary of ours in it. `singleton`
against `collection` then stops being a taxonomy and becomes which of the two standard calls to
make, and a descendant or child relationship becomes expressible for nothing — which the
module-and-local pair can never do, and which may well be the cleanest reading of
`sessionListItemName`. A singleton whose class is applied at more than one site must carry a
refinement or fail codegen by name.

`modelPill` takes `[role="combobox"]`, which the picker has and the agent map does not. ARIA is what
P1 asks for: it crosses a serialisation boundary, it is a contract the extension is unlikely to break
quietly, and it is not minifier output. The transcript rows take `[data-transcript-message]`, which
the app queries itself, and the assistant row `[data-testid="assistant-message"]`.

**An ambiguous singleton fails codegen and does not block an install.** The verdict is data — the
anchor resolves to null, with its reason carried beside it — and the two consumers read it
differently. `rigline codegen` exits non-zero and names the anchor, because in this repo an
ambiguous singleton is the table being wrong and a maintainer is standing there. `check` and
`install` report it for attention and let the per-plugin refusal do the rest, because an upstream
release that starts reusing a class is neither a collapsed harvest nor a failure of our own build,
and those are the only two things that may cost every other plugin its injection (P3). A module
whose class-map variable the harvest cannot find is *uncounted*, which is not zero: its anchors
still resolve and are reported as unverified, because an unknown read as "exactly one site" is the
silent pass this whole layer exists to stop.

**`knownSites` is the acknowledgement, and it is bounded.** The count is an upper bound — it counts
every reference to a class, so the bundle handing one somewhere as a value reads as a site, which is
what one of `modelPill`'s three already is. Without a way to say "I have read these and they are one
control", a maintainer facing that has only two discharges: invent a refinement against something
that discriminates nothing, or relabel the anchor `collection`, which is a lie that switches the
check off for good. Under weekly extension releases the lie is the cheaper move every time, so the
rule would corrode itself. So a singleton may carry `knownSites: { count, why }` and is ambiguous
only above that count. It takes a `why` for the same reason a host patch does: the field exists to
be read by the next person, and a bare number invites bumping without looking. It does not blanket-
exempt — a count that climbs past the acknowledged one fails again, naming both numbers.

**Refusal is whole-plugin, not per-capability.** A tempting alternative nulls only the selector, so
`watch` refuses while the bare class survives for `ctx.anchor()` — on the grounds that the host
picking the wrong element silently is the real bug, and a plugin scoping its own CSS is responsible
for its own hygiene. Rejected, and worth writing down so it is not reopened: it hands a plugin a
class the host has just concluded is untrustworthy, with no channel to say so, and the CSS use is
the one that has already damaged a layout once. A name that means two controls is not a name, and
half-refusing it trades a legible failure for a subtle one (P8). Confirmed by Leo 2026-09-14.

What stays bespoke, and should, is substituting the harvested class into that selector: class names
are hashed per build, so a table cannot hold `.modelPill_gGYT1w` and stay true, and the substitution
is the whole reason the layer exists. `ctx.anchor()` keeps returning a bare class because a style
anchor is *borrowed* rather than queried — a plugin passes it to `classList.add`, never to a query —
so the two resolved forms serve the two kinds and neither plugin nor author ever assembles a
selector by hand.

And the count becomes a harvested fact rather than an assumption. The class harvest already reads
each module's map; counting how many places apply each class is the same pass, and it makes
ambiguity a build-time verdict per version and a `diff` signal the week an update *starts* reusing a
class. That is the failure this whole layer exists to catch, and until now it was the one kind of
drift nothing looked for.

The pattern worth carrying elsewhere: **a class proposes, something else disposes.** The transcript
capability survived the same ambiguity untouched, because `sweep` never trusts the class — it reads
each candidate's fiber and drops anything without a row identity, so a stray match costs it a little
work and nothing else. `watch` had no second opinion.

**D8. The protocol is harvested from anchored dispatch sites, never by scanning for `type:"…"`.**
The loose scan was measured at 41% other protocols (markdown AST nodes, Zod issue codes, MCP tool
names, Anthropic streaming events) while missing every inbound request type. Requiring an
underscore does not separate them.

**D9. Replies are derived from the request side.** A reply is declarable exactly when this webview
sends the request it answers. Scanning the host bundle for reply literals mixes in types that can
never arrive here (`control_response` belongs to the CLI's own protocol), and scanning forward from
a dispatch case mispairs when the case delegates.

**D10. Payload fields: reads never declare, writes always do.** The field harvest is a lower bound
where a send site spreads a variable in, so requiring declaration to read would falsely refuse a
plugin, while an undeclared write would land on nothing in silence. A missing read degrades
visibly as `undefined`; a missing write does not.

**D11. Build-time React anchors are asserted, not collected.** The devtools hook name, the fiber
props and the renderer descriptor fail the harvest outright when missing, so a build that would
leave the transcript capability silently empty cannot produce generated tables at all.

### Plugins and the manifest

**D12. A plugin is a `rigline.json` manifest plus one browser ES module whose default export has
`setup(ctx)` returning an optional teardown.** The manifest is JSON, `api: 1`, schema-validated,
with every dependency under `uses` and host patches under `patches`. JSON rather than a JS export
so the host can report what an update broke without evaluating the plugin, module evaluation
being exactly where a broken plugin throws.

**D13. Plugins are authored in TypeScript and built to one file by `rigline build`.** The output
contract (P6) is unchanged; the preset is a convenience. First-party plugins are packages with
`src/`, tests and a README.

**D14. Discovery happens at install time in Node; the installer bakes a registry the post hook
imports.** Forced by the webview CSP, which has no `connect-src`, so the webview can neither read a
manifest nor list a directory. The manifests are parsed as data and never evaluated.

**D15. A capability violation refuses at load and disables at runtime, by name.** Not "warn": a
warning implies `cls()` returns something, and whatever it returns renders as misplaced markup. A
runtime violation of something the compiler would have caught means the plugin was built against a
different extension version, and is reported as that.

**D16. Capability switches expand to the identifier-layer dependencies the host taps for them, and
the gate checks the expansion.** A boolean that grants a capability is still a dependency
declaration. The mapping lives in exactly one table read by both the Node gate and the load-time
check, so the grant and the gate cannot drift apart.

**D17. Refusal fixtures are test-only.** Plugins that exist to be refused (an unknown class, an
unknown field, a failed required patch) live under `fixtures/` and are never installed by default.
Installing them live would force an expected-refusals list to be maintained wherever refusals are
scored.

**D40. No harvested identifier types are published; an author harvests and commits their own.**
`@rigline/plugin-api` ships the curated anchor names, the manifest type and the context types, and
no literal unions over the extension's own identifiers. It declares an interface, `RiglineIdentifiers`,
that is empty as published; `ModuleId`, `ModuleClasses`, `MessageType` and `OutboundFields` are
derived from it by conditional lookup, each falling back to its `string`-shaped default when the
key it looks for is absent. `rigline codegen` writes an author's harvest as a module augmentation
filling those keys in, and the author commits that file the way they commit a lockfile — a record of
the version they built and tested against, and the baseline `rigline diff` reads after an update.
The augmentation merges through an alias, so it names the package (`declare module
"@rigline/plugin-api"`) even though the interface is declared in a module the index only re-exports,
and it may live anywhere the author's tsconfig pulls in — verified in both resolutions, source
through `paths` and the emitted `.d.ts` through `node_modules`.

A published snapshot can never carry the version released tomorrow, which is exactly when an author
needs it; a green typecheck against one asserts only that the identifiers existed wherever codegen
ran, which is not the question anybody is asking; and shipping several under a selector rebuilds the
version matrix P7 exists to refuse, with ceremony. The contract is the install-time check on the
user's machine (D43); types are dev-time ergonomics and are scoped to that. With no local harvest
every union widens to `string` and a plugin still compiles, so a scaffold builds before codegen has
ever run.

The exception draws the line in the right place. `AnchorName` is Rigline's own vocabulary, curated
in this repo and versioned with the package, while module hashes and local class names are the
extension's vocabulary and are harvested where they are used. A plugin written entirely against
anchors needs no generated file at all, so the type system enforces D7's preference instead of
restating it.

**D41. Optional declarations sit in `uses.optional`, and refuse nothing.** It mirrors `uses` key for
key. An optional is checked against the installed version's tables exactly as a required one is, and
a missing optional is reported at install and carried into diagnostics; it simply never refuses the
plugin. Only the two lookup-shaped capabilities need a runtime grant: `ctx.optional.anchor(name)`
and `ctx.optional.cls(module, local)` return `string | null`, so `strictNullChecks` makes the author
handle absence, while `ctx.anchor` and `ctx.cls` keep returning `string` because the declaration
check already refused a plugin whose required identifier is gone. An optional message, rewrite or
switch needs no API at all: the handler never fires, which is already what absence does, and the
declaration only stops it refusing the plugin. `ctx.watch` is the one place that rule needed
extending rather than restating, added 2026-09-14 when the grants were built: it takes an anchor
*name*, not a class, so an optional anchor would otherwise be resolvable and unwatchable. It accepts
an optionally-declared name and returns a no-op teardown when the class is absent, which is the same
"the handler never fires" answer, reached the only way the signature allows. The rule the grants follow,
learned by getting it wrong first and fixed 2026-09-14: a lookup-shaped capability has two methods
and each reads its own half, so `ctx.anchor` refuses a name declared only optionally and sends the
author to `ctx.optional.anchor`, where the null is unavoidable; everything else has one method,
which reads both halves. Optional decides the verdict when the thing a declaration rests on is
gone, never whether the method exists. Reading the required half alone made a plugin that declared
`tools`, a message tap or a rewrite optionally throw on its first call and disable itself — on
every version, including the ones where the identifier was present — which is not a weaker form of
the guarantee but the opposite of it. Two of the three first-party plugins found it independently,
from different capabilities. Nesting `optional`
under `uses` rather than beside it keeps the check as the same walk over the same contracts with a
different verdict, so a capability added later is optional-capable without anything being taught
about it. In code that walk is one method: a contract answers `gaps()` with every identifier its
declaration depends on that the tables lack, and the two verdicts are the first gap over the
required half and all of them over the optional half.

Two grants rather than one function typed from the manifest. Making `ctx` generic over a
`const`-asserted import of the plugin's own `rigline.json` does work, and is rejected: it makes the
entry module compile-depend on its manifest through import attributes, it is fragile across a
stranger's tsconfig, and it buys a keystroke. Two grants keep the load-bearing dependencies legible
in the source — what a plugin hard-depends on is what it calls without `.optional` — and for code
that runs in the app's realm with full DOM access, reviewable beats terse.

**D42. A plugin ships one build; per-extension-version variants are rejected.** Rejected rather than
deferred, so it does not come back. Variants address backward spread only, and an author cannot
build one for a version that does not exist yet, which is where the cost actually falls: the painful
window is between an extension update and the maintainer catching up, not between a user and an old
release. Declared identifiers plus D41 already say "works wherever these exist", forward, without
prophecy. Users take the extension update almost immediately, so backward spread is transient on one
machine (the D4 window) and narrow across users, and a user who pins is served correctly by D43's
check with no mechanism of its own.

### The context

**D18. `ctx` is built per plugin, scoped to its manifest, by a registry of capability modules.**
A capability module carries its declaration schema, its layer expansion, the sentence
`describeUses` prints, its runtime grant, its diagnostics and its probe check. The kernel knows
none of them by name.
Plugins never import the host; a module singleton would defeat both the scoping and the
attribution.

**D19. Initial capabilities:** `classes` (`cls`), `anchors` (`anchor`), `messages` (`onMessage`),
`mount` (`mount`, `mountAfter`, `mountBefore`, `watch`), `style`, `rewrites` (`rewrite`, `resend`), `tools`
(`onToolUse`), `session` (`onSessionId`), `transcript` (`decorateTranscript`), and `surface`.
`watch` is host-managed re-anchoring on the shared re-render signal (D52), so no plugin polls for an
element; `style` is a host-managed stylesheet removed on teardown; `surface` names the full editor,
the sidebar or the session list.

**D20. Bus-write invariants.** Outbound only. The handler sees a frozen clone with earlier writers'
patches applied. It returns a patch or nothing; the host merges. Every patch key must be declared.
A patch may replace a present field but never add one, which is what makes a renamed field loud. A
value keeps the `typeof` of what it replaces, because the host applies `rename_tab` only when the
title is a string and otherwise drops it without a word. `type` and the envelope are never
reachable. A handler that throws or returns a promise disables its plugin and the app's original
goes. Synchronous. Not replayed. Read taps see the app's original; only the chain sees the
accumulated value. Two writers on one field compose in registry order and are reported, never
refused.

**D21. `resend(type)` replays the app's own last message of a type the plugin rewrites, with a
fresh request id, and general emit is out of scope.** A rewrite only fires when the app sends,
which is not always when a plugin learns something. Replaying the app's own message means a plugin
cannot invent a type, a field value or an envelope. A resend from inside the chain is refused
because it would recurse.

**D51. `tools` reports outcomes as well as calls, and the host owns the correlation.** `ctx.onToolUse`
reports what the assistant *asked for*; a plugin that acts on it is acting on an intention, and an
`EnterWorktree` the user declined or that failed looks exactly like one that worked. The outcome is
on the same bus: the CLI relays a `tool_result` block on a `type: "user"` record, carrying
`tool_use_id`, `content` and `is_error`, and the extension itself reads precisely that three-state
answer — no result yet is pending, `is_error: true` is failure, anything else is success. A declined
permission arrives as `is_error`, which is the case worth having.

So `ctx.onToolResult(handler)` joins the result back to the call it answers and hands over
`{ id, name, input, ok, content }`. Joined, because a `tool_result` alone carries no tool name and
every plugin would otherwise keep its own map; owned by the host for the reason P5 gives, since
getting the correlation wrong is silent — the visible symptom is a tab confidently naming a
worktree the session is not in. It is granted by the same `tools` switch and expands to the same
`io_message`, because it is a second reading of one stream rather than a second dependency.

The map of calls awaiting a result is bounded and drops its oldest entries. A result follows its
call within seconds, the extension keeps the real history, and an unbounded map here would be the
replay buffer's mistake made twice (D3).

**D22. A DOM capability hands out data, never an element, where the host discovered the element.**
Transcript rows are keyed by index upstream and React reuses elements when the list is spliced, so
identity is the host's problem, and keeping it there lets the mechanism change without any plugin
noticing.

**D23. Mounts sharing an anchor are ordered by the host in registry order, and every host-placed
node is stamped `data-rigline-mount`.** The naive insert gives the slot to whichever plugin mounted
last, which is invisible to authors and was observed to displace a decoration.

**D52. Re-placement and re-anchoring run on the React commit signal, never on a document-wide
mutation observer.** Every mutation the mount service cares about — an anchor element swapped for a
new one, a foreign child detached by a parent whose whole child list was replaced — is a React
commit, and the pre hook already taps the devtools hook and notifies commit handlers once per frame.
So the commit notice is the signal itself rather than a proxy for it, and it arrives coalesced.

What it replaces was a `MutationObserver` over `document.body` with `subtree: true`, which carried
two costs and one hazard. Its callback took no records argument, so a record was allocated for every
childList change in the document and thrown away unread. It scanned every active mount and ran a
`getElementsByClassName` per watch on every mutation batch, through token streaming, with one mount
per transcript row and a measured session 319 rows deep. And it mutated the DOM from inside its own
callback: a MutationObserver callback is a microtask, so insertions that never stick re-queue it
without the event loop ever getting a turn.

An observer stays as the fallback for a webview where the hook never injected, routed through the
same per-frame coalescing rather than working in its own callback. `requestAnimationFrame` pauses in
a hidden webview, so re-placement defers until the panel is on screen again, which is right —
nothing needs re-placing while nothing is visible, and becoming visible is itself a commit.

**A pass re-checks position, not only presence (amended 2026-09-14).** The first version skipped
every mount whose own node was still connected, which meant an anchor a re-render *moved* rather
than replaced left its mount stranded where the anchor used to be. That is the 0.x prototype's
vanishing session-id pill (archive/0.x/vanishing-session-id-pill.md), reproduced in 1.0 within a day
of the note being written: an attachment chip in the composer reordered the footer row, the model
pill went to the end of it, and all three first-party decorations stayed behind — silently, and
permanently, because nothing ever looked again.

So the pass asks where each mount *belongs* and moves only when the answer has changed. Idempotence
is what makes that affordable and is not optional: `after()` and `insertBefore` remove and re-insert
unconditionally, so a version that repositioned a correctly-placed node would write to the DOM once
per mount per frame — one per transcript row — and drop any text selection inside one.

Drift is counted separately from re-placement, because the two answer different questions and one of
them is a warning. `replaced` is a node put back after removal; `moved` is a node that had drifted.
A `moved` rate that does not settle means the host and the app are fighting over a position, each
undoing the other every frame, which is the one way this change could be worse than the gap it
closes — so it is a number on the panel rather than something to be discovered.

**Re-placement is on probation, and counted so the question can be settled with numbers.** The 0.x
prototype measured a node appended to a React-owned container surviving *zero* removals on all three
surfaces, and kept its re-mount anyway because at one observer per anchor it was nearly free; at one
document-wide observer and 319 mounts it is not. So the host counts re-placements and the probe
reports the count. If it stays zero on the live panel, `replaceLost` goes, and `place()` loses its
per-node scan of every peer with it.

**D54. A decoration does not join a container whose owner measures its children, and the host
stops when it finds itself in a fight.** The composer footer runs a three-stage fit ladder over the
measured widths of its own element children and resets it, through `flushSync`, on any foreign
mutation inside it. The app exempts the one child it moves itself — the model pill — from that
reset; nothing exempts ours. So a decoration anchored to the pill both changes the layout decision
and re-triggers it every time the decision moves the pill, which oscillates at one cycle per frame
whenever the footer is near its threshold. A selection chip is enough to put it there.

Footer decorations therefore anchor to the `spacer`, which renders in both layouts, and reach it
through `mountBefore` so they land at the end of the left cluster rather than beside the send
button. The point is not the position: it is that the width a decoration contributes stops
depending on the stage, so the ladder converges. It converges at stage 2 while a chip is attached,
which is the honest cost of adding width to a full row and is not a defect to tune away.

The general half is the damper. The host takes exactly one kind of corrective action — put this
mount back where it belongs, re-anchor this watch to the element that replaced its own — and
either, repeated on consecutive passes without settling, means the app is undoing it as fast as it
is done. D52 named that condition and made it a number; this stops it. After a bounded run the host
abandons the mount or the watch, tears the node down rather than leaving a ghost, records the plugin
and the anchor in diagnostics, and logs once. Nothing retries: a fight the host cannot win by
repeating is not one it should re-enter, and the panel is worth more than the decoration.

The measurement skips children with `position: absolute`, and a decoration could have hidden in
that exemption instead. Rejected: it buys invisibility to the ladder by giving up layout space, so
the decoration has to overlay the footer rather than sit in it, and a badge meant to be read and
copied is the wrong thing to make an overlay. The exemption is right for a marker, not for this.

**D24. A row's own timestamp is never read.** It is `Date.now()` from when the row object was
built, so every row in a reopened session claims to be from just now. Real times come from the bus
(`get_session_response` and `io_message` records), and an entry with no record is `null`.

### Host patches

**D25. A plugin may declare byte substitutions in `extension.js`, applied by the installer.** The
bundle is rebuilt from `extension.js.orig` on every install, so applying is idempotent and
disabling a plugin removes its patch. `find` must match exactly once (more than once is drift too).
`replace` must keep the byte length so no offset moves. Overlapping patches refuse both plugins,
naming each other. `required` refuses the plugin when the patch cannot apply; optional loads
without. The file is written only when the bytes change, because a change needs a window reload
that ends every session in the window.

**D26. A plugin's declared host patch applies because the plugin is enabled.** Installing a plugin
is the act that says yes, and nothing after it asks again — the same bargain VS Code strikes with an
extension. The install names the plugins whose patches it applied; the author's `why` lives in
`doctor` rather than being repeated per version in a log nobody reads (D55).

The safety net is a backup, not a question put to the user. `extension.js.orig` is written before
the first patch lands, every install rebuilds the host bundle from it, disabling a plugin removes
its patch, and `restore` needs neither VS Code nor a working extension. That asks nobody to have
predicted a problem, which is the one thing a prompt cannot do.

### Update flow

**D27. The update flow never blocks on a plugin's problem.** It reports the plugin by name, injects
around it, and the post hook refuses it at load. An update has already removed the loader, so
blocking to report one plugin would cost every working plugin and the probe badge that names the
broken one. What blocks: the class harvest falling under its floor, or a failure in Rigline's own
build or typecheck. The exit code is non-zero whenever a human is needed, including from `check`
and `watch`.

**D28. "Regressed" is named answers, not a percentage.** Does every declared identifier still exist,
and does the repo still typecheck against the regenerated types. Roughly 6% of class names go
missing over 58 releases, nearly all of them names nothing depends on, so a retention threshold
measures the wrong thing. Both questions are asked of the installed bundle alone, never
differentially, because the flow advances its own baseline and a differential gate would pass on
the second run having been satisfied by its own side effect. The one threshold, the harvest floor,
is a smoke alarm for our own regex and not a judgement about the extension.

**D29. The baseline for "what changed" is the committed `generated.ts` for this repo, and
`~/.rigline/baseline.json` on a user's machine.** The old extension directory is gone by the time
anything notices an update, and "what moved since the version my plugins were compiled against" is
the more useful question anyway.

**D30. The update flow writes its artefacts and tells you to commit them; it never commits.** From
`watch` it runs unattended, and the diff is the most useful thing an update produces.

**D55. The flow is spelled `install`; `update` means plugins (2026-09-15, Leo).** The flow keeps its
name in the code and loses it on the command line. `install` is the one write command — inject the
loader everywhere, say what moved since the baseline, record the new one — `check` is its read-only
half, `watch` loops `install`, and there is no `upgrade`. `update` is reserved for the sense every
package manager already gives it: update the things I installed. `npm update`, `pnpm update` and
`cargo update` all read that way, and this extension's users also type `claude update`.

**A command never explains what it used to do.** Output that recounts its own past is output nobody
has trimmed. `update` falls through to the usage rather than to an error narrating a retirement, and
the host patch's `why` stays out of the install log — a paragraph of an author's rationale, repeated
per installed version, where the plugin's name is the whole of what a reader needs. `doctor` carries
the full text, for the one case that wants it.

**D43. The declaration check runs in Node at install, per extension directory, and names what it
refused.** The same `capabilityViolation` the kernel asks at load is asked of every enabled plugin
against the tables harvested from the directory being patched, and the outcome is reported per
version: refused on 2.1.268 naming the identifier that is gone, installed on 2.1.270. The webview
keeps its own check, because a baked registry can outlive its tables; this one exists so a person
learns from the install rather than from a console line after a reload. It refuses a plugin for one
directory and never blocks the install (D27). Its output is also the maintainer's bug report — an
identifier name instead of "it stopped working".

**D44. The anchor table is the repair path, and `~/.rigline/anchors.json` overrides it.** When a
curated pair retires, one edit to one table repairs every plugin that used the name, and nothing
else in the system can repair a plugin whose author has not touched it. That makes the shipped
table's publish cadence a real cost, because the extension updates weekly and npm does not. So the
table is overridable and extensible from `~/.rigline/anchors.json`: a two-line pair posted in an
issue thread reaches every user the day it is found, with no publish and no round of maintainer
releases. An override is reported at install by name, so it is never invisible. The same reasoning
makes raw `cls()` worth counting — those are the dependencies an anchor-table fix cannot reach, and
the install says how many a plugin has.

**An override carries a refinement, not only a pair (amended 2026-09-14).** "A two-line pair" was
written when the only way a name stopped resolving was the class retiring. There are now two, and
the second — a singleton whose class the version applies in more than one place (D7) — cannot be
repaired by a pair, because the class is right there and it is the *identity* that has gone. So an
override may supply `refine` and `within` as well as `module` and `local`.

**Until it exists, refusal is a repair path we do not have.** This is unimplemented, and that is
load-bearing rather than incidental: an ambiguous or retired anchor refuses the plugins that
declared it, and with no override the only repair is a Rigline release — npm, plus D48's minimum
age, so days, against an extension that updates weekly. That is survivable while the only consumer
is also the maintainer and can edit the table in the repo. It stops being survivable the moment
somebody else installs a plugin, so this has to land before `rigline add` puts one in anybody
else's hands.

**D45. A retired identifier is reported with its likely successor, and never remapped.** A rename
usually shows in the diff as one local name gone from a module and one new name arrived in the same
module; naming that pairing hands the maintainer and the curator an answer instead of a question,
for the cost of a line in `formatDiff`. Applying it automatically is exactly the subtly-wrong
outcome P8 refuses: a class that resolves to the wrong element renders as misplaced markup no plugin
can be blamed for, and absent beats wrong.

### Distribution and state

**D31. Distribution is `@rigline/core` plus the `rigline` CLI now, with a companion VS Code extension
as a later phase; core is designed so either can be its consumer.** Confirmed by Leo 2026-09-13.

**D32. User state lives under `~/.rigline`**: config, installed plugins, anchor-table overrides
(D44) and the harvest baseline. A clone of this repo is for developing Rigline, not for using it.

**D33. Plugins are distributed as npm packages carrying `rigline.json` and a built entry, or as a
local directory for development.** A git-repo source was weighed and deferred rather than
overlooked, and why it lost is worth keeping so it is not retried: a repo holds source, so
installing from one means either running an author's build on a user's machine or requiring a
committed `dist/`. The cadence argument that favoured git belongs to the anchor table instead, which
is the repair path needing no author at all (D44); plugin republishing is the slower tier on
purpose. A source is recorded by kind from the first entry (D49), so git arrives later as an adapter
rather than a migration.

**D46. Our packages publish from CI, and the plugin template ships the same workflow.** GitHub
Actions authenticates to npm over OIDC, so no npm credential sits in the repository, and `npm stage
publish` puts a version in a queue that nobody can install until the owner approves it with `npm
stage approve <id>` — which does require 2FA. That is ordinary release hygiene and nothing more:
an approved stage says the owner meant to ship, never that the code is safe, and no part of Rigline
reads a publishing arrangement as evidence about a plugin. The template carries the workflow so an
author gets the good path by generating a repository rather than by reading a guide, and a plugin
published any other way installs identically (P6).

The one control that matters is the credential inventory: there is no org-wide or package-wide
switch that requires staging, so the gate holds exactly as long as every credential able to publish
is stage-limited. Both kinds support it — `Read and write (stage only)` on a granular token,
stage-only permissions on a trusted publisher — and one forgotten full-rights token silently voids
it.

Floors: npm CLI 11.15.0 and Node 22.14, both below our own (D34). `pnpm stage publish -r` stages
every publishable package whose version is not yet on the registry, so our three go up as one CI
step and are approved individually; a single-package plugin repo needs no flag.

Two steps cannot be automated and are Leo's: the npm organisation, and a bootstrap publish of each
package under a temporary token, since a brand-new package can be neither staged nor trusted-
published. Revoke that token once the publisher is configured.

**D47. A plugin is distributed built, so `rigline add` never runs a package manager.** The
distributed form is one browser ES module plus a manifest (P6) and the webview cannot resolve a bare
specifier, so a published plugin has nothing left to resolve: `add` fetches the tarball, checks it
against the registry's integrity hash, extracts it, and validates the manifest as data (D12). No
`node_modules`, no dependency resolution, no lifecycle script — the surface is declined rather than
defended, which is stronger than passing `--ignore-scripts`. A plugin that cannot be installed this
way is a plugin we do not install.

**D48. A published version must reach a minimum age before `add` or `update` will take it: 1440
minutes by default, `--now` to override.** The number matches pnpm's `minimumReleaseAge` default and
rests on the same evidence — a compromised publish is generally caught within a day, and a day of
latency costs a plugin user nothing they can perceive. The delay is affordable here for a specific
reason: the urgent repair does not route through it. When an extension update retires a curated
anchor, the fix is a two-line pair in `~/.rigline/anchors.json` (D44), which reaches a user the hour
it is written with no publish at all. What the delay does hold back is a fix to a plugin's own logic
or its raw `cls()` use, so a withheld version is reported rather than hidden (P8): `update` names the
version, its age, and the flag that takes it early.

**D49. A source is recorded by kind and pinned identity, and `upgrade` reads it.**
`~/.rigline/config.json` holds `{kind: "npm", name, version, integrity}` per plugin that `add`
brought in. The kind discriminator is present from the first entry so the git source deferred in D33
arrives as an adapter. The integrity hash says the bytes are the ones the registry served, which is
hygiene rather than a judgement about the plugin.

`update` fetches a newer version and installs it, and never stops to ask about what that version
declares: a user who installed a plugin should not be re-asked because its author shipped a feature,
and a fetch that halts on a widened declaration is the failure that makes people stop fetching.

A plugin the user placed in `~/.rigline/plugins/` by hand has no source record at all. It loads on
the next inject with everything it declares, and it cannot be upgraded, which is the honest cost of
dropping a directory in: the user owns the version because the user owns the provenance. `list`
reports that rather than leaving it to be inferred from silence.

**D50. The plugin template is a pnpm workspace holding many plugins; one plugin is that workspace
with one member.** The multi-plugin shape is a superset — it scaffolds correctly for one plugin,
whereas a single-plugin template cannot grow into a workspace without a restructure, and adding a
second plugin should be a directory copy. It also costs us close to nothing to write, being the
shape of this repo. `pnpm stage publish -r` stages only packages whose version is not yet on the
registry, so bumping one plugin releases one plugin and no changeset tooling is needed. The
harvested `generated.ts` is produced once at the workspace root by `rigline codegen --out` and
imported by every plugin in the repo, since they all compile against the same installed extension
(D40, P7). pnpm is the template's package manager for what its defaults do rather than for
consistency with us: `minimumReleaseAge` defends the author's own machine and CI on exactly the
reasoning D48 applies to that author's users, and `allowBuilds` turns a dependency's build script
into an explicit grant. The cost of the shape is per-package npm setup — a trusted publisher is
configured per package, so each plugin needs its own entry naming the same workflow file, and its
own bootstrap publish (D46). That is friction on a second plugin, never on a second release.

This does not weaken P6. The template is a convenience, exactly as the build preset is: a plugin is
one browser-target ES module and a manifest however it was produced, and one built with npm, yarn,
bun or a shell script is discovered, checked and loaded identically. What is published is the output
contract, never the toolchain — the template is how the good path is made the easy one, not a
requirement we could enforce or would want to. The package name stays singular, because
`create-rigline-plugin` is what an author types.

### Toolchain and verification

**D34. Toolchain: pnpm 12, TypeScript 7, Rolldown for browser bundles, Vitest, Biome with
semicolons required.** Vite is rejected: its value is a dev server and HMR, neither available in a
webview we do not own.

**D35. Inline source maps.** The webview CSP makes a sibling `.map` fetch a gamble.

**D36. Verification is split three ways.** Node tests for pure functions and file transforms,
against throwaway copies and the corpus, never the live extension; the probe plugin for the real
webview, one check per capability, `n/a` where a check cannot apply on a surface; and a Playwright
tier that boots the real bundle from the corpus with a faked `acquireVsCodeApi` and a replayed bus,
which is `packages/harness`.

**D37. Byte-faithful I/O for every bundle read and write, and LF enforced in the repo.** Text-mode
I/O on Windows rewrites every line ending and turns a 133-byte patch into a 2.2 KB one.

**D38. The backup file, not the marker comment, is the authority on whether a bundle is patched.**
Keying on the marker breaks the moment the marker string changes: the installer stops recognising
its own work and stacks a second loader on the first.

**D39. Never point a test at the live extension directory.** A failing assertion mid-test leaves a
real install half-patched, and the panel renders blank when the static import is broken.

**D53. The host records rates and peaks, not only totals; one bounded ring survives the window; and
nothing Rigline writes out ever carries message content.**

A cumulative counter cannot be read. `sweeps: 44120` is an hour of ordinary work and four seconds of
pathology written the same way, which is why the host had nothing to say about itself during a
lockup that took a window down. So every hot path — commit notices, transcript sweeps and rebuilds,
mount re-placements, outbound messages, tap clones — carries a per-second rate, its peak, and the
moment it peaked. The probe already polls at 1 Hz, so that is the bucket and the cost is a counter
reset per second.

**Persistence is `localStorage`, because it is the only route out of the webview and it does
survive.** The CSP is `default-src 'none'` with no `connect-src`, so nothing in there can write a
file or fetch; D20 forbids a plugin originating a bus message, so the extension host cannot be asked
to log on its behalf; and webview console output reaches no log file. What remains is storage, and
the webview origin is stable — VS Code keeps persisted origin stores keyed by viewType and extension
id (`mainThreadWebviewPanel.origins`, `webviewViews.origins`), so a ring written under it survives a
webview reload, a window reload and a force-close alike. It is bounded, written on a coarse timer
rather than per frame, read back at boot, and every access is wrapped: storage that is full,
disabled or cleared must cost a diagnostic, never a panel.

**`rigline doctor` reports Rigline's own install state, and nothing else** (amended 2026-09-18,
Leo). Per installed version: patched or vanilla by backup, the payload directories present, which
plugins are discovered and enabled, and which this version's tables refuse and by which identifier.
That plus the probe's copied report is what a bug report needs, and both come from files we wrote.

VS Code's own logs are deliberately out of scope, having been in it and cut. Parsing them took more
code than the harvest that is the reason this project exists, against five formats nobody documents,
to explain one lockup whose cause was our own superseded payload directories and was found without
it. It also meant reading files full of prompts, tool commands and file paths into a report people
are told to paste into an issue, so the redaction machinery that made that safe was itself a
liability with a way to be forgotten. Declining to read them removes both. If a panel misbehaves in
a way the install state cannot explain, ask for the log lines rather than shipping a parser for
them.
