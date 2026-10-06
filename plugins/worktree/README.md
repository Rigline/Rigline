# worktree

Prefixes a session's native VS Code tab label with the worktree it belongs to: a ticket key (e.g.
`TD-1234`) when the worktree directory's name starts with one, and otherwise as much of the name as
fits in eight characters as a reader counts them, cut at a word boundary. Tabs from several
worktrees of the same repo are then told apart at a glance:

    ABCD-123 › Refactor the bus

The separator is a chevron rather than a hyphen because session titles routinely contain hyphens —
a ticket key in the title is the common case — so `ABCD-123 - Refactor the bus` reads equally well
as a session called that and not in a worktree, or a session called "Refactor the bus" inside
worktree `ABCD-123`. Answering that at a glance is the whole point of the prefix. U+203A sits in
the same Unicode block the rest of a title draws from, so it renders in the tab's own typeface
rather than falling back to another font the way a box-drawing bar can, and it reads as containment,
which is the actual relationship.

A ticket key is never shortened, however long it is: `PLATFORM99-100001` comes through whole. The
pattern is a letter, one to nine more letters or digits, a hyphen and one to six digits, which
covers Jira's real bounds along with Linear and Shortcut; requiring a letter first is what keeps a
dated name like `2026-09-14-spike` from reading as ticket `2026-09`.

The word-boundary cut is not cosmetic. A blind eight-character slice turns `ABCD-1234` into
`ABCD-123` — not a shortened name but a different, perfectly plausible ticket number, printed onto
a real tab with nothing to tell a reader it is wrong. Cutting at the separator gives `ABCD`, which
nobody will mistake for a key.

## The pills

The same label is a pill under the composer, in `rigRow`, with an ellipsis when it is not the whole
name — `TD-1234…` for `TD-1234-close-the-write-leak` — and the whole name on hover. A second pill,
**Full worktree name**, shows all of it and starts off. Either can go before the footer spacer or in
`rigRow`, placed from Rigline's Layout or with `rigline layout`.

Both show exactly when the tab has a prefix, and nothing otherwise: outside a worktree, and in a
window opened on the worktree itself, whose title already says which one it is. Nothing rather than
a placeholder such as `main`, which that second case would make wrong.

## How it works

The tab title has exactly one writer — the extension host's `rename_tab` handler — so the prefix is
entirely a rewrite of the outbound `rename_tab` request (`ctx.rewrite`). It touches no DOM: session
tabs are real VS Code editor tabs, outside the webview's DOM entirely, and a rewrite is the only
route there is to the label.

The rewrite reapplies on every send, not once: the app's own `rename_tab` sender is a reactive
effect with no dependency list, so it resends an *unchanged* title whenever the panel's visibility
toggles or a permission request comes and goes. A prefix applied only the first time would be
silently overwritten by the next one of those.

Which worktree a session belongs to comes from two independent sources, because neither one
subsumes the other:

- **`list_sessions_response`** reports where a session *began*. It covers a session that was
  already relocated into a worktree before this panel connected — a tool call in this panel's own
  lifetime could never observe that.
- **`ctx.onToolResult`**, watching `EnterWorktree`/`ExitWorktree` *outcomes*, reports where a
  session *moves to* during the current conversation. The outcome rather than the call: a move the
  user declined, or one that failed because the branch was already checked out elsewhere, arrives
  at `ctx.onToolUse` looking exactly like one that worked, and acting on it renames a real tab
  after a move that never happened. The app refetches the session list on connection, an
  archive change, a config-home move, activating a session it does not already hold, and opening
  the session picker — a session changing its own cwd is none of those, so nothing else would
  notice a move made mid-conversation.

An observed tool-call move always outranks the list, and entering or leaving a worktree does not
itself make the app resend `rename_tab` — this plugin calls `ctx.resend("rename_tab")` itself so
the new prefix appears immediately rather than waiting for the next incidental rename.

An `EnterWorktree` given neither a name nor a path makes one up, and its result states where it
went, so the label comes from that path. A result that does not say leaves the tab bare rather
than keeping whichever label it had.

The prefix is withheld when the window itself is already rooted on the worktree in question
(compared against `defaultCwd`, case-insensitively and separator-agnostically — a real transcript
was observed recording the same directory with two different drive-letter cases), mirroring the
gate the extension applies to its own worktree pill and banner.

## The host patch

The session-list fetch the extension makes internally passes `includeWorktrees: false`, which is
the one caller in the whole extension that opts out of worktree enumeration it already implements
and already uses elsewhere (`getSession`, the resume precheck). This plugin declares an **optional**
byte patch flipping that flag to `true`, so a session already relocated into a worktree before this
panel connected shows up in `list_sessions_response` too — recovering exactly the case
`ctx.onToolResult` cannot reach, since no tool call happened here to observe it. The patch is optional:
without it, the plugin still catches every worktree move made during the conversation itself, and
only loses the "already there when the panel connected, or after a reload" case.

## What it cannot see

The extension's own worktree detection is a single regex over a session's cwd, matching only a
`.claude/worktrees/<name>` suffix. A worktree made outside that convention (`git worktree add
../foo`) reports `worktree: undefined` from the extension itself — the information never reaches
the webview — and no amount of cleverness here recovers it. This is why `EnterWorktree`'s `{path}`
form (an existing worktree, which may sit outside that convention) falls back to the path's own
last segment as a label, rather than assuming a `.claude/worktrees/` layout.

## What is optional, and why only that

`list_sessions_response` is declared under `uses.optional`, and it is the one dependency with a
working fallback: losing it costs only the session that was already in a worktree before this panel
connected, while every move made during the conversation still arrives through `ctx.onToolResult`.
If Claude Code stops sending it, the tap never fires and the plugin goes on working (D41).

Everything else is declared required, because without it there is no feature: the `rename_tab`
rewrite is the only route to a native tab's title, the session id is what the list is read against,
and `update_state` and `init_response` carry the directory a worktree is told apart from. An update
that retires one of those refuses the plugin by name rather than leaving it half working.
