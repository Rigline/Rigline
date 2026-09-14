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

**P2. Declared dependencies are enforced, not trusted.** The manifest is data, read without
executing the plugin, checked against what the installed extension contains, and a plugin whose
declaration does not hold is refused by name with the specific missing identifier. A capability
that hands over derived state still declares what the host taps for it, so a retirement upstream
refuses the plugin instead of leaving a handler that never fires.

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

**D7. A curated anchor table maps stable names to module-scoped classes and is the primary way a
plugin targets UI.** `modelPill` rather than `("gGYT1w", "modelPill")`. The update flow validates
the table once per extension version; a retired anchor refuses only the plugins that use it. Raw
`cls(module, local)` stays as the escape hatch so curation never blocks an author. Confirmed by
Leo 2026-09-13. It is also the only thing that can repair a plugin whose author has not touched it,
which is what makes curation load-bearing rather than cosmetic (D44).

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
A capability module carries its declaration schema, its layer expansion, its permission summary,
its runtime grant, its diagnostics and its probe check. The kernel knows none of them by name.
Plugins never import the host; a module singleton would defeat both the scoping and the
attribution.

**D19. Initial capabilities:** `classes` (`cls`), `anchors` (`anchor`), `messages` (`onMessage`),
`mount` (`mount`, `mountAfter`, `watch`), `style`, `rewrites` (`rewrite`, `resend`), `tools`
(`onToolUse`), `session` (`onSessionId`), `transcript` (`decorateTranscript`), and `surface`.
`watch` is host-managed re-anchoring on the shared mutation observer, so no plugin polls for an
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

**D22. A DOM capability hands out data, never an element, where the host discovered the element.**
Transcript rows are keyed by index upstream and React reuses elements when the list is spliced, so
identity is the host's problem, and keeping it there lets the mechanism change without any plugin
noticing.

**D23. Mounts sharing an anchor are ordered by the host in registry order, and every host-placed
node is stamped `data-rigline-mount`.** The naive insert gives the slot to whichever plugin mounted
last, which is invisible to authors and was observed to displace a decoration.

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

**D26. A host patch declared by a plugin from outside this repo requires explicit per-patch opt-in
at install.** The mechanism can verify an anchor but cannot scope what the substitution does; the
review that stood in for scoping stops existing when the author is not us.

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
(D44), harvest baseline, class-map snapshots. A clone of this repo is for developing Rigline, not
for using it.

**D33. Plugins are distributed as npm packages carrying `rigline.json` and a built entry, or as a
local directory for development.** Amended 2026-09-14: a git-repo source was weighed against npm and
deferred, rather than never considered. The case for git was cadence, borrowed from D44's
observation that the extension updates weekly and npm does not — but that belongs to the
anchor table, which is the repair path needing no author at all. Plugin republishing is the other
tier, slower and reviewed on purpose, and collapsing the two argued for degrading the slow tier to
buy a speed the fast tier already supplies. What git costs is concrete: a repo holds source, so
installing from one means either running an author's build on a user's machine or requiring a
committed `dist/`, and an artifact committed to git has no verifiable link to the commit that
produced it, which is precisely the link a provenance attestation gives (D46). Nothing here
forecloses git later; a source is recorded by kind from the first entry (D49) so a second kind is an
adapter, not a migration.

**D46. Publishing is trusted publishing plus staged publishing, and the plugin template ships the
workflow that does both.** They are two independent mechanisms and are worth holding apart, because
each closes a hole the other leaves open. Trusted publishing is how CI *authenticates*: GitHub
Actions presents a short-lived OIDC token, npm accepts it from the workflow the package owner has
named, and no npm credential exists in the repository to be stolen. Staged publishing is whether a
publish *goes live*: `npm stage publish` needs no 2FA and produces a version nobody can install, the
owner reviews the queue with `npm stage list` and `npm stage view <id>`, and `npm stage approve
<id>` makes it installable and does require 2FA. Either works without the other — you can stage with
an ordinary token, and you can trusted-publish straight to live. Both are taken because each covers
the other's blind spot. Trusted publishing removes the standing secret, the credential-theft path
that dominates real npm compromises, and is the only source of a provenance attestation.
Staging covers everything an OIDC token does nothing about — a poisoned build dependency, an edited
workflow, a compromised account with push rights — all of which reach the publish step by a route
that looks legitimate. Taken alone the trusted half is the weaker one: it hands the workflow ambient
publish rights with no human anywhere in the path.

