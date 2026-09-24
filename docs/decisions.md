# Decisions

The durable record. Principles are the rules the architecture is derived from; decisions are
choices made under them. Amend by editing the entry and noting the date; the file should read as
what is true now, never as a history of what was once true.

A decision's number is its identity, not its position: source comments cite them, so a new entry
takes the next free number and sits in the section it belongs to, and numbering runs monotonically
within a section rather than down the file.

Measurements cited here were taken during a prototype investigation across extension versions
2.1.200 to 2.1.268, whose notes are not in this repository. Treat every one of them as indicative
and re-measure before quoting it as current; none of them is load-bearing for a decision in the
sense that the decision would reverse on a different number.

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
unknown field, a failed required patch) are never installed by default. Installing them live would
force an expected-refusals list to be maintained wherever refusals are scored. A `fixtures/`
directory was the planned home; the harness gives them a stronger one, as module source strings
handed to `preparePayload` (see [verification.md](verification.md)), so there is nothing on disk for
discovery to find at all.

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
`describeUses` prints, its runtime grant, its diagnostics and the checks it contributes to the
panel (D63). The kernel knows none of them by name.
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
than replaced left its mount stranded where the anchor used to be. That is the prototype's
vanishing session-id pill, reproduced here within a day of the note being written: an attachment
chip in the composer reordered the footer row, the model
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

**Re-placement stays, though its count reads zero** (amended 2026-09-21). The host counts
re-placements and the probe reports the count, because the 0.x prototype measured a node in a
React-owned container surviving *zero* removals, and re-placement is not free at 319 mounts. The
count read zero on 2.1.278 over 328 mounts and 144,548 commits ([history-m6.md](history-m6.md)),
which is the absence of the trigger rather than of the need: nothing detached because nothing moved,
and a transcript row React rebuilds takes its anchor with it, so its mount is skipped rather than
counted. So a zero reading does not retire `replaceLost`. A demonstration that the app cannot detach
a mount would, and no counter can be that.

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

**D63. A diagnostic check is contributed, and a plugin's is a closure the host hands nothing.**
`ctx.check(name, run)`, `run` taking no arguments and returning a verdict and a line. It declares
nothing, because a declaration exists to be checked against the identifier tables: a check names no
identifier, so a `uses.checks` key could never produce a gap and would only ever answer yes, and a
key whose validation is a constant is a label rather than a declaration. Nothing needs to be handed
in — a plugin's own bookkeeping is in scope, and so is its own `ctx`, so a check asking whether its
anchor still resolves calls `ctx.anchor()` inside the closure and stays capability-scoped by
construction. It joins `surface` as an undeclared member of `ctx`, under the rule that makes that
safe: **an undeclared member may not widen what a plugin can reach.**

The host's own checks take the other path. The kernel and each capability module contribute through
`CapabilityModule.checks(kernel)` and are handed the `Kernel`, because they are host code and their
checks are readings of state they already own. That asymmetry is the same answer applied twice — what
a contributor is handed follows from where it sits in the trust model — and is not to be unified.

The probe is left as one contributor among several, keeping only what is an experiment rather than a
reading, which is the test of whether the shape is right (D17).

**D64. Checks are pulled on the renderer's cadence, and a check reads rather than computes.** The
host owns the registry and the running; the renderer decides when to ask, which is once a second.
There is no `report()` a contributor must remember to call after every state change, so a verdict
cannot go stale — and a stale `pass` is indistinguishable from a fresh one, which makes it the
failure mode that matters rather than the tidy one. The badge's failing count is always on screen, so
the cadence cannot be narrowed to panel-open; the cost of that lands on the contributor as a rule
with the same standing as "a rewriter is synchronous". A check that wants an expensive answer caches
it where the work already happens.

**A check about state the host corrects judges persistence, not an instant (amended 2026-09-24).**
The host puts a mount back on the frame after React moves it, so a check reading the DOM at a moment
can land between the two, and a red that turns green by itself teaches the reader that red is noise.
Placement fails only once a node has been out of place for a second, on a clock the pass restarts
whenever it finds or puts the node in place; a watch's five seconds of settling is the same answer.
A fight the host cannot win is still reported, by `abandon` (D54).

**D65. A check that throws fails its own line and does not disable its plugin.** The one plugin
callback the host calls without `guard`. `guard` disables because a throw inside the app's message
flow or a React commit means the plugin is broken at its job and has left the host somewhere nobody
can reason about; a throw here means the *diagnostic* is broken. Tearing down a working decoration on
that evidence would inflict the failure the panel is reporting, and the disable would be reported
too — one bug in the least important code a plugin has, rendered as two red lines and no feature,
which inverts P8's "absent beats wrong" by making the working thing the absent one. A malformed
return is treated the same way. Nothing is written to `diagnostics.errors`, which feeds `core`'s own
*no host errors* check and would otherwise count one fault twice under the wrong layer's name.

**D66. The panel groups by contributor: `core` first, then plugins in registry order.** Registry
order because the codebase already has one answer to "in what order" — it is how mounts on a shared
anchor are placed and how rewriters compose — and a second rule is a second thing to hold in your
head. `core` first because a host failure explains a plugin failure: tables that did not load refuse
every plugin downstream, and reading top-down gives cause before effect.

The ordering is fixed rather than derived from the verdicts, and that is the part that is load-bearing.
Sorting failures to the top reorders the panel as verdicts change, which slides a line out from under
a pointer mid-click and rearranges a report while somebody is reading it. `core` is flat, with the
capability in the check's name, because a group per module would be nine headers for one to three
lines each.

**D67. A check that has not had its chance yet says `n/a`, and the host is what knows.** A badge
that goes red at boot and green a second later teaches the reader that red is noise, which costs
more than the second of silence buys — the same argument that makes a switched-off plugin `n/a`
rather than failing. The line splits by who can answer, not by giving every check a timer: whether an
anchor *ever* appeared is the host's question, because it owns the watch and has a clock, so
`watchesFoundVerdict` waits the same five seconds the transcript check waits before it will fail.
A plugin's own check says `n/a` until the host has handed it something and leaves that question
alone — a plugin asking "has my watch ever fired" is asking core's question from a worse position,
and at boot it answers it wrongly.

**D68. `ctx.watch` honours the anchor table's `surfaces`, and a plugin that has nothing to do on a
surface says so in its manifest.** Two mechanisms, one for each half of *does this work here*.

A watch for an anchor this *surface* does not render watches nothing and tears down cleanly, which
is what an optional anchor this *extension* has not got already did (D41): both are the same answer
to the plugin, that there is nothing to mount on. The table has recorded `footerSpacer` as editor
and sidebar only since it was written, and the host was not reading it — so a plugin spanning all
three surfaces reported a decoration missing on the one surface where it was never going to appear.
Only where the table has measured it: `surfaces` absent means *not yet measured*, and reading absence
as exclusion would switch off every watch depending on one of the half of entries that lack it.

That covers a plugin that does *some* of its work on a surface. A plugin that does *none* of it there
declares `surfaces` in its manifest and is skipped as `inactive`, which is not a failure and never
was. session-id had claimed all three while its entire output was a composer-footer badge.

`decorateTranscript` reads its own anchor the same way, and there the reading pays for itself
immediately: the sweep runs on the React commit signal, so a decorator registered on a surface whose
`transcriptRow` cannot render queried for rows once per commit for the life of the window — 27,000
times in the run that found it. A missing React renderer remains a throw, because that is a fault
and this is not.

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

**D86. A host backup belongs to its live bundle when the two are the same size, and no hash replaces
that (2026-09-21).** Size is exact because a declared substitution never resizes the file (D25), and
its blind spot is narrow. Every extension version has its own directory holding its own backup, so
`extension.js.orig` goes stale beside its own `extension.js` only when a same-version rebuild lands
at an identical byte size in a directory the installer did not wipe. The cost of that is one
`rigline restore`.

A hash costs more than the fault. Hashing the pristine bundle records bytes nothing ever mutates, so
it detects nothing. Hashing the bytes the injector wrote does detect it, and is destructive while
`hostBackupIsCurrent` answers two questions for its one caller in `inject.ts`: which bytes to rebuild
from, and whether to overwrite the backup. Bytes it does not recognise become the new pristine
baseline, so a foreign patch that preserves the size would be baked into the backup. Recomputing
`applyPatches(backup, declared)` against the live file fails the same way. Doing it honestly means
splitting that answer and adding a third file to the extension directory for `restore`, `doctor`
and `status` to know about. `registry.js`, where D75 keeps its stamp, would not do, because `restore`
removes the payload directory and `codegen` and `diff` read directories that have none. That is a
redesign of what the injector does with unrecognised bytes, not a swapped comparison.

The check guards the harvest and the install's rebuild. `restore` reverts from any backup there is
and never asks.

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
name in the code and loses it on the command line. `install` is the one write command *about the
injection* — inject the loader everywhere, say what moved since the baseline, record the new one —
`check` is its read-only half, and `watch` loops `install`. `update` is reserved for the sense every
package manager already gives it: update the things I installed. `npm update`, `pnpm update` and
`cargo update` all read that way, and this extension's users also type `claude update`.

**"The one write command" has a carve-out, and it always did** (amended 2026-09-21). `add`,
`remove`, `disable` and `enable` all re-inject, and `update` re-injects when a plugin moved. That is
not a drift from this decision but the rest of it: those commands change the plugin *set*, the
registry is baked at install time (D14), and leaving the payload stale behind them would mean a
person who added or switched off a plugin has to know about a second command before anything
happens (D56). What `install` remains the only write command about is the *injection itself* —
nothing else patches a bundle it was not asked to. Stated here because the unqualified sentence was
copied into CLAUDE.md twice and read as a rule the code was breaking.

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
override may supply `refine` and `within` as well as `module` and `local`, and `knownSites` too:
that is the other of exactly the two discharges D7 allows for an ambiguous singleton, and leaving
it out would send half of those repairs back to a release for no reason anybody could defend.

**An entry is a partial spec over the shipped one, and carries a `why`.** The file is
`{ "anchors": { "<name>": { … } } }`. An entry for a curated name merges field by field over the
table's, so a repair states what moved and nothing else, and `null` takes a field back out — which
is how a refinement that has stopped refining, or a `within` the markup no longer nests, is undone
rather than replaced. An entry for a name the table has not got adds one, and must carry what a
spec requires. `why` is required on every entry for the reason `knownSites.why` and a host patch's
`why` are: this is the thing that gets pasted into an issue thread and copied by strangers, and the
next person to read it — usually its author, weeks later — needs to know what it repaired.

**A malformed override never blocks, and never silently wins.** The file is user state, so it is
neither of the two things allowed to cost every plugin its injection (D27): a file that will not
parse is reported and ignored, a single bad entry is reported and dropped while the rest apply.
Against that, every entry that does apply is named in the install report, with what this version
makes of it — whether it repairs a name this version would not otherwise resolve, adds one, or
changes nothing because the shipped table already resolves it. An override that *stops* a name
resolving is an attention line: a local file breaking an anchor that was working is silent
otherwise, and the plugin refused for it would be blamed on the extension.

