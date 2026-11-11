# Open questions and deferred work

What Rigline has not decided yet, and what it has decided not to build until something triggers it.
Where the work stands is git and the [CHANGELOG](../CHANGELOG.md); why the shape is this shape is
[decisions.md](decisions.md); new work is planned outside the repo, in `.local/plans/`.

## Open questions

None of these is planned yet, and each wants a decision before anything is built. The first changes
what a plugin is written against.

- **Whether a plugin may have the resolved selector**, as `ctx.selector(name)`. `ctx.anchor()` hands
  back a bare class, which serves the two uses D7 names — borrowing a class for your own markup, and
  the host querying for you. It leaves a third: a plugin writing CSS *about* the app's own elements,
  which can only be scoped to the class and so lands on every control wearing the look. Recommended
  but not taken, because it is the first plugin-facing API that hands over something version-derived
  and composable. Until it is settled the authoring guide says: scope a rule to something you
  placed, never to an anchor's bare class. Taking it means widening what `ctx.style` counts as
  declared to every class in the anchor's resolved selector, since one with a `within` carries its
  ancestor's class and would otherwise be refused (D107).
- **Anchor governance** (D44): who may add to the table, and what evidence an entry needs. Half of
  the promotion path exists already: an override whose anchor this version resolves without it is
  reported as changing nothing, which is the signal that the shipped table has caught up and the
  entry can go. What is missing is the other end — how an entry gets into the shipped table, and on
  whose say-so.
- **What Rigline is for once Claude Code has its own webview hooks.** 2.1.300 ships a first-party
  surface that overlaps several of ours. Read in that bundle: a stylesheet module `mLbNFw` whose
  class names are `mark`, `rowMark`, `askMark`, `band`, `bandRoom`, `abovePrompt`, `promptLabel`,
  `statusLine`, `statusLines`, `toast`, `tab`, `tabs`, `inlinePane`, `paneOwner`, `plugin`,
  `pluginName`, `heldNote`, `rowReleasedNote`, `toolRowHeld`, `edited`, `givesWay`, `unmarked`; three
  new message types, `engine_hooks_kept`, `engine_prompt_ask` and `engine_surface_state`; and a row
  store with `rowStanding`, `mayAsk`, `noteRow` and `holdUnpainted`. A row whose standing is *held*
  renders `visibility: hidden` until the engine answers for it or twenty seconds pass, so text a
  hook would redact is never shown first — the notification beside it reads "This was shown before
  your plugins checked it. Text they would hide may have been visible."
  That is zones above the prompt, status lines, toasts, panes and per-row decorations, from the app,
  for CLI-side plugins. None of it is reachable by a webview plugin of ours and none of it changes
  anything Rigline does today; what it changes is the argument for what Rigline should be doing in a
  year, and whether some capabilities are better spent elsewhere. Nothing here is a decision yet, and
  the first move is to read the mechanism properly rather than to react to its class names.

## Deferred, with triggers

- **A stability sample that sees a write in flight** (D83). On Windows a stat by path can report a
  file's previous size and mtime mid-rewrite, so the sample can pass during a write; the writers it
  could miss are accounted for (D81, D105). Triggered by a backup reported as not whole, or a tool
  found writing Claude Code's bundles in place. The candidates are `fstatSync` on a handle in
  `stampOf`, or reading the bytes twice and handing those to the backup and the harvest. First read
  which call libuv makes for a by-path stat on Windows, and whether a handle held during another
  process's write, rename or delete is harmless to it.
- **A lock's release refused.** A create refused while a released lock lingers is waited out; the
  release itself is not guarded. Something holding a lock file open *without* share-delete would
  make the holder's `rmSync` throw from its `finally`, hiding the work's result and leaving the lock
  to the stale rule. Nothing has shown it. Triggered by a holder's own exit naming `EBUSY` or
  `EPERM` on a lock file; the bounded retry in `writeFileAtomic` (D114) is the shape.
- **What [support.md](support.md) lists as not supported yet.** Taken by demand, not by who asked
  first, and none gets a date. Another editor, a portable VS Code or a custom extensions directory
  starts with the engine taking a directory, which the companion already knows for itself; a
  baseline per editor is the design, and the forks' directory names are unread. A remote window runs
  Claude Code on the remote host from `~/.vscode-server/extensions` ([companion.md](companion.md)).
  Short of supporting it, `rigline` run on a remote host could say that is where it is: today
  `install` there reports no Claude Code installed, and installs no companion, since the ensure step
  runs only where Claude Code is (D143).
- **The Open VSX ownership claim.** The `rigline` publisher holds the companion's id on the
  Marketplace. On Open VSX the namespace is made but has no owner, so it takes anyone's publish,
  marked unverified. Nothing of ours reaches it while 1.0 is VS Code alone: the Save link is
  `vscode://`, and Settings Sync asks the Marketplace. Triggered by the first Marketplace extension
  under `rigline`, which makes the proof its repository, or by taking editors other than VS Code,
  whichever comes first. [releasing.md](releasing.md)'s step 6 has the claim.
