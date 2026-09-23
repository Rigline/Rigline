# session-id

A small badge at the end of the composer footer's left cluster, showing which session this panel is
hosting, with every identifier it has in Rigline's menu.

## What it shows

- **The first 8 characters of the session id.** Always — this is the pill's whole job.
- **A dimmed placeholder**, before the panel even has a session id — a brand-new session has none
  until Claude assigns one, and the placeholder is what tells "mounted, waiting" apart from "not
  mounted at all".

Click the badge to copy the session id **in full**, with a brief "copied"/"copy failed" flash in
place of its normal text. In full rather than the eight characters on screen: the short form is for
recognising a session, and anything that asks for an id wants all of it.

Every known identifier — the messaging address, the full session id and its short form — is under
**Session identifiers** in Rigline's menu, behind the RIG pill. Choose one to copy it.

### Why the pill is not the messaging address

It was, and it was wrong. The address is unbounded: the CLI names a session after its directory, so
a worktree called `abcd-1234-ticket-work-46` has an address that wide, and a Remote Control session
takes its *title*, which can be a whole sentence. A badge wedged into the composer footer has room
for a token, not a phrase. A session id is fixed-width and its first eight characters identify a
session as well as anything does, so the pill shows the thing it can rely on and the address lives
in the menu, which is where you go when you actually want to copy it.

## What it depends on

- **`footerSpacer`** (required): the badge mounts immediately before it, which puts it at the end
  of the footer's left cluster rather than out beside the send button. Without this anchor there is
  nowhere to put the badge, so it is the one dependency that refuses the whole plugin if a future
  extension version retires it.

  The model pill is the obvious anchor and the wrong one. The footer measures the widths of its own
  element children to choose one of three fit stages, and the widest stage moves the pill out of the
  footer into a row of its own — so a badge anchored to the pill leaves and re-enters the container
  being measured every time the measurement changes its mind, and re-entering it re-triggers the
  measurement. That oscillates at one cycle per frame and makes the composer unusable. See D54 in
  `docs/decisions.md`.
- **`io_message`** (required): a raw tap, not `tools: true`. The address only appears in a tool
  *result*, which `ctx.onToolUse` cannot see (it reports the assistant's tool *call*). Why the
  address is scraped from text at all, rather than read from a declared field, is answered in the
  header comment of `src/index.tsx`: the CLI writes it to a session file, the extension host's own
  registry parser drops it before anything downstream sees it, and the one place it survives to the
  webview is the plain text of a tool result.
- **`session: true`** (required): `ctx.onSessionId`, so the badge knows which session it is
  labelling. Which bus message actually carries that, and why three tempting alternatives are each
  wrong, is answered once in `packages/plugin-api/src/session.ts`.
- **`mount: true`** (required): `ctx.watch`/`ctx.mountBefore` place and re-place the badge; nothing
  here polls for the anchor itself.
- **`menu: true`** (required): the Session identifiers submenu in Rigline's menu.

## What it cannot see

- The address itself never crosses the bus as a declared field — the CLI writes it to
  `~/.claude/sessions/<pid>.json`, and the extension host's own registry parser drops the relevant
  field before anything reaches the webview. This plugin reads it out of tool-result text instead,
  which is why the badge is built to work without it and treats the address as a bonus once seen.
- An address belongs to a CLI *process*, not to a session (both halves of it are re-rolled when the
  process restarts), so it is held only in memory, stamped with the session it was observed for, and
  is never shown once the panel has switched to a different session — even if that switch happens
  before the new session's id has arrived.
- No `navigator.clipboard`: copies go through `document.execCommand("copy")` over a detached
  textarea, because the async Clipboard API needs a permission this webview does not necessarily
  hold and fails silently (a rejected promise) rather than throwing.