**`rigline codegen` reads the shipped table only.** Its verdict is about this repository's table —
D7 has it exit non-zero on an ambiguous singleton because a maintainer is standing there and the
repair is a refinement they can write today. A local override would let that maintainer's own
machine go green over a table that is still wrong, and would put local state into the comments of a
committed file. `install` and `check` read the merged table, because they are about the machine in
front of them — with one carve-out that is the same rule again: the `generated.ts` `install`
rewrites is rendered from the shipped table, because that file is committed and read by every other
checkout, and one machine's repair belongs in none of them.

**The installed table is the authority on which anchor names exist, so the manifest's shape check
stops asking `ANCHORS`.** A table that can be extended locally means plugin-api's compiled-in names
are no longer the full set, and a shape check that says otherwise refuses a manifest this install
can honour — at the loudest severity there is, since a shape problem fails the whole install. An
anchor name the installed table has not got is reported by the declaration check instead (D43),
which refuses that one plugin and names the anchor. The JSON schema keeps its enum of curated
names: a typo is made while authoring, which is where the schema is read and where the curated set
is the right answer.

**D45. A retired identifier is reported with its likely successor, and never remapped.** A rename
usually shows in the diff as one local name gone from a module and one new name arrived in the same
module; naming that pairing hands the maintainer and the curator an answer instead of a question,
for the cost of a line in `formatDiff`. Applying it automatically is exactly the subtly-wrong
outcome P8 refuses: a class that resolves to the wrong element renders as misplaced markup no plugin
can be blamed for, and absent beats wrong.

### Distribution and state

**D31. Distribution is `@rigline/core` plus the `rigline` CLI now, with a companion VS Code extension
as a later phase; core is designed so either can be its consumer.** Confirmed by Leo 2026-09-13.

**D69. The engine cannot update the engine, so `rigline` is a retrieval layer above `@rigline/core`
and belongs in no project's dependencies (2026-09-21).** A process cannot replace the package it is
running out of — that is the whole of the npm self-update failure record — so whatever performs an
update sits above the thing being updated. `update` therefore cannot live in core, and the package
that holds it is the one that installs the engine.

So `rigline` owns bytes and nothing else: `update`, the remote half of `add` (D70), installing the
engine (D73), and forwarding every other verb verbatim. It writes no user state beyond the engine
directory and its own staging directory, reads no `config.json`, and opens no plugin manifest. It
holds **no verb list**, which is what lets core add a command without a wrapper release; the price
is that a typo reaches the engine and triggers a first-run install, and that is the right answer
rather than a tolerated one, because the alternative goes stale in the direction that matters —
refusing a verb that exists. The engine prints the usage for everything, its own refusals included,
so the `rigline` surface is documented in one place.

**`--version` is the one thing the wrapper answers itself**, printing its own version and the
installed engine's, or naming the absence before a first run, and installing nothing. The line is
not taste: a version is a question about what is on this machine, which the wrapper can answer from
the manifest it already reads to find the bin, while a usage is a question about what the tool can
do, which only the engine knows — and a version query is what somebody runs when something is
already wrong, so making it reach the network first is the opposite of a diagnostic.

It declares no dependency on any Rigline package, and appears in no project's dependencies — not
this repository's root, not an author's workspace, not the scaffold. A project that can declare
dependencies does not need a delivery mechanism: it declares `@rigline/core` and spells the bin
`rigline-engine`. Taking `rigline` as a devDependency is the payload mistake one layer down,
treating the shell as the substance. The price is duplication — `UserError` and the `$RIGLINE_HOME`
rule are two files rather than one, each with a test holding the copies together — and it is
cheaper than the dependency that would undo the split.

**D70. The wrapper vets the container; the engine vets the content (2026-09-21).** There is exactly
one `add`, in the engine, and it takes a path. The wrapper's remote handling is a prefix that turns
a spec into one: resolve, fetch, check integrity, apply the release-age gate, read the archive
through a reader that refuses (D57), unpack into a staging directory, hand over the path and a
source record. `add ./dir` skips the prefix entirely and is forwarded.

A wrapper that validated would hold an opinion about what a valid plugin is, and pinned to a
different `@rigline/plugin-api` than the engine it could refuse a plugin the engine would have run —
an updater vetoing working software, with no way to argue. So manifest shape, the entry file
existing, capability declarations, anchor existence, the installed directory's name, `describeUses`
and the collision check are all the engine's, which already reports a plugin it refuses by name
without blocking the install (D27, D43).

It is also what keeps an author's loop working with no wrapper anywhere: `add <path>` is an engine
command, reachable from a workspace that depends only on `@rigline/core`.

**D73. The engine installs into `<RIGLINE_HOME>/engine` through npm, never globally, and is the only
engine on the machine (2026-09-21).** `npm install --prefix <RIGLINE_HOME>/engine --save-exact
--ignore-scripts @rigline/core@<version>`, into a directory the user unconditionally owns. No
`EACCES`, because it is their own home; no bin collision, because core's bin lands in that prefix
rather than the global one; no PATH dependency and no package-manager detection, because the wrapper
knows where it put it; and rollback is the same command with the previous version. Recovery is `rm
-rf` on that directory and any command.

**The wrapper carries no bundled copy**, so there is no precedence rule, no semver ordering and no
way for the engine you ran to differ from the one you installed. It compares the installed version
against the resolved one for equality, which is what "install only when it moved" means and is not
the ordering D58 refuses.

**Do not reach for a launcher, a versions directory, background update checks, release channels or
staged upgrades.** Claude Code does all of those, on this machine, and is the nearest neighbour a
reader will find — but that machinery exists because a session is open for hours and an update lands
underneath it. `rigline` exits in seconds, having been asked to run.

Mechanics that are not optional, each confirmed by running it on Windows under the npm that ships
with Node 26. `--save-exact`, or npm writes a caret range into that manifest and a bare `npm install`
there becomes a second mechanism deciding what is installed — what D58 refuses for a plugin source,
and narrower than it looks on a prerelease (D50). `--ignore-scripts`, which is the workspace's own
`allowBuilds: {}` posture and the carve-out D47 needs. npm found beside the running Node, never on
PATH, because under corepack, volta or fnm the shim on PATH is not necessarily the npm beside this
Node — and refused by name, with the command to run, when it is not there. `process.execPath` with
an argv array and no shell, never a `.cmd` shim, which is what makes a prefix containing spaces safe
and what avoids the `EINVAL` Windows has thrown since the 2024 CVE fix. And the entry read from
`bin["rigline-engine"]` in the installed manifest, never hard-coded.

**Majors move together.** The wrapper installs within its own major and refuses an installed engine
outside it, saying so and naming `npm i -g rigline@latest`. On a fresh machine that is one command,
and it is the only case where a first run cannot complete.

The costs, stated: npm must be beside the running Node; the first run needs the registry, seconds
after the user ran `npm i -g rigline`; and a user cannot override the engine with `npm i -g
@rigline/core`, which is the price of never colliding.

**D32. User state lives under `~/.rigline`**: config, installed plugins, anchor-table overrides
(D44), the harvest baseline, and — since 2026-09-21 — `engine/`, the npm prefix the wrapper installs
`@rigline/core` into (D73). A clone of this repo is for developing Rigline, not for using it. The
engine directory is named here because the recovery instruction is `rm -rf` on it, and a person
about to run that should be able to find out what else is in the neighbourhood first.

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

Floors: npm CLI 11.15.0 and Node 22.14 — the Node one sits above the workspace floor (D59) and
below the 26 that CI and a release run on, so it binds nobody here — and pnpm 12.3.4, which is
where `pnpm stage publish` was checked end to end. `pnpm stage publish -r` stages every publishable
package whose version is not yet on the registry, in dependency order, so our four — `rigline`,
`@rigline/core`, `@rigline/plugin-api` and `create-rigline-plugin` — go up as one CI step; `pnpm
stage approve` then takes the whole batch under a single OTP, skipping any package whose workspace
dependency did not make it rather than publishing against a dependency the registry never got. A
single-package plugin repo needs no flag.

**That skip stopped covering `rigline` on 2026-09-21**, and the runbook carries the check it no
longer performs. The protection is a property of the dependency graph: pnpm can only decline to
publish a package whose workspace dependency was left behind. `rigline` now declares none (D69), so
a staged release where `@rigline/core` failed to go up leaves a wrapper that installs an engine
version the registry has not got — on the one package where the failure is invisible until a user
runs it. [releasing.md](releasing.md) asks for the pair by hand.

**pnpm completes the exchange itself**, verified against a stand-in registry rather than inferred:
it reads `ACTIONS_ID_TOKEN_REQUEST_URL`, asks GitHub for a token with `audience=npm:<registry
host>`, `POST`s it to `/-/npm/v1/oidc/token/exchange/package/<name>`, and staged with what comes
back. Two consequences. The exchange is **per package**, so a trusted publisher is configured per
package — four entries naming the same workflow file, which is the same friction D50 names for a
second plugin. And `workspace:*` is replaced with the exact version in the staged manifest, so the
four are internally consistent or none of them are.

Provenance is opt-in: pnpm asks a second time with `audience=sigstore` only under `--provenance`,
and npm binds the attestation to the package's `repository` field, so a package without one cannot
carry provenance at all.

Three steps cannot be automated and are Leo's: the GitHub repository, whose org, name and workflow
filename every trusted publisher entry names; the npm organisation; and a bootstrap publish of each
package, since a brand-new package can be neither staged nor trusted-published. A bootstrap publish
is also the first thing anybody sees of these packages, so the README, LICENSE and `repository`
field land before it, not after.

**The bootstrap publish supplies an OTP rather than creating a token.** npm demands proof of
presence to publish and a login session is not it, which leaves two options: `--otp`, or a granular
token with *bypass 2FA*. The OTP wins on the credential-inventory argument above — it creates
nothing, so there is nothing to revoke and nothing to forget. The token would also be worse than
that argument's general case: a granular token can only name packages that already exist, so
bootstrapping the two unscoped names through one would mean write on **all packages**, which is
exactly the credential that voids the gate.

**D47. A plugin is distributed built, so `rigline add` never runs a package manager.** The
distributed form is one browser ES module plus a manifest (P6) and the webview cannot resolve a bare
specifier, so a published plugin has nothing left to resolve: `add` fetches the tarball, checks it
against the registry's integrity hash, extracts it, and validates the manifest as data (D12). No
`node_modules`, no dependency resolution, no lifecycle script — the surface is declined rather than
defended, which is stronger than passing `--ignore-scripts`. A plugin that cannot be installed this
way is a plugin we do not install.

**The engine is the carve-out** (amended 2026-09-21). `@rigline/core` is an ordinary npm package with
an ordinary dependency graph, and installing it is exactly what npm is for, so the wrapper shells out
to npm for that one job and for nothing else (D73). The headline still holds unqualified — it is
about `rigline add`, and no plugin install has ever run a package manager. The engine install passes
`--ignore-scripts`, which is the weaker guarantee this decision prefers not to rely on, and relies on
it only where the alternative is writing a package manager.

**D48. A published version must reach a minimum age before `add` or `update` will take it: 1440
minutes by default, `--now` to override.** The number matches pnpm's `minimumReleaseAge` default and
rests on the same evidence — a compromised publish is generally caught within a day, and a day of
latency costs a plugin user nothing they can perceive. The delay is affordable here for a specific
reason: the urgent repair does not route through it. When an extension update retires a curated
anchor, the fix is a two-line pair in `~/.rigline/anchors.json` (D44), which reaches a user the hour
it is written with no publish at all. What the delay does hold back is a fix to a plugin's own logic
or its raw `cls()` use, so a withheld version is reported rather than hidden (P8): `update` names the
version, its age, and the flag that takes it early.

