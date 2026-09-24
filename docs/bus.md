# The bus: what crosses it, who may read it, and who may change it

Every exchange between the panel and the extension host goes through one `postMessage`, and Rigline
wraps it. This is what the traffic actually looks like, what a tap is handed, and the rules an
outbound write obeys. The reasoning is D3, D8 to D10, D20, D21 and D51 in
[decisions.md](decisions.md); the code is `packages/host/src/pre.ts` and
`packages/host/src/kernel/`. [host.md](host.md) has the pre hook's job in summary;
[identifiers.md](identifiers.md) has how the message types and payload fields are harvested.

## What crosses it

Three shapes, and only three.

```js
{type:"request", channelId, requestId, request:{type:"rename_tab", …}}   // correlated
{type:"response", requestId, response:{type:"rename_tab_response", …}}   // its answer
{type:"update_session_state", sessionId, …}                              // bare notification
```

The app wraps a correlated request itself, in `sendRequest`; `send` posts a notification bare.
Inbound, one listener enqueues everything onto `this.fromHost` and a `for await` loop dispatches on
it; inbound *requests* from the host go through a second dispatch method. Those four sites are the
whole protocol, and they are where it is harvested from.

`request` and `response` are envelopes, not message types. A plugin may tap either, and sees every
request or every reply crossing the bus; what it may never touch is `channelId` or `requestId`,
which are correlation state — the fields layer has no entry for an envelope, so neither has any
manifest.

**`io_message` is a protocol nested inside ours**, and is deliberately never unwrapped. It carries
one Claude Code CLI record — `{type:"assistant", sessionId, message}` — which in turn carries the
Anthropic message format. Those names belong to the CLI and to Anthropic, not to the VS Code
extension: there is nothing to harvest them from and no version to pin them to, so they are not
published as message types. What the host does instead is make the shape its own problem, in
`plugin-api/src/stream.ts`, so a plugin writes `ctx.onToolUse(…)` rather than learning three layers
of envelope.

## One egress

The app calls `acquireVsCodeApi` exactly once, during boot, and every outbound message goes through
the object it returns. The pre hook wraps that function before the bundle body runs, caches the
single real call, and returns its own object — so there is exactly one place an outbound message can
be seen or changed, and it is ours. Once the app has made that call, the kernel replaces the global,
before any plugin loads, with one that throws as VS Code's own does on a second call, so a plugin
reaches the bus through `ctx`. That is not a wall: a plugin shares the app's page and can reach the
app's own code (D79).

Inbound, a `message` listener registered at static-import time precedes the app's own.

If `acquireVsCodeApi` is not there to wrap, `diagnostics.acquireWrapped` is false and nothing here
can post. That is a real state the probe reports rather than an assumption.

## Reading: a tap gets a frozen clone

`ctx.onMessage(type, handler)` is keyed on **type**, which means two things at once, on purpose.
Every message is recorded under its outer type, and a `request` or `response` envelope is *also*
recorded under its inner type, with the inner payload as the value. So `onMessage("request", …)`
sees every request crossing the bus, `onMessage("rename_tab", …)` sees just those and is handed the
request payload, and `onMessage("list_sessions_response", …)` sees just those replies. Unwrapping a
reply loses the `requestId` that says which request it answered; the envelope is still recorded
under `"response"` for anything that needs to join the pair itself.

**A handler is handed a frozen deep clone, never the object on its way past, and that is enforced
rather than documented.** Handing over the live object would make every read tap an undeclared write
capability: a handler could rewrite an outbound payload, rewrite the `requestId` an envelope
correlates on, rewrite an inbound message before the app's own listener saw it — this listener is
registered first — or mutate a replayed message already delivered to somebody else.

The freeze is deep for the same reason. A shallow `Object.freeze` leaves `envelope.request.title`
writable, which is the entire capability being closed. The `isFrozen` check inside the walk is the
cycle guard, not an optimisation: `structuredClone` preserves cycles.

