# session-id

A small badge immediately after the model pill in the composer footer, showing which session this
panel is hosting, with every identifier it has one click behind it.

## What it shows

- **The first 8 characters of the session id.** Always — this is the pill's whole job.
- **A dimmed placeholder**, before the panel even has a session id — a brand-new session has none
  until Claude assigns one, and the placeholder is what tells "mounted, waiting" apart from "not
  mounted at all".

Click the badge for a pop-up listing every known identifier — the messaging address, the full
session id and its short form — and click any row to copy that value. Alt-click or shift-click the
badge itself, without opening anything, to copy the session id **in full**, with a brief
"copied"/"copy failed" flash in place of the badge's normal text. In full rather than the eight
characters on screen: the short form is for recognising a session, and anything that asks for an id
wants all of it.

### Why the pill is not the messaging address

It was, and it was wrong. The address is unbounded: the CLI names a session after its directory, so
a worktree called `abcd-1234-ticket-work-46` has an address that wide, and a Remote Control session
takes its *title*, which can be a whole sentence. A badge wedged into the composer footer has room
for a token, not a phrase. A session id is fixed-width and its first eight characters identify a
session as well as anything does, so the pill shows the thing it can rely on and the address lives
in the pop-up, which is where you go when you actually want to copy it.

## What it depends on

- **`modelPill`** (required): the badge mounts immediately after it. Without this anchor there is
  nowhere to put the badge, so it is the one dependency that refuses the whole plugin if a future
  extension version retires it.
- **The ten `footerMenu*` anchors** (`uses.optional`): borrowed styling so the pop-up matches the
  app's own footer menus. These are declared optional (D41 in `docs/decisions.md`) because they are
  cosmetic rather than load-bearing — losing the whole family degrades the pop-up to plain inline
  styling (still positioned, still legible, still clickable) rather than losing the badge.
- **`io_message`** (required): a raw tap, not `tools: true`. The address only appears in a tool
  *result*, which `ctx.onToolUse` cannot see (it reports the assistant's tool *call*); see
  `docs/archive/0.x/messaging-identity.md` for the full account of why the address is scraped at all
  and where it does and doesn't cross the bus.
- **`session: true`** (required): `ctx.onSessionId`, so the badge knows which session it is
  labelling. Which bus message actually carries that, and why three tempting alternatives are each
  wrong, is answered once in `packages/plugin-api/src/session.ts`.
- **`mount: true`** (required): `ctx.watch`/`ctx.mountAfter` place and re-place the badge; nothing
  here polls for the anchor itself.

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