**D49. A source is recorded by kind and pinned identity, and `update` reads it.**
`~/.rigline/config.json` holds `{kind: "npm", name, version, integrity}` per plugin that `add`
brought in. The kind discriminator is present from the first entry so the git source deferred in D33
arrives as an adapter. The integrity hash says the bytes are the ones the registry served, which is
hygiene rather than a judgement about the plugin.

`update` fetches a newer version and installs it, and never stops to ask about what that version
declares: a user who installed a plugin should not be re-asked because its author shipped a feature,
and a fetch that halts on a widened declaration is the failure that makes people stop fetching.

A plugin the user placed in `~/.rigline/plugins/` by hand has no source record at all. It loads on
the next inject with everything it declares, and `update` cannot move it, which is the honest cost of
dropping a directory in: the user owns the version because the user owns the provenance. `list`
reports that rather than leaving it to be inferred from silence.

**The engine writes the record it is handed, and skips a kind it cannot read** (amended
2026-09-21). `add` takes an optional source alongside the path, which is how the wrapper's remote
half reports what it fetched without writing `config.json` itself (D70, D74). An `add` handed a kind
this engine does not know refuses that one plugin and names the kind; `readConfig` **skips** an
unrecognised entry with a line and carries on, where it used to throw. The wrapper is routinely
newer than the engine — that is what an acquisition layer is for — so the first wrapper to write a
new kind must not break `list` on every engine that predates it.

**D74. A plugin spec names its source; the manifest's `name` remains the identity; the engine owns
`config.json` (2026-09-21).** `add` accepts a path, `npm:<name>[@<version|tag>]` and, when the
deferred git work lands, a URL with an optional `#ref`. A bare name still means npm, as it always
did, so nothing breaks and no surface is removed; the `npm:` spelling is the explicit form the other
schemes need to sit beside. What a spec never decides is what the plugin is called: the manifest's
`name` is the runtime identity and the installed directory's name, so two specs for one plugin are
one plugin, and D56's collision rule has one thing to compare.

**All of `config.json` is the engine's, sources included** — one writer, and the wrapper is not it.
That is what makes `rigline-engine list --json` load-bearing rather than a convenience: `update`
needs to know what it may move, and the wrapper asks instead of reading, because a second reader of
that file is a second opinion about what is installed.

**D56. A plugin name is unique across discovery roots, first root wins, and `add` refuses to make a
collision it cannot undo.** Discovery flattens its roots into one ordered list, so two directories
of the same name baked two registry entries, copied over each other into the payload, and loaded the
plugin twice — two setups, two mounts, two taps, and one name to blame them on. `add` is what made
that reachable, so the rule lands with it: discovery keeps the first of a name and reports the one it
shadowed, and `add` refuses a name already discovered outside `~/.rigline/plugins/` rather than
shadowing a plugin it does not own. Adding over a name already in `~/.rigline/plugins/` replaces it,
which is what re-adding a plugin you are working on means.

First root wins rather than last because the root order is also load order, and it is stated by the
caller: reading it one way for ordering and the other way for precedence would make the same list
mean two things. The shadowed directory is named rather than silently dropped, since a plugin
missing from the panel with nothing said about it is the failure P8 exists to refuse.

**`add`, `remove`, `disable` and `enable` re-inject.** D55 keeps `install` the one write command
about the *injection*; these are about the plugin set, and leaving the payload stale behind them
would mean a user who added or switched off a plugin has to know about a second command before
anything appears. `dev` already drives the installer for the same reason. The reload is still the
user's — nothing can avoid that — so the report ends where `install`'s does.

**A bundled name may be taken, and that is the one collision that is allowed** (amended
2026-09-21). The rule above refuses a name already discovered in a root `add` does not own, which is
right for this checkout's `plugins/` and wrong for core's `dist/bundled/plugins`: overriding a
bundled plugin is the point, because `~/.rigline/plugins` outranks the bundled set and that is what
repairs a broken first-party plugin without waiting for a release (D71). So `add` takes the name,
reports that the bundled copy is now shadowed, and discovery records the same fact on the winner
rather than logging it per collision. `remove` reads the same root and refuses, naming `disable`,
since there is nothing of the user's to delete and an engine update would put it back.

**D57. A tarball is read by a reader that refuses, not by an extractor that reproduces.** Node has
no tar, so this was a fork: depend on `tar`, which is general, battle-tested and streaming, or write
the reader. The reader, for the reason D47 gives about package managers — what we want from
extraction is not fidelity but refusal. A published tarball is flat ustar under one leading
directory, and everything Rigline needs is a list of `if` and `throw`: regular files only, no
absolute path, no `..` in any segment, no drive letter anywhere, no symlink, hardlink, device or
anything else with a type byte, a cap on entry size and on entry count, and exactly one root
directory — stripped, whatever it is called, because `npm pack` writes `package/` while `@types/*`
write `node/`, and a reader insisting on the first refuses a package the registry serves. That last
rule was written the other way and corrected by the first live fetch, which is the argument for
running one. A general extractor's job is
to put back what somebody put in; ours is to take a small flat set of files and decline the rest,
and the refusals are the part worth owning and testing. It also keeps `@rigline/core` at zero
third-party runtime dependencies, which for a package that rewrites an editor's own bundle is worth
something on its own — though that is the second reason, not the first, and if the reader ever
starts growing features to accommodate a real archive, that is the signal it was the wrong call.

**D58. A source pins an exact version and records the tag it was following; there are no ranges.**
`~/.rigline/config.json` already holds one version per plugin (D49), so a range would be a second
mechanism for deciding what is installed, disagreeing with the first the moment they differ. `add
<name>` resolves a dist-tag, `latest` unless another is named, and records both the version it took
and the tag it followed; `add <name>@<version>` records the version and no tag, which is a person
pinning and is respected — `update` reports it and moves nothing.

So "newer" means "the tag resolves somewhere you are not", never a comparison of version numbers,
and no semver ordering is computed anywhere. Following a tag backwards is therefore possible, and is
the right answer — a maintainer who moves `latest` back has un-recommended what it pointed at — so
`update` says which version it is moving from and to rather than assuming the number went up.

**A version too young is refused, never walked back from.** The obvious alternative — take the
newest version old enough, ordering by the packument's `time` map — was considered and rejected:
publish order is not tag order, so a patch published to an old line after the tag moved would be
installed as though the maintainer were recommending it, and installing a version nobody pointed at
is a wrong answer arrived at quietly. So the age gate is a gate. `add` refuses and names the
version, its age and `--now`; `update` leaves the plugin where it is and says the same thing, which
is what D48 means by a withheld version being reported rather than hidden. Only the resolved
version's own publish time is ever read.

**D50. The plugin template is a pnpm workspace holding many plugins; one plugin is that workspace
with one member.** The multi-plugin shape is a superset — it scaffolds correctly for one plugin,
whereas a single-plugin template cannot grow into a workspace without a restructure, and adding a
second plugin should be a directory copy. It also costs us close to nothing to write, being the
shape of this repo. `pnpm stage publish -r` stages only packages whose version is not yet on the
registry, so bumping one plugin releases one plugin and no changeset tooling is needed. The
harvested `generated.ts` is produced once at the workspace root by `rigline-engine codegen --out`
and imported by every plugin in the repo, since they all compile against the same installed
extension (D40, P7). A scaffolded workspace declares `@rigline/core` and spells the bin, never
`rigline`, which is a delivery mechanism and not a dependency (D69). pnpm is the template's package manager for what its defaults do rather than for
consistency with us: `minimumReleaseAge` defends the author's own machine and CI on exactly the
reasoning D48 applies to that author's users, and `allowBuilds` turns a dependency's build script
into an explicit grant. The cost of the shape is per-package npm setup — a trusted publisher is
configured per package, so each plugin needs its own entry naming the same workflow file, and its
own bootstrap publish (D46). That is friction on a second plugin, never on a second release.

**The template's dependency ranges are derived from the scaffolder's own version, never written by
hand.** A caret range excludes prereleases unless it names one with the same major, minor and patch,
so a template pinning `^1.0.0` produces a workspace that cannot install anything while the only
published versions are `1.0.0-alpha.*` — `ERR_PNPM_NO_MATCHING_VERSION`, on the first command the
guide tells an author to run. `create-rigline-plugin` therefore substitutes `^` plus its own
version, which is right while we are on alphas, is still right at 1.0.0, and never needs anybody to
remember to bump it. The first published scaffold had the hand-written range and was broken by it,
which is the argument for running the published artifact rather than the one in the tree.

**The scaffold ships CI as well as the release workflow, and the publishable metadata a scaffold
can know** (amended 2026-09-20). D59's argument, one level out: with only a release workflow, the
first thing that runs an author's tests is a release, and a contributor's pull request is checked
by nothing at all. `ci.yml` runs typecheck, build and test on the same three Node rungs, so the
`engines` floor a scaffolded workspace declares is one its own CI stands on — and a scaffold that
is cut back to a single rung should drop that claim to match.

**One dependency is hand-written, and has to be: rolldown** (amended 2026-09-21). `build` is a
convenience over rolldown (D13), and rolldown stopped being a published dependency when it became a
lazy import — undeclared and static, it threw before the command had read its own arguments, and it
put 20 MB of native binding in every published tarball. A scaffolded workspace had been getting it
transitively, so it declares its own now. The lazy import is also what makes `build` work after the
split: the engine resolves rolldown from wherever it sits, which in an author's workspace walks up
to that workspace's own `node_modules`, and in `<RIGLINE_HOME>/engine` finds nothing and fails by
name — correctly, because a build happens in a workspace and never against a user's engine. `__RIGLINE_RANGE__` cannot supply it: that
substitution is the scaffolder's own version, and this is the bundler's. It ships in the same
release that removed it from what a user installs, because a phase between the two is a published version where
`pnpm build` fails on the first command the guide tells an author to run — which is the failure this
decision already records happening once.

