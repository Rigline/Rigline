# session-id

A small pill at the end of the composer footer's left cluster, showing which session this panel is
hosting, with every identifier it has in Rigline's menu.

## What it shows

- **The first 8 characters of the session id.** Always — this is the pill's whole job.
- **A dimmed placeholder**, before the panel even has a session id — a brand-new session has none
  until Claude assigns one, and the placeholder is what tells "placed, waiting" apart from "not
  placed at all".

Click the pill to copy the session id **in full**, with a brief "copied"/"failed" flash over its
normal text that leaves the pill its size. In full rather than the eight characters on screen: the
short form is for recognising a session, and anything that asks for an id wants all of it.

Every known identifier — the messaging address, the full session id and its short form — is under
**Session identifiers** in Rigline's menu, behind the RIG pill. Choose one to copy it.

The pill is one of three elements. The other two, **Full session id** and **Messaging address**,
belong in `rigRow`, the row under the composer's controls, and start off.

### Why the pill is not the messaging address

It was, and it was wrong. The address is unbounded: the CLI names a session after its directory, so
a worktree called `abcd-1234-ticket-work-46` has an address that wide, and a Remote Control session
takes its *title*, which can be a whole sentence. A badge wedged into the composer footer has room
for a token, not a phrase. A session id is fixed-width and its first eight characters identify a
session as well as anything does, so the pill shows the thing it can rely on and the address lives
in the menu, which is where you go when you actually want to copy it.

## What it depends on

- **`footerSpacer`**, as the short id's place: immediately before it, which puts the pill at the end
  of the footer's left cluster rather than out beside the send button. A placement is not a
  requirement: if a future extension version retires the anchor, the short id renders nowhere, the
  install and the diagnostics panel say so, and the menu goes on working.

  The model pill is the obvious anchor and the wrong one. The footer measures the widths of its own
  element children to choose one of three fit stages, and the widest stage moves the pill out of the
  footer into a row of its own — so a decoration anchored to the pill leaves and re-enters the
  container being measured every time the measurement changes its mind, and re-entering it
  re-triggers the measurement. That oscillates at one cycle per frame and makes the composer
  unusable. See D54 in `docs/decisions.md`.
- **`tools: true`** (required): `ctx.onToolResult`, read for `ListAgents` and `SendMessage` only,
  since any other tool's output — a Read of this plugin's own tests, say — may quote the sentence
  the address is taken from. Why the address is scraped from text at all, rather than read from a
  declared field, is answered in the header comment of `src/index.tsx`: the CLI writes it to a
  session file, the extension host's own registry parser drops it, and the one place it reaches the
  webview for every session is the plain text of a tool result.
- **`session: true`** (required): `ctx.onSessionId`, so the pill knows which session it is
  labelling. Which bus message actually carries that, and why three tempting alternatives are each
  wrong, is answered once in `packages/plugin-api/src/session.ts`.
- **`menu: true`** (required): the Session identifiers submenu in Rigline's menu.
- **`launch_claude`** (optional, under `messages`): the message the panel sends to start a CLI
  process, which is how the plugin knows *Reload Claude* happened. Without it, an address is offered
  until the panel switches session, as though every address outlived a restart.

## What it cannot see

- The address is not something the panel can ask for. The CLI writes it to
  `~/.claude/sessions/<pid>.json`, the extension host's own registry parser drops it, and the
  status the panel can ask for holds all of it only once a session has been renamed. This plugin
  reads it out of tool-result text instead, which is why the pill is built to work without it and
  treats the address as a bonus once seen.
- An address is taken to belong to a CLI *process*: its ref is re-rolled when the process restarts,
  which *Reload Claude* does under the same session id. So it is held only in memory, stamped with
  the session and the process it was observed for, and stops being shown once the panel launches
  another process or switches session — even if that switch happens before the new session's id has
  arrived. Where the result that stated it says addresses "stay the same when a session restarts",
  which the CLI prints when it keys them on the session instead, it outlives a restart.
- No `navigator.clipboard`: copies go through `document.execCommand("copy")` over a detached
  textarea, because the async Clipboard API needs a permission this webview does not necessarily
  hold and fails silently (a rejected promise) rather than throwing.
