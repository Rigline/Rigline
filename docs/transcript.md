# The transcript: a three-way join, swept once a frame

`ctx.decorateTranscript(build)` hands a plugin the list of transcript entries — what each row is and
when it actually happened — and mounts whatever it returns inside the matching row. Underneath, that
answer is assembled from three facts, and none of them is where you would first look. The reasoning
is D11, D22, D24 and D52 in [decisions.md](decisions.md); the code is
`packages/plugin-api/src/transcript.ts` for the derivations and
`packages/host/src/kernel/transcript.ts` for the plumbing.

## The three facts

**A row does not know its own time.** Every rendered row carries a `timestamp`, and it is
`Date.now()` from the moment the row *object* was built. The converter that turns a CLI record into
a row passes `uuid`, `betaMessageId`, `parentToolUseId` and `origin` through, and not the record's
own `timestamp`, so the class default wins every time. Reopening a session rebuilds the whole
transcript through that converter and stamps every row with the moment it was loaded — which is why
the app's own prompt-history popup reads "just now" for every entry of a session you have just
reopened. Nothing here reads that field, not even as a fallback (D24).

**The real times are on the bus, in two carriers.** `get_session_response` is the extension host
handing over the transcript it read from disk, as `envelope.messages[]`; `io_message` is one CLI
record relayed verbatim, as `envelope.message`. User and assistant records in both carry a `uuid`
and an ISO `timestamp`. Those are the only sources, and a caller wanting one always wants the other:
a list built from either alone is half-timed.

**The DOM carries no identity.** A row's uuid reaches the DOM through no attribute and no id. It is
read from React instead, through `findFiberByHostInstance` — react-dom's own lookup, handed over
when the renderer injected into the devtools hook the pre hook installed, rather than a scan for the
`__reactFiber$…` property whose suffix is randomised per load.

## What an entry is

```ts
interface TranscriptEntry {
  readonly id: string;                        // the message uuid
  readonly role: "user" | "assistant";
  readonly at: number | null;                 // epoch ms, or null when no record has said
  readonly index: number;                     // position in the list this entry came with
}
```

`at === null` is a real and meaningful state, not a missing value to paper over. It says *no record
has said when this entry happened* — which is exactly true of a prompt you have just sent, minted in
the webview a beat before the CLI's record arrives. There is deliberately no "first seen" fallback,
because a fallback would make the null unreachable and the honest case indistinguishable from the
guessed one (P5).

`rowIdentity` deliberately skips `meta`, `compact` and `refusal_fallback` rows. They are minted in
the webview with a fresh uuid and exist in no transcript on disk, so no record will ever carry a
time for one. Skipping them keeps `at` null-because-not-yet rather than null-because-never, and
keeps the role union ours rather than a passthrough of the app's row vocabulary.

## Identifying a row

`rowIdentity(fiber)` is a **shape match, never a name match**: it looks for props carrying a
`message` with a non-empty string `uuid` and a role we show. The component is minified and its
identifier changes every build, so matching on a name would be depending on exactly the thing P1
forbids.

It walks at most four fibers up from the host element. The row div is returned directly by the
component whose props carry the message, so one or two steps is the real distance and the rest is
slack for a wrapper. The bound matters in the failing direction: walking further would eventually
reach an *ancestor row's* props and identify a row as its own parent, silently. A bounded walk turns
that into "not a row", which is the safe answer.

## The sweep

One pass, scheduled as a microtask, however many reasons arrive first. Two things schedule it: a
React commit (already coalesced to one per frame by the pre hook) and a bus message that changed a
known time.

Each sweep queries the `transcriptRow` anchor's **resolved selector** — not its bare class — so the
candidates are rows rather than everything wearing the row's look (D7). The fiber check below would
have dropped a stray anyway, since a class proposes and the fiber disposes, but paying for a wrong
candidate on every sweep, several hundred rows deep, is a cost with nothing on the other side of it.

For each candidate: read its fiber, take its identity, look up its time, and push an entry. Then
`entriesDiffer` compares the new list against the last one, and **only a real difference rebuilds
the decorations**. That comparison is what makes the whole thing affordable: React commits fire per
streamed token, so the list is rebuilt far more often than it changes.

Order is part of the comparison, because rows are keyed by index upstream: the same ids in a
different order is a different transcript, and comparing sets would leave every decoration one row
out of place.

`diagnostics.transcript` carries the four numbers that describe this. `entries` against `timed` is
the health of the join — a row whose time no record has supplied yet is normal for a moment and
wrong if it persists, and the two tell those apart without anyone reasoning about which message
should have carried it. `rebuilds` against `sweeps` is the same ratio one level down from
`commits`/`notified`.

## Decorating

A decorator is rebuilt rather than diffed when the list changes: torn down node by node, then built
again against the current entries. The list changes once per message, not once per commit, so the
simple thing is also the cheap thing.

`build(entry, entries)` returns an `Element` or `null`. It is handed **data, never an element**
(D22). Rows are keyed by index upstream and React reuses one element for a different message when
the list is spliced, so identity is re-read from scratch on every sweep and there is nothing a
plugin could safely hold onto. Keeping that inside the host is also what lets the mechanism change
without any plugin noticing.

Each returned node is mounted `inside` its row through the ordinary mount service, with the plugin's
registry order, so several plugins decorating the same row stay in a stable order and each node is
stamped `data-rigline-mount`. A `build` that throws, or that returns something other than an element
or null, disables the plugin through its own error path.

A decorator arriving resets the remembered list, so the sweep redraws: a new decorator changes what
belongs on screen even when the entries have not moved.

Times are kept in a bounded map — 20,000 entries, oldest out. A panel switches sessions for the life
of the window, so this is the one structure that grows with *use* rather than with the transcript on
screen.

## Refusing early rather than resolving nothing

`decorateTranscript` throws at the moment it is called when no React renderer ever injected into the
hook. Every other way this capability can go wrong is a refusal at load — a declaration checked
against the tables, an anchor that did not resolve — and this would otherwise be the silent hole
among them: a decorator registered, a sweep that finds nothing, and no line anywhere saying why.

`available()` is the two conditions together: a renderer has injected, and `transcriptRow` resolved
to a selector in this version.

The related signal is `diagnostics.mounts.driver`. `"observer"` against the real extension means the
React anchors have gone, so the mount service has fallen back to a document observer *and* the
transcript capability is empty — one number that reports both.

## What a decoration must not do

The lesson `time-marks` paid for, and the one worth reading before designing another.

A row is a flex column, so anything `build` returns becomes a flex item and claims a line of its
own, pushing the row's content down — while the row's timeline dot is the row's own `:before`,
positioned at a fixed offset from the row's top, and does not move with it. The result is a column
of dots beside nothing.

Reserving a gutter with `padding-right` works and is not worth what it costs: every line in every
message wraps earlier, code blocks lose width, and the transcript grows taller to make room for a
label that was meant to be free. **Narrowing the content is the one thing a decoration here must
never do**, and it rules out most of the tidy-looking options.

What is free is the seam. Rows are `padding: 8px 0` with `gap: 0`, so two adjacent rows' padding
meets and leaves an unused vertical band; a label hung a few pixels above a row's top edge sits in
that band and overlaps neither message. An absolutely-positioned flex child with neither `left` nor
`right` set falls to its static position — the content box's own edge — which lands correctly in
both a timeline row and a plain user row without the plugin knowing which it is in.

`time-marks` moves content in exactly one place, a day or pause divider, and does it through the
app's own `--message-padding-top` rather than a padding of its own, because that variable already
drives the row's padding, the content's offset and the dot's position together.