**A scaffolded workspace exempts the two Rigline versions it was scaffolded with from the
release-age gate, by version** (amended 2026-09-21). A workspace scaffolded on release day could
not install the release that produced it: `pnpm install`, the first command the README gives,
refused `@rigline/core` and `@rigline/plugin-api` with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`.

The gate is not a refusal in general — pnpm resolves to the newest version in range that is old
enough, so `vitest: ^5.0.0` installs on the day 5.0.1 ships by taking 5.0.0. What decides it is
whether the range's floor is itself the newest published version, because `^X` means `>=X` and a
floor with nothing beneath it admits one candidate. A derived range always has that shape, which is
why this bites on every release day and not only during the alpha line: when `1.1.0` ships, `^1.1.0`
admits `1.1.0` alone. A hand-written range only has it when somebody bumps a floor to a same-day
release — so the invariant to keep is *no dependency floor is the newest published version*, and the
template's hand-written floors satisfy it today by having been written earlier, which is luck rather
than a mechanism.

The exclusion is written as `name@version`, substituted with the scaffolder's own version, because
that is the exact extent of what justifies it. The author reached this workspace by running
`create-rigline-plugin@X` through `npm create`, which is that same release executing on their
machine with no gate at all, so holding its library half back for a day protects nobody. That
argument is about release X. It does not reach a `pnpm update` six months later pulling an
`@rigline/core` published ten minutes ago, where nothing has been spent and the gate should hold; a
scope glob would have exempted that, and every `@rigline/*` package not yet written, in every
author's repository. The stale entry left behind once an author bumps is inert, and naming versions
costs one more substitution.

Loosening the gate generally was the alternative, and is over-broad. pnpm 12.3 applies the same
1440-minute cutoff by default but does not enforce it — non-interactively it records the young picks
in `minimumReleaseAgeExclude`, in the tracked workspace file where they show up in a diff, and
proceeds. Setting `minimumReleaseAge` explicitly is what flips `minimumReleaseAgeStrict` on, at any
value, 1440 included. So this block's premise, that a default is not a position, is false for this
one setting: writing the default down is what makes it refuse, and both copies of that comment said
otherwise until this amendment. It stays written down, because a third-party dependency published
ten minutes ago is what the day is for and a recorded acceptance is still an acceptance.

The plugin manifest carries what a scaffold can know: the `rigline-plugin` keyword a plugin is
found by on npm, which nothing in Rigline reads, and `publishConfig.access`, inert on the unscoped
name it ships with and the difference between a publish and npm's least helpful error on a scoped
one. It does not carry `repository`, which is the one field a publish genuinely needs and a
scaffold genuinely cannot know: npm binds a provenance attestation to it, and a guessed URL is a
wrong one in the registry rather than a missing one (P8). So the release workflow refuses a
publishable package that has none, by name, before it builds anything, and the README says so
where an author is reading about their first publish. A `LICENSE` file is left out on the same
reasoning — the copyright line is the author's to write, and npm ships one whatever `files` says.

This does not weaken P6. The template is a convenience, exactly as the build preset is: a plugin is
one browser-target ES module and a manifest however it was produced, and one built with npm, yarn,
bun or a shell script is discovered, checked and loaded identically. What is published is the output
contract, never the toolchain — the template is how the good path is made the easy one, not a
requirement we could enforce or would want to. The package name stays singular, because
`create-rigline-plugin` is what an author types.

**D60. One root changelog, written as the change lands; a pushed tag is what starts a release
(2026-09-20, Leo).** Entries go under `## Unreleased` in `CHANGELOG.md` in the same commit as the
change they describe. `pnpm release <increment>` — `patch`, `minor`, `major`, `prerelease` and the
`pre*` pair — computes the version from what is in the tree, rolls that heading into it, sets it in
every `package.json`, commits, tags `v<version>` and pushes. The workflow triggers on the tag. One
commit carries the bump and the notes, and the release refuses to stage a version the changelog has
no section for.

An increment rather than a typed version, because a typed version is a number a person has to get
right twice — once against what is published and once against what they meant — and `semver.inc`
already knows both. The command prints what it computed before it writes anything, because the
answer is not always the obvious one: from `1.0.0-alpha.2`, all three of `patch`, `minor` and
`major` give `1.0.0`.

A tag rather than a dispatch input, because a release that begins in a browser cannot end in the
terminal it started from, and because the tag is the record. `git describe` resolves, the commit
that shipped a version is unambiguous, and the GitHub release has something to hang from. What makes
this safe here is the approval gate: a tag pushed by accident produces a stage nobody approves,
which expires. Tag-triggering a pipeline that published directly would be a different proposition.

The bump stays in a commit rather than moving into the workflow because of what `--provenance`
attests. A version staged from a runner-side edit is one no commit in the repository declares, so
the attestation names a tree whose `package.json` disagrees with the tarball; a workflow that bumps
*and* pushes fixes that but needs `contents: write`, and then attests a commit it created after
checkout rather than the one the tag names. Both are workable and both spend the audit trail D46
bought. Verification is the half CI is good at and can have for free: it reads the registry and the
tree and refuses a release whose facts do not line up, which needs no credential and no permission.

Every package moves together, so one changelog at the root is one file rather than four copies of
it. It is not in any tarball: `files` cannot reach above a package root, so shipping it would mean
copying it into four directories at pack time and ignoring four copies, which buys less than it
costs. Each package's README links to it instead.

**Not changesets, and not conventional commits.** Changesets earns its complexity on independent
per-package versions, and every version here moves in lockstep — and it wants to own publishing,
which is the stage-and-approve split (D46) and the last thing to put another tool inside. Commit
message conventions would generate the changelog from what is already written, at the price of
writing `ci: add dependabot config` where this repository writes *A bot watches the action pins,
because a person did not*. GitHub's generated release notes read merged pull requests, so they are
empty for a repository that commits to `main`, and they live where an installed tarball cannot see
them. The entry-file shape changesets uses is the right upgrade when a second contributor makes
`Unreleased` a merge conflict; it solves nothing for one committer working serially.

**D61. Both dist-tags are derived from the version and the registry; neither is ever chosen, and
`next` never moves backwards (2026-09-20, Leo).** There is no dist-tag input anywhere, because there
was never a judgement to make. Two sentences describe what the tags mean, and everything else falls
out of them: `next` points at the newest version, and `latest` points at the newest version a naive
`npm install` should get — which is the newest stable one, or the newest of any kind while no stable
one exists.

So the tag a release is staged under is computed: `latest` when the version is above what `latest`
holds and is either stable or the line has no stable version yet, `next` when it is above what
`next` holds, and otherwise nothing this pipeline can express. That last case is a release on a
superseded major — `1.2.4` while `latest` is `2.0.0` — which belongs on a line tag such as `1.x`
and is refused by name rather than approximated, because both of the tags on offer would be wrong
and one of them would be a downgrade for everybody.

`next` is then reconciled after approval: point it at the released version when `semver.gt` says the
release is newer, and leave it otherwise. It moves `next` up behind a release to `latest`, does
nothing after a release that was staged to `next` because the tag is already there, and declines to
drag `next` off a preview that is ahead of a maintenance release. The comparison is `semver.gt` and
not a string compare, which sorts `1.0.0-alpha.10` below `1.0.0-alpha.2` and would move the tag
backwards on precisely the release nobody would check.

**Amended 2026-09-21, after the first release drove it: `next` is not maintained at all while no
stable release exists.** Until then `latest` already means "the newest of any kind", so a `next`
beside it names the same version and says nothing — and the reconciliation is a separate
authenticated write per package, every release, because `npm dist-tag` cannot batch and each
invocation asks for its own second factor. Four browser round trips to make one pointer agree with
another, which is the trap this file's own runbook names: publishing to the tag you want beats
moving a tag, and a moved tag with nothing new under it is the case to avoid rather than the case to
automate.

Unset is also the better failure (P8). A tag nobody moves becomes a tag resolving to something
several releases old, and `install <pkg>@next` erroring is worth more than it quietly handing over
`1.0.0-alpha.1`. So the existing one is removed rather than left behind.

Nothing is lost for what the tag is for. A preview opens its line by staging *under* `next`, which
publishes to the tag rather than moving it; a maintenance release with a preview ahead already left
it alone; and the one release that has no version to publish there — a promotion carrying `next`
forward onto the stable version superseding the preview — has a stable line by definition, so it
still moves. The rule that changed is one condition: no stable line, no `next`.

CI cannot do this half, for two reasons that hold independently. npm's OIDC exchange authenticates
`npm publish` and `npm stage publish` and nothing else, `dist-tag` included; and `otplease`, the
wrapper every 2FA'd write goes through, returns the original error unless both stdin and stdout are
a TTY, so a runner has no second-factor path at all. The only way round either is a long-lived
token with publish rights in a repository secret, which is the credential D46 exists to remove —
and npm has been removing it anyway, having revoked classic tokens and capped granular write tokens
at ninety days. So the retag belongs to `pnpm release:finish`, beside the approval it has to follow:
a tag cannot point at a version the registry does not have yet, so this was never work that could
happen before approving. The GitHub release is created there too, for the same reason — it should
appear when the packages become installable, not when a stage nobody has approved goes up.

It runs through the npm CLI rather than pnpm's. `npm dist-tag` calls the same `otplease` as `npm
publish`, whose first branch opens a browser when the registry offers one — so it completes against
a security key, where `pnpm dist-tag` takes a typed code and nothing else. That distinction is now
permanent rather than an inconvenience: npm stopped accepting new TOTP enrolments in September 2025
and is retiring the ones it grandfathered, so a design resting on a typed code is a design with an
end date.

**D62. `main` is the line `latest` points at, or the line that will next point at it; every other
live line has a branch named for it (2026-09-20, Leo, amended the same day).** Routine work and
maintenance releases happen on `main`. The next major lives on one long-lived branch until it
ships, and then *becomes* `main`; if the old line still needs support, `1.x` is cut from its last
tag at that point. Merge `main` into a line branch and never the reverse, so the branch carries
every maintenance fix as it lands and the handover is a fast-forward.

*Or the line that will next point at it*, because `main` holds the preview through a preview
window: while it carries `1.3.0-beta.1` the tag on it is `next`, and `latest` is several commits
behind. The stricter wording is false for exactly as long as a preview takes, which is not a
window to have the invariant off in.

Every live line that is not `main` has a branch named for it, `<major>.x` or — where the line is
narrower than a major — `<major>.<minor>.x`. The narrow form is what that same preview window
needs: `main` at `1.3.0-beta.1` has no increment that produces `1.2.4`, so a hotfix to the released
`1.2.3` is a `1.2.x` branch cut from its tag.

**One preview line at a time**, until line tags exist. Two of them both want `next`, only the
higher one can have it, and the lower becomes a line whose releases are installable by exact
version and nothing else. The pipeline does refuse rather than mis-tag — the second line's next
release is below both tags, which is the refusal `stageTag` already carries — but it refuses at
the end of a green run, and the constraint is cheaper kept than discovered.

The rule is a convention for people, not an input to anything. No script reads a branch: a version
is computed from the checkout, a dist-tag from that version and the registry (D61), and a tag names
a commit. That is what lets two release lines run at once for no machinery — each branch's
`package.json` holds its own line's version, so the same command with the same argument computes
`1.2.4` on `main` and `2.0.0-alpha.2` on `2.x`, and nobody has to say which line they are on.

`main` tracks the released line rather than being the development trunk, which is the less common
half of this and costs a long-lived branch that drifts. It buys the thing that matters more here:
what a person gets by cloning is what they get by installing, and the routine case needs no branch
at all. The drift is paid down by the merge direction above rather than at the end.

The changelog is the one file this reliably conflicts in, since both lines append under
`## Unreleased`. Resolved at merge, keeping both sides in version order (D60). An entry-file layout
would remove the conflict and is the known answer if it ever stops being a minute's work.

**D71. The first-party plugins ship inside `@rigline/core`, discovered in place, versioned with the
engine (2026-09-21).** `dist/bundled/` carries `pre.js`, `post.js` and session-id, time-marks,
worktree-prefix and probe — each as its `rigline.json` and the entry that manifest names, never
rewritten to a flatter path, because a transform in the one step whose job is to move bytes
faithfully costs the property the step is for.

Core rather than the wrapper, because core is what injects and what discovers, and the phase 5 companion
extension consumes core and will need the same assets (D31). The copy is a workspace step,
`scripts/bundle-assets.mjs`, and not part of core's own build: plugins build through `rigline
build`, so a build-order edge from core to the plugins would be a cycle.

**Discovered in place, never copied into `~/.rigline/plugins`.** Copying would make them look
user-owned, break `remove`, and mean an engine update did not refresh them. In place means a
re-inject *is* their update, and it is why `rigline.json` carries no version and `list` reports
`CORE_VERSION` for a bundled plugin rather than reading one.

The roots are, in precedence and load order (D56): this checkout's `plugins/` when the engine is
running from it, then `~/.rigline/plugins`, then `dist/bundled/plugins`. **The user's directory
outranks the bundled set**, so a fork installed over a bundled name wins — the escape hatch that
repairs a broken first-party plugin without waiting for a release, in the spirit of D44. `add`
therefore allows a name only the bundled set holds, where it still refuses one taken in a root it
does not own, and `remove` refuses a bundled name and sends you to `disable`.

**Overriding a bundled plugin is a fact about the winner, not a line in a log.** Discovery is told
which root is the bundled one and records `overridesBundled` on the plugin that won, emitting
nothing: in this checkout all four are found twice, so a shadowing line per collision would put four
lines under every installed version of every install, describing the design working. `list` and
`add` carry it instead, which is where somebody is asking. A line in the install report was the
obvious alternative and cannot be right — `install` discovers once per extension directory, so there
is no "once" available to it.

**The checkout root is found by a marker, not by counting directories.** Walk up from core's own
module URL to the nearest `package.json`, take `<that dir>/../..`, and use it only when its `name` is
`rigline-workspace`. The same walk resolves `dist/bundled`, which is what makes it work under
vitest's alias to `packages/core/src`, in `packages/core/dist` when built, and in
`node_modules/@rigline/core` when published — three resolutions where a fixed offset from
`import.meta.url` is a different answer each time. What it replaces resolved to
`<npm-global-prefix>/plugins` from a published install: a directory that does not exist and was
therefore skipped, which is a right answer arrived at by accident and the shape of the accident this
milestone exists to end.

**`bundledDir()` refuses a stale bundle, and the chain is two links.** `dist/bundled` must be newer
than `packages/host/dist` and each `plugins/*/dist`, *and* each of those newer than its own `src`,
because a stale `host/dist` copied faithfully into a newer `bundled` passes the first link alone —
and what you then have is a green run reporting a property of code that is not loaded, which is
worse than a red one. Both links live in the resolver and `preparePayload` has none of its own, so
the harness inherits the whole rule by copying from `dist/bundled` rather than keeping a second
source of truth. The guard runs only where the workspace marker holds: a published install has no
`src` to compare against and its bundle was built by the release that produced it.

`bundle-assets.mjs` stamps each copy with `utimesSync`, which is not cosmetic. `cpSync` carries the
source's modification time across on Windows, where `CopyFileW` preserves timestamps whatever Node's
`preserveTimestamps` says, so every copy read as exactly as old as its source and the guard fired on
a bundle made seconds earlier.

**D72. probe's home is settled; the other three are bundled for now (2026-09-21).** Probe is not only
a badge: it registers two composing `rename_tab` rewriters that cancel each other, so it is a live
self-test in the user's editor and the test of whether the contributed-check shape is right (D63 to
D68). Moving it into `post.js` would let the plugin-facing API rot unwatched. The other three are
bundled because a default install must work, and may move out when there is a reason.

Any of them may be switched off, which is what `rigline disable NAME` and `rigline enable NAME` are
for — engine commands, since they change what gets baked, and both re-inject, because the registry is
baked at install time (D14) and nothing changes until the payload is rewritten. `disable` refuses a
name no root has, rather than writing a rule about a typo into `config.json` while the plugin the
person meant goes on loading.

**D75. The payload records the engine version that wrote it (2026-09-21).** `install` bakes
`export const engine` into `registry.js`, so a stale injection stops looking identical to a current
one — nothing else on disk distinguishes a payload three releases old from the one this engine would
write, and after an upgrade that is exactly the question.

`registry.js` and not a JSON file beside it. The webview cannot fetch (D-level physics: no
`connect-src`), so anything the probe reads has to be a module the post hook already imports, and
`registry.js` is baked by the same `install` that knows the version. One fact, one file. The Node
readers pay for that with a bounded regex over a line this repository writes itself, which is
cheaper than two writes of one version that can disagree; `doctor` reports it against
`CORE_VERSION`, `check` names a version whose payload an older engine left behind, and the kernel
puts it on diagnostics so a plugin reads it the way it reads every other host-provided value and
never imports the host (D18, D63). A payload with no stamp is *unstamped*, never unreadable: it is a
fact about the payload's age, and filing it as a registry problem would suppress the plugin list of
an install that has one.

**D76. The companion extension is sideloaded by `rigline`, not published to a marketplace
(2026-09-21).** The risk phase 5 was recorded as carrying — Marketplace policy on an extension that
patches another extension — turns out not to exist. Microsoft's trust model is publisher-based, not
capability-based; the extension host has VS Code's own permissions and nothing distinguishes writing
to a sibling extension's directory from any other write. The precedent is live and explicit:
`subframe7536.custom-ui-style` advertises "patch files in other VSCode extensions" to a hundred
thousand installs, and the older loaders patch VS Code itself.

The binding constraint is Anthropic's, not Microsoft's (D77), and that reframes what a marketplace
listing costs. It buys discoverability and self-update. It does not buy the feature: a sideloaded
VSIX re-injects exactly as well, because the benefit is the watcher running unattended and the
watcher does not care how it was installed. So the listing is the one irreversible move available
and the one with no unique payoff — publishing can always happen later, a takedown cannot be undone,
and Open VSX is the lower-profile registry if a registry is wanted. `rigline` installs the VSIX and
`rigline update` moves it, which is the loop the wrapper already owns for the engine (D69).

**The companion buys one thing, and it is the thing P8 is about.** An extension update installs a
fresh directory and deletes the old one, so the injection silently reverts: everything green,
features quietly absent, weekly. The watcher already exists in core and `rigline watch` is already a
verb; the companion is a host VS Code starts for you, not new capability. Inside the extension host
it gets one signal the CLI cannot have — `extensions.onDidChange`, which shortens the latency to the
directory scan the CLI already does (`update/watch.ts`) rather than replacing it. The poll stays as
the floor regardless, because that event's own bug history is a record of it not firing, and a hook
that silently does not fire is the failure mode this project has a principle against.

**Amended 2026-09-22 — `extensionUri` is not the second signal this entry originally claimed.**
`getExtension("anthropic.claude-code").extensionUri` looked like an authoritative answer to which
directory, better than a scan; it is not, because it answers where *this host* loaded the extension
from, which is fixed until the host restarts. A window watching it cannot see an update land while
its own host is the one frozen on the old directory — read live on 2.1.269, ninety seconds and three
poll cycles produced no reaction at all. Scanning the extensions directory is what actually restores
reacting while the old extension is still live; `extensionUri` keeps the narrower job of telling the
reload decision what *this window* loaded (D82).

**Amended 2026-09-22 — the offer is for a window that restarted first.** With the directory scan,
the patch lands on disk while the old extension is still live, and the next reload comes up patched
in silence, which 8b read live on a real replacement. The reload offer covers the other case: a host
that came up over a directory not yet patched, usually because VS Code's own restart prompt was
accepted before the companion finished (D85). It is decided from the bytes rather than the exit code
(D82). `workbench.action.webview.reloadWebviewAction` is a real registered command the companion can
offer for a payload-only change; a host patch asks for a window reload instead. Offer, never take:
reloading webviews ends the in-flight turn of every Claude session in the window, which is not a
thing to do to somebody unasked.

**D77. Rigline states its compliance position publicly and invites Anthropic to correct it
(2026-09-21).** The Claude Code extension is `© Anthropic PBC. All rights reserved.`, and three
clauses touch us. "The Claude Code binary must not be modified" is scoped to preinstalling or
hosting Claude Code in a product you ship, which Rigline does not do — and the binary is untouched
regardless; what we modify is the extension's bundles. Building a competing product is not what this
is, by every reading.

The exposed part is neither of those: it is **the harvest, not the injection**. Reading a minified
bundle to derive identifiers is the closest thing here to "otherwise reduce our Services to
human-readable form" (Consumer Terms §3, Commercial D.4). We think it is interoperability, and the
clause's own carve-out for restrictions "prohibited by applicable law" plus Australia's Copyright Act
s47D point that way. We are not confident enough to leave it unsaid, which is the point of the
position: [anthropic-compliance.md](anthropic-compliance.md) names the awkward clause itself rather
than waiting for it to be found, and is linked from the top of the README rather than buried.

The standing offer is real and binding on us: if Anthropic asks Rigline to stop, it stops, with a
final release that restores every install to Anthropic's own bytes. That costs nothing to promise —
`rigline restore` is already the recovery path and is exercised on every uninstall — and it is the
difference between a project that has thought about this and one that is hoping not to be noticed.

**Silence is the expected answer, and it blocks nothing.** Leo owns the approach to Anthropic and
expects no reply; a project this size is unlikely to reach anybody's desk. So no phase waits on one,
and no session should treat the absence of a response as an open question to chase. Nor is it
approval: if somebody later writes that Anthropic were fine with this, the honest sentence is that
they were asked and did not answer. What a reply would change is recorded where it lands — D78's
trigger if they object, D76's channel decision if they would rather it were listed.

**D78. Install-time-only signature verification is a premise, not a guarantee (2026-09-21).** VS
Code verifies an extension's signature when it installs it and not afterwards, which is the fact the
entire project rests on — CLI and companion alike. It is not a commitment Microsoft has made, it is
current behaviour under active pressure: a steady stream of verification bugs, and published
research on tampering with "verified" extensions post-install. If load-time integrity checking
arrives, Rigline ends, and nothing in the architecture defends against that.

Recorded because it is invisible from the code and would otherwise be rediscovered as a bug. The
trigger to watch is any VS Code release note about extension integrity at activation; the response
is to stop, not to evade one. Defeating an integrity check is a different act from patching a file
nothing checks, and it is not an act this project is willing to commit — the checksum-fixing
extensions are precedent we decline rather than precedent we follow.

**D79. Plugin obligations are stated, not enforced, and the licence stays MIT (2026-09-21).** The
compliance position (D77) makes claims about Rigline while Rigline ships a plugin system, which is
the first question a reader has and the doc did not answer. The answer is two things kept apart, and
blurring them is the failure mode.

**What the architecture makes impossible is a guarantee we can stand behind.** No plugin can make a
network request, because the CSP is `default-src 'none'` with no `connect-src` and obfuscation
cannot reach an egress that is absent. None reads a file or touches the extension host. None
executes in Node: a host patch is a declared equal-length byte substitution, not code. None runs at
install time. Bus writes are outbound, patch-shaped and confined to declared fields. That holds for
a hostile plugin exactly as for an honest one, which is why it is worth more than anything we could
promise about author behaviour — and it is containment rather than safety, since a plugin still
renders what it likes and the CSP does not stop a convincing lie.

**What the boundary does not cover is asked, and we say plainly that nobody is checking.** Claiming
to police deception, clipboard exfiltration or a link carrying content out would be whack-a-mole
against people who can obfuscate, and entering that game means owning every round lost (Leo,
2026-09-21). So [plugin-policy.md](plugin-policy.md) is a statement of obligations with an explicit
section on what we do not police: no source review, no detection claim, and response rather than
prevention — declarations that make a mismatch findable, control over what we bundle and recommend,
and withdrawal when told. A compliance document that claimed no plugin could ever misbehave would be
disproved in an afternoon, and the credibility is the entire point of publishing one.

**The licence stays MIT.** A field-of-use restriction would stop Rigline being open source under
OSD §6, bar it from distribution channels, and deter nobody willing to write a malicious plugin
while burdening every honest author. Copyright is also the wrong instrument: it governs copying, and
a plugin that imports types and calls `ctx` is a weak candidate for a derivative work. The levers
that work without a licence change are the boundary, the manifest, what we choose to bundle and
recommend, and permission to use the name — the last being what gets withdrawn first.

Surfaced where an author actually is: the scaffold's README where it learns what a plugin declares,
the `create-rigline-plugin` next-steps output, [authoring.md](authoring.md) in the section that
already covered trust, `rigline add` for whoever installs a plugin that is not ours, and a plugins
section in the compliance document itself. None of it conditional on publishing: a plugin somebody
wrote for themselves modifies Anthropic's extension exactly as much as a published one, and a policy
filed under "before you publish" is one a personal-plugin author never reads.

**D80. The companion extension is a second retrieval layer, not a scheduler (2026-09-21).**
Confirmed by Leo: it plays the role `rigline` plays, in a different shell. It installs and updates
`@rigline/core` under `<RIGLINE_HOME>/engine` over npm and runs that engine for every piece of work
— a peer of the `rigline` package rather than a client of it, and never a copy of the engine.

Embedding core in the VSIX was the shorter path and is wrong for D69's reason one layer up. A VSIX
carrying its own copy puts a second engine on the machine; `rigline update` can move only one of
them; the injection on disk then depends on which ran last. That is D75's condition — a stale payload
indistinguishable from a current one — manufactured weekly with two candidates and no way to tell
which wrote what. One engine owns bytes, and everything else acquires it.

**This repairs D76's weakest point.** Sideloading's known cost is that VS Code does not auto-update a
hand-installed VSIX. Under D80 that stops mattering: the shell is stable and the engine moves
underneath it, so a user gets new engine behaviour, new anchor tables and updated plugins without the
VSIX moving at all. It also makes the VSIX a complete Rigline for somebody who never opens a
terminal, which is a better story than requiring the CLI first.

**The companion is optional and the CLI stays complete without it** (Leo, 2026-09-21). Two paths,
not a path and a prerequisite: `rigline install` after each update is the whole of Rigline and gains
nothing from the companion existing, and `rigline vscode-setup` is for somebody who would rather not
remember. Declining it must cost a user nothing — no feature only the companion can reach, no
message implying they are half-configured, and `--remove` puts them back without touching the
injection.

Worth recording rather than leaving to phrasing, because the pressure runs one way. A companion that
is always installed is the easier thing to develop against, and each convenience put only there is
invisible until somebody who declined it asks why a document describes a Rigline they do not have. A
locked-down machine cannot install an extension at all, and that user is not a lesser case.

Two costs, whose mechanics are in [companion.md](companion.md). **There is no npm beside the
extension host**: `process
.execPath` is VS Code's Electron binary, so `findNpmCli` finds nothing. D73's rule survives —
npm must belong to the Node that runs it — and only the starting point moves: resolve `node` first,
then take the npm beside *that*. `ELECTRON_RUN_AS_NODE` supplies an interpreter, not an npm, and does
not help. **And two retrieval layers write one directory**, so acquisition needs a lock; injection
does not, being rebuild-from-backup and idempotent.

The earlier draft had the companion refuse when no engine was present, reasoning that an extension
quietly fetching from npm is what a reviewer would object to. Withdrawn: it is the same act `rigline`
performs on first run, for a user who installed a VSIX called Rigline, and refusing would mean the
companion could not do the one job it exists for. It says what it fetches and reports the result
rather than declining to fetch — which is P8 rather than an exception to it.

**This amends D69, which said `rigline` appears in no project's dependencies.** `packages/vscode`
declares it, and the guard test now allows that one package by name and exactly — a second entry
fails there rather than passing quietly. The amendment is narrow because D69's argument is narrow: a
project that can declare dependencies should declare `@rigline/core`, since taking the shell when
you can have the substance is the payload mistake one layer down. The companion is the case where
the substance is what must be avoided. It never runs the wrapper's bin; it bundles one module for
acquisition, so nothing reaches a registry at build time and the slow pnpm failure D69 warns about
cannot happen.

**Reuse cost the wrapper a parameter, which is the whole of what sharing meant here.** `engine.ts`
had `process.execPath` baked into four call sites — locating npm, running it, and running the engine
twice — all correct for a Node process and all wrong inside Electron. `EngineOptions.nodePath`
defaults to `process.execPath` and changes nothing for the CLI. Finding what to pass it is the
companion's own module, because the wrapper never needs to search: it is already running the answer.

**D81. Nothing reacts to an extension directory that is still being written (2026-09-21).**
`settleWebviewBackup` makes the live bytes the pristine backup in two of its branches: when there is
no backup yet, and when live and backup share no relation. Both are right about a real new version
and catastrophic about a half-written one — the fragment becomes what `index.js.orig` holds, so
`restore` restores a broken bundle and the harvest reads a prefix. It is silent in both directions:
the backup looks like a backup, and the run reports success.

**The first branch is the one that matters, and the first draft of this entry named the second.** An
update installs a *new directory*, which by definition has no backup, so racing it takes the
no-backup path every time. The replaced-in-place branch only applies to a reinstall over an existing
directory, which is the rarer event.

The CLI's watcher was accidentally safe: polling every thirty seconds, it lands long after an
install. `extensions.onDidChange` is not, because it fires while VS Code may still be writing, so
adding the fast path (D80) created the exposure and has to pay for it. The companion therefore
samples sizes and modification times of `extension.js`, `webview/index.js` and `package.json`, waits
two seconds, samples again, and reacts only when the two agree — ten attempts, then it leaves the
move for the next poll rather than reacting to a directory in motion.

**A move that did not settle stays outstanding**, which is the half that is easy to get wrong.
Recording the new path before reacting would make the next poll see no change and skip the update in
silence, which is the failure the whole milestone is against; so the watcher commits the path it has
seen only once the move has actually been dealt with.

Whether VS Code writes to a temporary directory and renames it into place — which would make all of
this unnecessary — is deliberately not assumed either way. The cost of defending is a few seconds on
an event that happens weekly; the cost of being wrong is a backup nobody can trust.

**The same exposure exists in the CLI's watcher and in `install` itself**, where a person can run
either mid-update. `install` now refuses a directory that is not finished — every file present and
non-empty, and a `package.json` that parses with a version — before it reads or writes anything.
[partial-bundles.md](partial-bundles.md) is the slice, and carries what is still owed.

**A content check was evidenced and then rejected**, which is worth recording so it is not
re-proposed. Requiring each bundle to end on a closing brace works today — all four corpus versions,
both bundles each, end `}` and a newline — and would catch a truncation that the structural checks
miss. It was dropped because a build that appended a `//# sourceMappingURL=` line, the commonest
tail in JavaScript, would make it refuse *every* install on the day of a version bump. Trading a
rare silent bug for a certain loud outage is the wrong direction, and absent beats wrong (P8). A
test asserts the check tolerates exactly that tail, so the reasoning is enforced rather than
remembered.