One clone serves every tap on one message, so no tap can see another's view. A clone that fails is
fail-closed: the taps are skipped and the failure is recorded, because the only alternative is
passing the original.

Clones are what the guarantee costs, and the cost scales with payload size rather than message count
— a streaming delta clones in a microsecond or two, a `list_sessions_response` runs hundreds of
times that in proportion to how many sessions are on disk. `tapCloneMaxMs` and `tapCloneMaxType` are
tracked by name for that reason: the distribution is skewed enough that a total alone cannot be
acted on.

## The replay buffer, and why it is sealed

Plugins load from a *dynamic* import at the tail of the bundle, so the startup exchange — `init`,
`get_claude_state`, the session list, the first `get_session_response` — is already over before any
plugin can register. The pre hook buffers from boot and replays to a tap that registers late, so a
plugin sees the boot traffic it would otherwise have missed (D3).

Replay clones per late tap rather than at record time: gating the cost on a listener existing is
only sound if nothing safe has to be kept for a listener that does not exist yet, so the buffer
holds the app's own objects and the freeze happens on the way out.

The post hook seals the buffer once every plugin has had its chance, in a `finally`. That is not
tidiness. A panel is created with `retainContextWhenHidden`, so an unsealed buffer would retain
every message the window had ever seen — every streaming delta of every turn — for as long as it
stayed open.

Seal state is `diagnostics.bufferSealed`, and it is the signal a harness test waits on to know that
plugin loading is done, refusals included.

## Writing: the rewrite chain

The rules, together, are D20 and P4:

- **Outbound only.** The chain cannot originate a message or touch an inbound one. A plugin adds to
  what the app said; it does not speak for the app.
- **Patch-shaped.** A rewriter returns an object of fields to replace, or nothing. It never returns
  a message.
- **Declared.** Only fields named under `uses.rewrites` for that type, and only fields the harvest
  proved the app sends at every site.
- **Synchronous.** The chain runs inside `postMessage`, which cannot wait.
- **The app's message reaches the extension host whatever a plugin does.**

Per type, in registration order — which is registry order — each rewriter is handed a frozen view
with earlier patches already applied, and returns a patch or null. The result is a copy; the app
built that object and may still hold it, and a host that edited it in place would be doing to the
app exactly what the read-only guarantee stops plugins doing. With no rewriter registered for a type
— the overwhelmingly common case — the original object goes out untouched, so nothing pays for a
capability nothing used.

A request is patched *inside* its envelope, which is how `channelId` and `requestId` stay beyond
reach: what a rewriter is handed, and what it can replace, is only ever the inner payload.

The split between the two files is worth knowing before changing either. `pre.ts` owns the order
patches apply in and the guarantee that the message goes out either way — and stays free of the
manifest, so it names no harvested identifier and is version-independent. The `rewrites` capability
module owns entirely *whether a given patch is allowed*: the declaration, the validation and the
attribution. What reaches the pre hook is a function that returns a validated patch or null and
never throws.

### What `patchViolation` refuses, and what each rule closes

| rule | the silent failure it closes |
| --- | --- |
| the field must be declared | the manifest is the contract; an undeclared write is unauditable |
| the field must already be present | a rewrite replaces, never adds — a field renamed upstream becomes a named failure rather than a dead property nothing reads |
| the value keeps the `typeof` of what it replaced | the extension host applies `rename_tab` only when the title is a string, and otherwise drops it without a word |
| a thenable is rejected, not awaited | a returned promise means the plugin believes something untrue about when its work happens |

A violation, or a throw inside the transform, disables that plugin and posts the message unmodified.

`diagnostics.rewrites` carries one record per registration: plugin, type, fields, `ran`, `applied`,
`missed`. Those three answer the whole of "did my rewrite land" — `ran` is every time the chain
reached it, `applied` every time its patch stuck, `missed` the sends that went out before it
registered at all.

Where two plugins declare the same field of the same type, the install reports it by name and in the
order the patches compose. It is never refused: composition is well defined, and which of two
plugins should win is not Rigline's call.

