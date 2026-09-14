# worktree-prefix

Prefixes a session's native VS Code tab label with the worktree it belongs to: a ticket key (e.g.
`TD-1234`) when the worktree directory's name starts with one, and otherwise as much of the name as
fits in eight characters, cut at a word boundary. Tabs from several worktrees of the same repo are
then told apart at a glance:

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

## How it works

The tab title has exactly one writer — the extension host's `rename_tab` handler — so this plugin
works entirely by rewriting the outbound `rename_tab` request (`ctx.rewrite`). It touches no DOM at
all: session tabs are real VS Code editor tabs, outside the webview's DOM entirely, and a rewrite is
the only route there is to the label.

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
`ctx.onToolUse` cannot reach, since no tool call happened here to observe it. The patch is optional:
without it, the plugin still catches every worktree move made during the conversation itself, and
only loses the "already there when the panel connected, or after a reload" case.

## What it cannot see

The extension's own worktree detection is a single regex over a session's cwd, matching only a
`.claude/worktrees/<name>` suffix. A worktree made outside that convention (`git worktree add
../foo`) reports `worktree: undefined` from the extension itself — the information never reaches
the webview — and no amount of cleverness here recovers it. This is why `EnterWorktree`'s `{path}`
form (an existing worktree, which may sit outside that convention) falls back to the path's own
last segment as a label, rather than assuming a `.claude/worktrees/` layout.

## Why nothing here is declared under `uses.optional`

This plugin has two genuinely optional information sources by design, which reads like the
textbook case for D41's `uses.optional`. It is not declared that way, because of what the current
host implementation actually does with an optional declaration for anything other than an anchor or
a raw class: `ctx.onMessage`, `ctx.onToolUse`, `ctx.onSessionId` and `ctx.rewrite` are granted by
checking only the *required* half of a plugin's `uses` (see `packages/host/src/capabilities/{messages,tools,session,rewrites}.ts`).
An identifier declared solely under `uses.optional` is therefore never in the declared set those
grants check, so calling the corresponding `ctx` method throws unconditionally — *even when the
identifier is present* — which disables the whole plugin the moment it is called. That is strictly
worse than declaring the same identifier required, where the plugin at least loads and runs for as
long as the identifier exists, and is refused cleanly, by name, only if it truly goes.

`ctx.watch` was deliberately extended to accept an anchor declared under either half of `uses`
(`packages/host/src/capabilities/mount.ts`); `messages`, `rewrites`, `tools` and `session` were not
given the same treatment. Every identifier this plugin depends on — `session`, `tools`,
`list_sessions_response`, `update_state`, `init_response`, `rename_tab.title` — is declared required
as a result. The two-detection-source design is unaffected; it just cannot be expressed as
resilience against the *extension* retiring one of its sources, only as a plugin that (correctly)
still works when both continue to exist. See the worked-plugin report for the full reasoning.