**D84. The companion's plugin surface stays read-only; enable and disable remain CLI-only
(2026-09-22).** `config.json` is the one place plugin state lives, and the CLI already writes it and
re-injects (D55, D56). A VS Code settings page or tree view that let somebody toggle a plugin from
the extension would have to mirror that state, which creates a second place it can be read from —
and one that goes stale the moment the CLI, `rigline dev`, or another window's companion changes the
file out from under it. That is a synchronisation problem with no owner, for a feature `rigline
disable NAME` already delivers from a terminal.

**8c adds visibility instead of editing: one Command Palette entry**, `rigline.showPlugins`, that
reveals the output channel and spawns the engine's own `list`, reusing the line-by-line pipe D82's
fix already built rather than a second formatter — the same report a terminal gets. It resolves
whatever engine is already on disk with `ensureEngine` alone, never `updateEngine`: a viewing command
has no business checking npm for a newer engine, and `ensureEngine` is a pure local read when one is
already present (`readEngineState` returns `ready` and nothing calls `resolveEngine`).

**D85. `Health` gains `ready`: quiet is not the same as invisible (2026-09-23).** Live read: Leo
waited for the status item to say a newly landed Claude Code version had been patched, saw nothing,
and accepted VS Code's own "Restart Extensions" prompt before the companion had actually finished —
which produced the window-reload offer, working as designed, since 8b already names "the user
reloaded before we finished" as one of the two triggers for it. What was missing is not that offer;
it is any way to tell in advance that waiting a little longer would have avoided needing it. A
`moved` reaction's success reverted the status item to the same `ok` icon and text a window with
nothing new to do ever shows, so "already patched" and "still working on it" were indistinguishable
unless you caught the `working` spinner mid-flight.