- **Adding and updating plugins through the companion**, which the wrapper handing plugin work to the
  engine makes possible. A palette command runs the engine's `add` as Show Plugins runs `list`; it
  moves D84. Never from the panel: any plugin can read the Save link's token (D93), so an add behind
  it would let one plugin install another. Triggered by the first third-party plugin with users.

- **A preset carrying per-plugin settings.** The format carries a layout and nothing else (D131),
  and settings are now a thing it could carry. Triggered by somebody wanting it. What it will need
  deciding first is how much a stranger's settings value can cost, which is bounded by the reading
  plugin's own declared capabilities rather than by the value — and `rewrites` is the one capability
  that sends without a gesture, so it is the one to think about.
- **What a diagnostic check may do**, left open by phase 6. Be `async`: no for now, because lines
  landing at different times make the badge count briefly wrong. Be collapsed per contributor: when
  `core` outgrows a screen. Ask for host state: that is a request for a capability, decided by name.
- **`rigline corpus fetch <version>`**, a Marketplace VSIX into the corpus. Every version so far was
  snapshotted from a live install; the trigger is one that was missed.
- **Line tags for a superseded major** ([ci.md](ci.md)): when a `3.x` branch opens.

- **git as a plugin source.** No publish ceremony and no npm account: GitHub, GitLab and Codeberg
  serve `archive/<ref>.tar.gz`, which the tar reader already handles, with `{kind: "git", url, ref,
  sha}` as the source record D49 left room for. Its one cost is that the built entry must be
  committed at the ref, since an author's build never runs on a user's machine (D33). Revisit D33
  when it is taken.
- **A plugins repository**, the home for a first-party plugin that is not part of the product.
  Triggered by the first such plugin; the git source comes first.
- **Merging edits from several sources.** A save from the panel overwrites the file's layout, or a
  plugin's whole section, and warns when that replaces a change made since the panel loaded (D92,
  D140). So two windows editing two keys of one section lose one, and say so. Revisit when that
  warning costs somebody work.
- **Two saves from two windows at once can lose one.** Each window's companion chains its own saves,
  but two companions share no lock — `withHomeLock` wraps installing the engine, not writing
  `config.yaml` — so two saves landing within the same few milliseconds can each read the file
  before the other writes, and the second silently drops the first. The write is atomic (D114), so
  nothing tears. Layout and settings saves alike, and nobody saves from two windows in the same
  instant. The fix is to take the home lock around a config write. Triggered by one report of a
  save that vanished.
- **Ultracode in `model-favourites`' tab.** A favourite or the default may carry `ultracode`, and a
  hand-written one is kept, applied and shown on its chip, but the tab has no control for it.
  Triggered by somebody wanting to set it without editing `config.yaml`.
- **Decorations in React.** Per-row transcript decorations stay DOM. Triggered by a decoration DOM
  makes painful; first answer the cost of one portal per row at several hundred rows, and the frame
  in which a new row's node is empty before React renders into it.
- **Menu order in `config.yaml`**, as a list of plugin names beside the layout (D89). Triggered by
  somebody asking to reorder the RIG menu.
- **A JSON Schema for the layout**, generated at install from the installed elements, so an editor
  with a YAML language server completes element and place names. Triggered by hand-edited layouts
  going wrong.
- **session-id's messaging address at launch** (D120). Triggered by Claude Code making stable
  addresses unconditional, which today hang on the GrowthBook flag `tengu_session_stable_address`:
  the flag's name leaving the CLI binary of a new corpus version is the tell. Until then the panel
  cannot see the flag, and deriving the stable form while the CLI uses the per-process one hands out
  a wrong address with nothing to say so. Stable, the ref is the first six hex of
  `sha256("session:sid:" + sessionId)`; a name nobody chose is the directory's basename, sanitised,
  a hyphen and a suffix from `sha256(sessionId)` by a function still to be read; a chosen name is
  the session's `customTitle`. Today's ref is `sha256("session:" + messagingSocketPath)`, the path
  being in `~/.claude/sessions/<pid>.json`, and the name's suffix is a random byte.
- **context-meter's first reading in the harness.** Missed once in 17 full suites, never alone or
  in fifty concurrent runs of its own file, cause not found. If it is the product's, a panel shows
  "–%" until the first turn's reading. The test's miss now names what the host sent and what the
  pill shows; triggered by that report.
- **The RIG pill as an element** (D97). Triggered by somebody asking to move it; weigh a person
  switching off the one control that always reaches the menu.
- **Colour on `Pill`** (D89): any colour allowed, the theme's own the easy choice. Triggered by the
  first plugin that wants a coloured pill. Whatever wraps a pill to colour it must not be a plain
  inline box: a slot is a flex container, so a plain span becomes a block holding a line of text,
  and the pill sits on that line about a pixel low. The RIG pill's span is `inline-flex` for this.