## `resend`, and the boot race

A rewrite of an early message type always misses the first sends. `rename_tab` fires from a reactive
effect at session creation, long before a dynamically imported plugin could have registered. So for
such a type `ctx.resend(type)` is the normal pattern rather than a fallback: register the rewrite,
and once the app has sent the type, ask for it again.

What is stored is the app's **last original** message of each type, never the patched result, so a
resend re-runs the chain from what the app said rather than compounding patches. The envelope is
rebuilt with a **fresh** `requestId`: the app's outstanding-request map resolved and deleted the
original long ago, and reusing it would be claiming to be a reply to something. The app answers an
unknown id with a console warning that no handler matched, and drops it. Nothing else happens.

A resend while the chain is running is refused — a rewriter resending its own type would re-enter
the chain and never come back, and the failure is a hung webview rather than a disabled plugin, so
the guard is in the host rather than trusted to authors.

A resend is deliberately **not** tapped. A reader reports what the app said, and this is the plugin
layer speaking; `diagnostics.resent` is where it shows up instead.

`outboundSeen(type)` is read once when a rewriter registers, and that instant's count is `missed`.
It is counted at the egress rather than derived from the replay buffer, which is the obvious source
and the wrong one: the buffer stops recording at the seal, records both directions under one key for
an envelope type, and would freeze the number for exactly the plugin whose window is widest — one
registering from a promise or a timer, after `setup` returned.

## Services derived from the bus

Two capabilities are not taps a plugin could write itself, because the derivation behind them is
read off minified code and inverts silently (P5). The host owns them, one tap serves every plugin,
and the tap is subscribed on first use rather than at boot — the pre hook clones a message only when
a tap exists, so an unconditional tap would charge every panel for a stream no plugin read.

**Session** (`ctx.onSessionId`). `update_session_state` is the one report of which session a panel
is hosting, and on a switch it first re-sends the *departing* id with `isFarewell: true`. That
farewell is what makes a switch observable rather than merely eventually-consistent. The rule has
one branch and it is easy to invert: a farewell for the id we are showing clears it; a farewell for
any other id is a report about a panel state we never saw and changes nothing. With only one session
open the two readings agree, which is why the wrong one looks like the feature working. `null` does
not distinguish "none assigned yet" from "the one we had has departed", because nothing downstream
needs them told apart.

Three alternatives lose, and are worth not re-proposing: `get_session_request` says a session was
fetched, never that one was left; `session_states_update` carries the workspace-wide active session,
not this panel's; and the panel's own `?session=` URL parameter is not an identifier layer a
manifest could declare against, so nothing could refuse a plugin when the extension moved it.

**Tools** (`ctx.onToolUse`, `ctx.onToolResult`). A `tool_result` block names no tool — it carries a
`tool_use_id`, the output and `is_error`, and nothing else. Joining it back to the call is the
difference between "something finished" and "`EnterWorktree` succeeded", and getting it wrong is
silent, with a plugin acting confidently on the wrong answer. So the host keeps a bounded,
insertion-ordered map of calls awaiting a result and does the join (D51). A result whose call is not
remembered — made before this panel connected, or aged out — is **dropped**, not delivered with a
guessed name: the tool's own name is exactly what is missing.

The map is bounded for the reason the buffer is sealed. A result follows its call within seconds and
the extension keeps the real history; an unbounded map would be D3's mistake made a second time, and
on a long-running panel the larger of the two.

Tool *names* are deliberately untyped and unchecked. They belong to the CLI and to whoever wrote the
tool, so a misspelled name matches nothing, silently. That is the accepted trade for the capability
existing at all, and it is why everything above the name — the envelope, the block shape, the id and
the input — is pinned where it can be tested.

## Rates

`outbound`, `inbound`, `tapClone` and `resend` each carry a per-second peak and when it happened, as
every hot path does (D53). A cumulative counter cannot be read: an hour of ordinary work and four
bad seconds are written identically. When a panel misbehaves, the peaks are the numbers that
separate them.