The fix stays inside the existing principle rather than relaxing it: no notification, `attention`
keeps the only interrupt. A `moved` reaction now lands on `ready` instead of `ok`, and stays there
until a restart runs the whole flow fresh. No command on click, unlike `stale` — there is no
outstanding offer behind `ready` to re-show, only information.

**The status item answers the user's questions and reports nothing else**: is Rigline running in
this window, is an update ready, does something need me. A directory going away changes none of
those answers, and it is not work either — every directory still installed was patched when it
arrived or when the window started. So the watcher records a removal and reacts to nothing, and
`moved` always carries an arrival. Reacting to one used to re-run the flow and land back on `ok`,
putting back over `ready` the very look this decision removes. An uninstall followed by a reinstall
needs no removal reaction: the reinstall is an arrival.

### Toolchain and verification

**D34. Toolchain: pnpm 12, TypeScript 7, Rolldown for browser bundles, Vitest, Biome with
semicolons required.** Vite is rejected: its value is a dev server and HMR, neither available in a
webview we do not own.

**D35. Inline source maps in the injected payload; none at all in the published packages.** The
webview CSP makes a sibling `.map` fetch a gamble, so `pre.js` and `post.js` carry theirs inline.

The published packages are the opposite case and were shipping maps by accident. tsc writes
`sources: ["../src/foo.ts"]` and, without `inlineSources`, no `sourcesContent` — so a map in a
tarball that contains no `src/` points at nothing. It cannot map a stack trace and cannot jump an
editor anywhere, while accounting for 37% of `@rigline/core`'s unpacked bytes. `files` excludes
`dist/**/*.map` in all four; the build still writes them, because they work in the working tree,
which is where anybody debugging this code actually is.

The alternative — `inlineSources`, making them work by embedding every `.ts` in the tarball — is a
real option for later and a different decision: it trades the whole source, shipped twice over, for
mapped stack traces in a consumer's terminal. It is also what the *injected* payload already does:
`pre.js` and `post.js` carry their sources inline, which is three quarters of their bytes and the
only reason a webview with no `connect-src` can be debugged at all.