The primitive that makes the gate real is stage-only, and it is available on both kinds of
credential: `Read and write (stage only)` on a granular token, and stage-only permissions on a
trusted publisher, each refusing `npm publish` while accepting `npm stage publish`. There is no
org-wide or package-wide switch that requires staging, so the credential inventory is the actual
control surface: the gate holds exactly as long as *every* credential able to publish that package
is stage-limited. One forgotten full-rights token silently voids it. The bootstrap token below is
therefore revoked the moment the trusted publisher is configured, never left in a drawer.

Rigline's own packages publish the same way — we ask no more of a plugin author than of ourselves,
and the template is lifted from a workflow we run. Two steps cannot be automated and are Leo's: the
npm organisation, and a bootstrap publish of each package under a temporary token. Staging is the
documented blocker — npm states you cannot stage a brand-new package — and practitioners report the
same of configuring a trusted publisher, which npm's own page does not state either way. Either
constraint alone forces the same first step, so version one of each package goes up by hand and
every version after it goes through the workflow.

Provenance belongs to the trusted-publishing half, not the staged half: a trusted publish generates
an attestation binding the tarball to the commit and workflow that built it, and it requires the
source repository to be public. Whether that attestation survives a staged approval is documented
nowhere — `npm stage publish` accepts `--provenance`, which suggests it is produced at stage time
and carried, but a flag is not evidence. Confirm it on our own first release, and do not let the
authoring guide claim provenance until someone has seen it on a published package (P8).

Floors: npm CLI 11.15.0 and Node 22.14, both below our own (D34). pnpm wraps the same registry
workflow as `pnpm stage publish` (since 11.3), and `-r` stages every publishable package in the
workspace, so our three go up as one CI step and are approved individually; a single-package plugin
repo needs no flag at all.

**D47. `rigline add` never runs a package manager.** A plugin's distributed form is one browser ES
module plus a manifest (P6), and the webview cannot resolve a bare specifier, so a plugin is already
bundled by the time it is published and has no runtime dependency to install. `add` fetches the
tarball, checks it against the registry's integrity hash, extracts it and validates the manifest as
data (D12). There is no `node_modules`, no dependency resolution and no lifecycle script — a
stronger position than passing `--ignore-scripts`, because the surface is declined rather than
defended. A plugin that cannot be installed this way is a plugin we do not install.

**D48. A published version must reach a minimum age before `add` or `update` will take it: 1440
minutes by default, `--now` to override.** The number matches pnpm's `minimumReleaseAge` default and
rests on the same evidence — a compromised publish is generally caught within a day, and a day of
latency costs a plugin user nothing they can perceive. The delay is affordable here for a specific
reason: the urgent repair does not route through it. When an extension update retires a curated
anchor, the fix is a two-line pair in `~/.rigline/anchors.json` (D44), which reaches a user the hour
it is written with no publish at all. What the delay does hold back is a fix to a plugin's own logic
or its raw `cls()` use, so a withheld version is reported rather than hidden (P8): `update` names the
version, its age, and the flag that takes it early.

**D49. A source is recorded by kind, pinned identity and declaration fingerprint, and `update`
re-gates when the fingerprint moves.** `~/.rigline/config.json` holds `{kind: "npm", name, version,
integrity, declarations}` per installed plugin. The kind discriminator is present from the first
entry so the git source deferred in D33 arrives as an adapter. The fingerprint covers declared
capabilities and declared host patches — exactly what the install gates on — so an update that
widens a plugin's reach re-runs the permission summary and D26's per-patch opt-in instead of
inheriting consent given to a narrower version. An update that only changes code does not re-prompt,
which keeps the gate honest about what it governs: declared reach, not trust in a particular build.

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
bun or a shell script is discovered, gated and loaded identically. What is published is the output
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
webview, one check per capability, `n/a` where a check cannot apply on a surface; and, if the
phase 2 spike succeeds, a Playwright tier that boots the real bundle from the corpus with a faked
`acquireVsCodeApi` and a replayed bus. The spike was confirmed by Leo 2026-09-13.

**D37. Byte-faithful I/O for every bundle read and write, and LF enforced in the repo.** Text-mode
I/O on Windows rewrites every line ending and turns a 133-byte patch into a 2.2 KB one.

**D38. The backup file, not the marker comment, is the authority on whether a bundle is patched.**
Keying on the marker breaks the moment the marker string changes: the installer stops recognising
its own work and stacks a second loader on the first.

**D39. Never point a test at the live extension directory.** A failing assertion mid-test leaves a
real install half-patched, and the panel renders blank when the static import is broken.