**`@rigline/core`'s `dist/bundled` breaches both halves, and the same argument excuses both**
(amended 2026-09-21). It is about 800 kB, three quarters of it inline source map, and the bundles
keep their comments. That is said here once so that nobody reads the two rules above, sees the
tarball, and "fixes" it: these are not published *declarations* or published tsc output but the
payload itself (D71), which is injected into a webview where a sibling `.map` fetch is a gamble and
there is no console to read a stack trace in. Stripping either would leave the one surface that
cannot be debugged any other way undebuggable, to save bytes on a package that is installed once.
The rule above is about `dist/**`; this is the carve-out for `dist/bundled/**`.

**The published JavaScript carries no comments, and the published declarations do.** This codebase
annotates heavily and those notes are written for somebody changing the code, which happens in the
repository, not in a consumer's `node_modules`. `@rigline/plugin-api`'s declarations are the
exception that proves what the rule is for: its comments are not notes about the implementation but
the documentation a plugin author reads on hover, and it is the one package whose whole job is to
be read from another repository's editor. TypeScript has a single `removeComments` governing both
emits, so plugin-api emits its declarations from a second config that turns it back off.

**D36. Verification is split four ways.** Node tests for pure functions and file transforms,
against throwaway copies and the corpus, never the live extension; the probe plugin for the real
webview, one check per capability, `n/a` where a check cannot apply on a surface; and a Playwright
tier that boots the real bundle from the corpus with a faked `acquireVsCodeApi` and a replayed bus,
which is `packages/harness`.

**The fourth is the tarballs, installed** (2026-09-21, amended the same day). `pnpm pack` — never
`npm pack`, which leaves `workspace:*` in the manifest — then the tarballs into a temporary prefix
with `--ignore-scripts` and `--offline`, and `install` run out of that prefix against a fixture
extension directory. Since the wrapper and the engine separated it is **two** prefixes, because that
is what a user has: `@rigline/core` and `@rigline/plugin-api` into a temporary `RIGLINE_HOME/engine`,
through the same argv construction the wrapper would have used, and `rigline` on its own beside it.
The registry resolve is the one step that cannot happen here and is tier 1's. It is a tier rather than a test because it asks a question none of the other three can:
every one of them drives this workspace, where a relative path from `packages/cli/dist` happens to
reach `packages/host/dist` and `plugins/`. Installed from npm those paths reach nothing, and
`rigline install` threw `payload is missing pre.js` for two releases while every tier was green. It
lives in `packages/cli/test/packed.test.ts` and runs under `pnpm test`, so
[verification.md](verification.md)'s "everything but the probe runs under one `pnpm test`" stays
true: a check that has to be remembered is a check that answers a question nobody asked on the day it
mattered, which is the whole diagnosis of what it exists to catch. It costs about a second.

It asserts what the command *did* — payload written, four plugins baked, "injected" printed — and
not its exit code. A synthetic bundle carries none of the curated anchors, so every plugin's
declaration check fails against it and `install` exits 1 to say a person is needed, which is D27
working rather than a failure: a refused plugin is still copied, still baked, and never blocks the
injection.

**D37. Byte-faithful I/O for every bundle read and write; LF in the repository, the platform's own
convention in the working tree** (amended 2026-09-19, Leo). Text-mode I/O on Windows rewrites every
line ending and turns a 133-byte patch into a 2.2 KB one, so every bundle read and write goes
through Buffers. That is a rule about *our code*, and it was originally paired with `eol=lf`, a
rule about everybody's checkout — which bought nothing and cost every tool that writes a file here
having to be taught about line endings. `* text=auto` normalises on commit instead, so history
never depends on who checked a file out and no tool has to care. The exception is a file whose
bytes we generate and then compare against what is on disk: `generated.ts` and the committed JSON
schema are pinned `eol=lf`, and codegen normalises its own output, because otherwise `codegen
--check` would pass or fail by platform.

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

**A rate needs a timestamp, or it is a cumulative counter wearing a better label** (amended
2026-09-21, from the first live read of a published install). Counting one event is the only thing
that closes a window, so a meter that *stops* firing never closes another one and keeps its last
value for the life of the panel. The first probe report off a fresh install said `tapClone 18/s` on
a session list that had been idle since boot — a boot burst read as sustained load, which is this
decision's own failure mode reintroduced by the mechanism meant to fix it, and worse than a total
because it looks actionable.

No timer can expire it without a timer per meter on a path that already clones payloads, so the
window's closing time is recorded — one assignment beside the one already there — and the *reader*
decides: a window that closed more than two seconds ago describes a meter that has gone quiet, and
quiet is zero. Two rather than one because a window closes when the next event arrives, so a steady
one-per-second closes slightly late and a one-second threshold would flap on exactly the traffic
that is fine. The peak is untouched, because what a meter got to is a fact about the session rather
than about this second.

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

**D59. The tests run on every push and every pull request, over a Node matrix, and the matrix's
lowest rung is the floor the published packages declare.** Before this, the release workflow was the
only thing that ran them: tolerable while the repository was private, and not once it was public and
asking for contributions, because a pull request then arrives with nothing checking it and the first
run of anybody's change is a release. `.github/workflows/ci.yml` runs `lint`, `typecheck`, `build`
and `test` on each rung, `build` before `test` because the harness drives the built payload (D36).
Lint and typecheck repeat on every rung rather than earning a job of their own; they cost seconds,
and the conditional that would run them once costs a reader more than it saves.

**The floor rung is an exact version because it is a claim, not a sample.** `rigline`,
`@rigline/core`, `@rigline/plugin-api` and `create-rigline-plugin` declare `engines.node` as
`>=22.12.0`, and 22.12.0 is the version CI runs — so the number in the manifest is a number
something ran, which is the whole reason the matrix earns its place. The other rungs float to the
latest of their major, because what they assert is *this major is supported*, not *this patch was
tested*. Moving the floor means moving the rung first; the number then goes in the same six places,
the four published manifests, the workspace root, and the template the scaffolder ships.

**A fourth row is Windows, at the floor rung again** (2026-09-20, Leo). Three Linux rungs plus
`windows-latest` on 22.12.0, rather than a second axis. This machine develops on Windows at Node
26 and runs the whole suite there many times a day, so the pairing nothing covers is Windows on an
older Node; a full OS axis would mostly buy CI coverage of what a maintainer already does by hand.
Pinning the Windows row to the same 22.12.0 the Linux floor uses leaves exactly one variable
between those two jobs, so a red one here means Windows rather than Node. macOS remains untested
anywhere, which is the honest state rather than an oversight.

What that row is most likely to catch is line endings. `* text=auto` gives a Windows checkout
CRLF, and the two files whose bytes we generate and then compare against disk — `generated.ts` and
the committed JSON schema — are pinned `eol=lf` for precisely that reason (D37). Until now that
pin was a comment asserting something; it is now a thing a run proves or disproves.

The floor is the toolchain's, not the code's. These packages import `crypto`, `fs`, `os`, `path`,
`url`, `util` and `zlib` and nothing else, and would run on Node far older than this; 22.12.0 is
where vitest starts, so it is the oldest Node this repository can run its own tests on, and a floor
below the oldest one we can test is a number nobody has stood on. Node 20 is not a rung: it went
end-of-life in April 2026, and rolldown asks for 20.19 in any case.

**A CI run is weaker than a local one, by construction.** The corpus lives outside the repository
(D36), so every tier-2 file and every corpus-backed tier-1 test skips there with a reason. CI
proves the pure functions, the transforms and the synthetic fixtures on every row of the matrix;
it cannot prove that a harvest regex still reads real minified output. That is what a maintainer's
local run is for, and why [releasing.md](releasing.md) says to do one before a release.

**Actions are pinned to a major, except where the major points backwards.** `pnpm/action-setup` is
pinned to `v6.1.0`: its `v6` tag still resolves to the last release before pnpm v12 support, and the
`v4` this repository started on runs on the node20 runner GitHub has deprecated — a warning now and
a failure on somebody else's schedule. Both halves of that are worth the habit: read what a floating
major actually points at before trusting it to be the newest thing under that number, and treat a
runtime deprecation warning in a green run as work already scheduled for you.

**And a bot watches those pins, because a person did not** (2026-09-20). `.github/dependabot.yml`
opens one grouped pull request a week when an action has moved, and CI checks it like any other.
The `v4` above was six months behind upstream the day it was written here, and what found it was
somebody reading a warning inside a green run. It is `github-actions` only: pointing it at `npm`
would have Dependabot rewriting `pnpm-lock.yaml`, and how that sits with `minimumReleaseAge`,
`blockExoticSubdeps` and `allowBuilds` (D46 to D48) is worth establishing before a bot touches
that file rather than after. Its own three-day cooldown on a version update is stricter than
D48's day, so that much of the posture survives the question either way.

Two things it does not reach, both worth knowing rather than discovering. The scaffolder's
template carries its own workflows under `packages/create-plugin/template/.github/workflows/`, and
the `github-actions` ecosystem reads only `.github/workflows` at the repository root — so those
pins stay a person's job, which is the same staleness in the one place nothing watches. And the
file is half a switch: version updates are also enabled from the repository's settings, which is
not something the tree can carry.

**D82. A reload is offered only after a `start`, and only for bytes that moved (2026-09-22).** The
companion patches on disk; whether that leaves the window in front of the user stale is a different
question, and answering it wrong in the generous direction costs a weekly notification offering to
end somebody's in-flight turn for nothing.

The discriminator is already in `WatchReason`. A `start` means this extension host has just come up
over whatever directory was there, so the directory being patched is the one this window loaded and
the patch lands behind it. A `moved` means the directory changed *while* this host was running,
which is possible only because the host is running the other one — the old directory, still patched,
still fine. So `moved` is never an offer, and the ordinary weekly update is silent by construction
rather than by a threshold somebody tuned.

**What moved is read from the bytes, not from the engine.** `VersionReport` carries `action` and
`hostChanged` exactly, and getting them across would mean a new flag on `install` that an engine one
release behind does not have — on a shell that acquires whatever `@rigline/core@latest` resolves to
(D80). Statting `webview/index.js` and `extension.js` either side of the run costs nothing, works
against every engine there has been, and reuses the sampling D81 already does.

Two gates on top. The offer needs `isActive`, sampled after the install rather than before, so
somebody who opened the panel mid-run gets a dismissible prompt instead of no prompt (P8). That gate
is weaker than it sounds: Claude Code declares `onStartupFinished`, so it is active in every window
from startup and `isActive` cannot mean "a webview exists" — it catches the extension being absent
or switched off, and nothing finer is available, because VS Code exposes no way to ask about another
extension's webviews. The residue is a dismissible prompt in a window with no turn to lose. And a
changed `extension.js` asks for a window reload instead, because a webview reload cannot pick one
up — one offer, chosen by what moved, rather than two buttons the user has to choose between.

**Asked once, then it lives in the status bar.** Dismissing leaves the item reading "reload to
apply"; clicking it opens the same notification rather than reloading, so the cost is stated in one
place and the reload has one path. That is D55 and D56 applied to the reload itself — somebody
mid-turn when the offer arrives should not need to learn a command to get back to it.

A payload that moved under a working loader is deliberately not an offer. The decorations are there
and they work; the next reload picks up the newer ones. Spending the prompt on that is how it stops
being read.

**D83. `install` stays synchronous, and its stability sample blocks with `Atomics.wait`
(2026-09-22).** D81's structural refusal cannot see the case that matters most — every file present
and one still growing — and stability can: stat, wait, stat, refuse when anything moved. A direct
measurement, so unlike a content rule it cannot refuse a legitimate bundle whatever a future bundler
emits.

Waiting needs either an `install` that can await — rippling through `update`, `check`, `reinject`,
the CLI's switch, `watch.ts`, `dev` and the harness — or a synchronous block. The objection to
blocking a thread is about a process with something else to do; the engine is spawned per command,
does one job and exits, and the companion only ever sees it as a child taking a quarter of a second
longer. There is no event loop here to starve, so the conversion buys nothing and costs a wide
mechanical change across the one path this project has learned not to trust when it goes green.

**One sample gap, then refuse.** Every other answer `wholenessProblem` gives is a refusal, so a
settle loop here would be the single branch that blocks for twenty seconds and then succeeds. The
retry belongs to the caller — a person's next command, or the watcher's next poll — and both already
exist.

A quarter of a second, against the companion's two, because the questions differ: the companion is
sampling a directory it has been told changed, where the write may not have started; this is
sampling one it is about to write into, where the only question is whether a write is in flight now.
It is paid by every install, so `install` takes `wholeness` and the flow passes it down — the seam
that keeps the test suite from paying it forty times over.

**D87. The panel serves one React to plugins, and `install` points a plugin's imports at it
(2026-09-23).** `react`, `react/jsx-runtime`, `react-dom` and `@rigline/plugin-api/ui` are built
beside the two hooks and served from `webview/rigline/runtime/` (`RUNTIME_MODULES`), because
Rigline's own shell will render plugin
components in its tree, and a component whose hooks come from one React cannot be rendered by
another. A plugin's build leaves those imports bare, and `install` rewrites them in the entry as it
copies the plugin, to paths relative to that entry. Rewriting at install rather than resolving at
build keeps the payload's layout out of every plugin's output, so the layout can move without anybody
rebuilding, and keeps P6's contract one ES module that any bundler with an `external` list can
produce. A bare import outside the set is named in the plugin's verdict and fails at load, attributed.

The rewrite parses with es-module-lexer rather than a pattern, because a specifier-shaped string in a
comment or a string literal is exactly what a pattern would also rewrite. It is `@rigline/core`'s
first third-party runtime dependency, which D47's amendment allows, and it is pinned to an exact
version: a transitive dependency resolves on the user's machine at install time, outside the
release-age gate (D48), so a range would ship whatever was newest that day rather than what was
tested. Tier 4 packs it from the workspace's installed copy, which keeps that run offline.

React's major is part of the plugin contract: moving it is an `api` bump.

The React half of the plugin API is a subpath, `@rigline/plugin-api/ui`, not a package of its own:
every published package costs each release its own approvals, and the subpath is the pattern `ctx`
already follows — types from `plugin-api` at build time, the implementation from the panel at run
time. The root stays React-free, so core still runs it in Node, and React is an optional peer
dependency the engine's install never fetches.

**D88. Rigline owns one React root, the shell, and renders every plugin component inside it
(2026-09-23).** A plugin contributes components and never creates a root. What decides it is where
this is going: a shared menu whose entries come from several plugins, and a layout editor that wraps
plugin components in its own selection and drag state. Both need context to reach from Rigline's
tree into plugin components — choosing an entry closes the menu, focus moves across entries from
different plugins — and context never crosses roots, while a portal carries it. So the shell renders
plugin components, portalling them wherever they belong.

What that costs is isolation by construction, and an error boundary per contribution buys it back:
a render or effect error reaches the kernel through the owning plugin's error path and disables that
plugin by name, as every other failure does. Event-handler errors escape boundaries, as a DOM
listener's always have.

Rejected: a root per plugin, which isolates structurally but leaves every menu behaviour to be
rebuilt over events; a React per plugin behind a custom element, which answers independently shipped
fragments on different framework versions, where we version the contract instead (D87); and the
app's own React, which is unreachable without patching the webview bundle's body, moves when
Anthropic moves it, and puts a plugin's throw inside the app's tree (D2).

State that has to outlive a component — shared between contributions, which have no common React
parent, or caught from boot, which an effect subscribes too late for — goes in a store made in
`setup`. Everything else is ordinary React state.

**D89. The RIG menu is ordered by plugin, drawn on the app's design tokens, and drills down
(2026-09-23).** Contributions are grouped by plugin in registry order, with a divider between
plugins, and a plugin's own come in the order it called `ctx.menu`. Registry order is the answer the
codebase already gives to "in what order" (D23, D66). If users are to reorder the menu, that is a
list of plugin names, which exist already, so the API carries no ids for it. Rejected: the menu as a
zone of elements, which is the element model — an author who wants a movable entry declares an
element; and weights declared by plugins, which asks plugins that know nothing of each other to rank
themselves against each other.

`@rigline/plugin-api/ui` writes its own CSS against the app's `--app-*` custom properties, each
falling back to the `--vscode-*` variable the app aliases it to. The app's menu classes are a thin
layer over those tokens, which are defined on `html`, never minified or module-hashed, and present
in every reference bundle. Borrowing the classes was rejected: the app has four `menuItem` classes
in four modules, none has a keyboard-focus or checked state, so our CSS would sit on top of them in
a specificity fight, and the served module has no manifest to declare anchors in. A token that
disappears degrades to the theme variable it aliased, which is what theme variables alone would
have given everywhere.

A submenu replaces the menu's contents under a back row rather than flying out beside it. The panel
is often a narrow sidebar with no room beside the menu, the diagnostics are wider than a flyout
could be, and drill-down needs none of a flyout's hover-intent machinery.

`MenuItem` guards the `onSelect` it is handed, so a throw there disables the plugin as a render
throw does, where a handler on a plugin's own element still escapes (D88).

**D90. Elements are declared beside `uses` and placed by their author; `rigRow` is the composer
box's last row, behind a submit guard (2026-09-24).** An element is a component a plugin contributes
and its author places until the user says otherwise. `elements` is top-level, beside `patches`,
because it declares contributions rather than dependencies. Each element gives a title, the
placements it may take, and a default that is one of them or `null` — so off is a choice, not an
omission. A placement's anchor is a dependency the element can go without: one this extension or
engine cannot provide is reported with the optional gaps and refuses nothing (D41), so it is not
repeated under `uses`.

An anchor slot is a node the host builds once per element and re-places at its anchor, so a portal's
target never changes and the component keeps its state when the app replaces the anchor. A zone is a
row the host places only while an element is in it.

`rigRow` is kept last in the composer box (`composerBox`), under the controls and the model pill's
own row, with the footer's border above it. It was chosen by eye in a real panel over a row below
the box, which needs none of what follows. The harness read behind it:

- The fit ladder watches only the footer, so a sibling row does not move it.
- The session view observes the composer's height and re-pins the transcript, so a zone whose height
  keeps changing re-renders the panel.
- The box's background is absolutely positioned over the whole box, so the row takes
  `position: relative`.
- React appends the model pill's row after whatever is last, so the zone is moved back once each
  time stage 2 is entered.

The box is a fieldset in the composer's form, and so is the footer. A button with no type submits
the prompt, and Enter in a text field sends it; `document.createElement("button")` and React's
`<button>` both default to submit. Worse, the first such button in the footer becomes the form's
default button, so Enter in any field of the form clicks it — another element's field included,
which the harness showed. So every element renders inside a form of its own, whose controls never
belong to the composer's, and the host cancels every submission of those forms. A plain DOM mount has
no such form, so the host also cancels a submission of the app's form whose submitter, or whose
focused field, is inside a node it placed. Both in capture on `document`, before either React root
sees it; a plugin's own form submits as usual. Rejected: telling authors to type their buttons, which
needs every author to comply, where this needs nobody to.

**D91. A person's settings are YAML, and what `add` recorded is not among them (2026-09-24,
Leo).** `~/.rigline/config.yaml` holds what a person decides: plugins switched off, and the layout
and per-plugin settings as they arrive. `~/.rigline/sources.json` holds where each plugin came from
(D49). Both were one `config.json`. The layout is the first setting people will want to write by
hand, and YAML is the easiest format to hand-edit: no quotes, no commas, and comments. A source record
— pinned version, integrity, when — is a lockfile entry that nobody edits and that `update` rewrites,
so it stays JSON in a file of its own. That is the split package.json and its lockfile make, for the
same reason. Both files remain the engine's alone (D74).

Commands edit `config.yaml` in place through `yaml`'s document API and never render it afresh, so a
person's comments, blank lines and key order survive `disable`, `enable` and `rigline layout`. The
one normalisation is spacing inside a flow collection, which `yaml` sets once for all of them: `[a,
b]`. A command that changes nothing writes nothing. `yaml` reads YAML 1.2, where `off` and `no` are
words, not booleans. It is the engine's second runtime dependency, pinned exactly as es-module-lexer
is (D87). Rejected: JSONC, which keeps comments but also keeps the braces, quotes and commas that make
hand edits fiddly.

A command that reads the settings first splits a `config.json` it finds alone: `sources` into
`sources.json`, everything else into `config.yaml`, then removes it. A `config.json` beside the new
files was written by an older engine; it is not read, and the command names it. `anchors.json` stays
JSON: it is a repair pasted from a release note, not a file anyone maintains.

**D92. The layout is a list per place, recording departures from the authors' defaults (2026-09-24,
Leo).** `config.yaml`'s `layout` maps a place to the elements a person has put there, in order, each
written as `plugin/element`. A place is a zone (`rigRow`), a slot spelled as every report prints it
(`before footerSpacer`), or `off`. An element in no list is where its author put it. A plugin
installed later therefore arrives at its defaults, and an author who moves a default takes along
everyone who has not moved that element. A place shows its listed elements first, then any others
that default there, in registry and manifest order. Order holds in a slot as in a zone: a listed
element's mount rank is its index less 2^20, ahead of every registry rank.

The layout is keyed by place because that is how a person reads the panel and how an editor will
show it, and because a list says it has an order. Rejected:

- One line per element, `plugin/element: place`. It is the most compact form, but its order would
  ride on key order, which a reader is taught a map lacks and which sorting the file silently changes.
- `place` beside `order`, which names an element twice when it is both moved and reordered.
- Nesting by plugin, which cannot interleave two plugins in one zone.
- A complete arrangement per zone, under which every plugin installed later appears nowhere until
  placed.

An element has one place, which settles whether it could have several. Two places would be two
copies of a component whose state diverges, and an author who wants that declares two elements. The
first list naming an element decides, and a later one is reported. An entry that does not resolve
is reported by `install` and `check`, leaves the element at its default, and stays in the file: a
place that is not one, a plugin not installed, an element not declared, or a place its element does
not offer. Its plugin may come back, and deleting a person's choice over an absence is not the
engine's call. A disabled plugin's entries are neither reported nor removed.

`install` bakes the layout into `registry.js` as written, unresolved entries included, and the
kernel resolves each element against it with `placeElement`, the function `install` reports from.
The baked layout is where a panel starts, not what it is fixed to. A layout editor will hold a
working copy, and saving writes that copy over the file's layout, warning when it overwrites a
change made since the panel loaded; merging edits from several sources is deferred. That is why the
bake keeps unresolved entries: a copy holding only what resolved would delete the rest on save.

`rigline layout place ELEMENT default` undoes a move, so undoing is the same command as moving, with
`default` as the place; `reset` empties the whole layout. `default` is a word for the command only:
in the file an element is at its default by being in no list. A command that empties a place takes
the place out, and `layout` with it when it was the last.
