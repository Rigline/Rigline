# Before 1.0: the to-do list

Three lists in two files, one per machine. This one holds **list W**, worked on the Windows machine,
and **list R**, Leo's release after both. **List M**, for an agent on the Mac, is
[todo-1.0-mac.md](todo-1.0-mac.md); the rules and decisions below apply to it too. Everything not
marked *optional* is wanted before 1.0.0; an *optional* item can land in any 1.x, and R2 is a last
look at them before 1.0.0. Items marked *unconfirmed* carry a reviewer's reasoning but have not been reproduced: reproduce them before
fixing.

Where things stand: lint, typecheck and all 1436 tests pass with no skips, `pnpm release major`
takes 1.0.0-alpha.13 to 1.0.0 correctly, and every curated anchor still resolves on 2.1.283.

## Working the lists

- **Ownership.** List M owns `packages/vscode` and `packages/cli`, their READMEs,
  `docs/companion.md` and `todo-1.0-mac.md`. List W owns everything else, this file included. Each
  machine edits only its own to-do file. Work that turns out to need a file the other machine owns
  goes under *Handed over* at the end of your own list, naming the file; each machine reads the
  other's *Handed over* after every pull.
- **Both lists commit to `main`.** Pull before starting and before each batch; commit small, tick
  the item (`[x]`) in the same commit as its fix, and push straight after, so the other machine sees
  it. A conflict in `CHANGELOG.md`'s `## Unreleased` keeps both entries.
- **Decision numbers.** The next free one is D116. Pull before taking one, and push the commit that
  takes it at once. A fix that moves a recorded decision amends it and says so.
- **The repo's rules hold**: root `CLAUDE.md`, and planning a batch before coding it (its plan in
  `.local/plans/` on the machine doing it). The Mac has no corpus at `c:/dev/kb`, so the corpus tier
  and the harness skip there, as they do in CI; that does not touch list M's packages.

## Decided with Leo

Settled provisionally, so the work can proceed. A fix that turns up a reason against one stops and
asks rather than building around it.

- **`next` exists only while a preview line is open**, and a promotion removes it, so a stable
  release costs no dist-tag authentications. D61 is amended (W31).
- **The engine's Node floor is checked at acquisition**: the wrapper and the companion withhold a
  move to an engine the Node they run cannot satisfy, as the age gate withholds one (M5).
- **What exit 1 promises.** The commands that change or check the install follow the rule; the
  reports exit 0 whenever they produced their report; `check` exits 1 over a version not injected
  unless a `restore` holds Rigline out, and `update` exits 1 when adding the companion failed (W23).
- **A layout place Rigline does not know is under *Needs you***, as an unknown key is (W45).
- **`rigline dev` adds each build** as `add` from a path does, then injects (W2).
- **A certain plugin failure is in the plain report**; what only an author needs stays behind
  `--verbose` (W21).
- **The schema's `$id`** is `https://cdn.jsdelivr.net/npm/@rigline/plugin-api@1/schema/manifest.json`
  (W19).
- **`remove` keeps deleting** what is in `~/.rigline/plugins`, since that directory is Rigline's,
  and refuses a link (W43).
- **The compliance page and the plugin policy say what is true**: a plugin may change what passes
  between the panel and the extension on the machine, never what the extension sends off it
  (W44, R5).
- **Scope**: every item not marked *optional* before 1.0.0, then a last look at the optional ones
  (R2). The wrapper's `--version` refusing extra arguments is promoted from optional (M29).
- **The reload offer goes stale when it goes up**, which is D82 delivered rather than moved: an
  unanswered toast never resolves, so the status bar is where the offer lives (M9).

## List W: Windows

### Blockers: the documented author path does nothing

- [x] **W1. `pnpm create rigline-plugin` exits 0 having done nothing**, and so does `npm create` on
  macOS and Linux. The guard at `packages/create-plugin/src/index.ts:230` compares
  `import.meta.url`, which is the realpath, with `resolve(process.argv[1])`, the path the bin shim
  used; pnpm reaches the package through a link and Unix npm through a symlinked `.bin`, so
  `main()` never runs. Reproduced through a junction. **Fix:** a separate bin file that calls
  `main()`, as core's `engine/bin.ts` does, and a tier-4 step running the scaffolder's bin by name
  through pnpm.
- [x] **W2. `rigline dev` in an author's workspace re-injects the stale copy.** It builds the named
  directories in place, then installs from `discoveryRoots()`
  (`packages/core/src/engine/main.ts:225-228`), which outside this checkout are the home and the
  bundled set; the copy `add` made is never refreshed. **Fix:** `dev` adds each built directory as
  `add` from a path does, then injects, so stopping `dev` leaves the latest build installed.
  authoring.md could say which engine injects: the workspace's `@rigline/core`, while the companion
  re-injects with the machine's at each window start.

### The host and the plugins

- [x] **W3. An `anchors.json` refinement that is not a valid selector takes down Rigline's UI.**
  `refine` and `within` are checked only as non-empty strings
  (`packages/core/src/anchors/overrides.ts:276`), so `querySelectorAll` throws at runtime. The
  watch that threw stays registered (`mounts.ts:538-539`), every later watch never runs, and
  `diagnostics.errors` grows each commit (`pre.ts:691-696`). On `footerSpacer`, `shell.start`
  places before its `try` (`shell.ts:392-395`): no pill, no menu, no elements, nothing saying why.
  `install` reports the override as resolving. **Fix:** at boot, treat a selector that does not
  parse as unresolved with that reason, so the anchors check names it and its required users are
  refused by name; `try` around the query in `runWatch`, and register a watch after its first run.
  *Optionally* a bracket and quote balance check in `mergeAnchorOverrides`, so `rigline check`
  names it too.
- [x] **W4. An override that changes only `refine` is reported as "changes nothing"**, which
  anchors.md says means delete it. `anchorOverrideOutcomes` (`overrides.ts:163-172`) compares only
  whether the class resolves, and anchors.md's own worked example is a refine-only repair. **Fix:**
  compare the resolved selectors.
- [x] **W5. The probe requires eleven identifiers it never uses.** `plugins/probe/rigline.json`
  declares three anchors and eight message types; the code calls `onMessage` for `request` and
  `rename_tab` only, and survives without `transcript` and the `rename_tab` rewrite
  (`src/index.tsx:299-313`). Any of them moving refuses the probe, so Diagnostics vanish just as
  the pill turns red, and `list` says the probe reads the whole conversation. **Fix:**
  `messages: ["request", "rename_tab"]`, and `transcript`, the tap and the rewrite under
  `uses.optional`.
- [x] **W6. session-id adopts a messaging address from any tool result.** `messagingIdentity`
  (`plugins/session-id/src/index.tsx:116-140`) checks the stringified record contains
  `"tool_result"` and takes the first match anywhere, so a Read or Grep of text holding the phrase
  renames the address — reading this plugin's own tests does it. **Fix:** `ctx.onToolResult`
  filtered to `ListAgents` and `SendMessage`, the regex over `result.content`, and `tools` in place
  of `messages: ["io_message"]` in the manifest. The comment at `:106-114` saying `onToolUse` cannot
  see results is out of date.
- [ ] **W7.** *Optional.* session-id keeps offering an address after *Reload Claude*
  (`currentAddress`, `index.tsx:127-132`). Confirmed by reading both bundles: *Reload Claude* is the
  webview's `restartClaude()`, which closes the channel and launches a new CLI process on a fresh
  random `channelId` with the same session id. The CLI's ref hashes the process's messaging socket
  unless the flag `tengu_session_stable_address` is on, when it hashes the session id instead and
  `ListAgents` adds "Session names and [ref]s listed here normally stay the same when a session
  restarts or is resumed". Off on Leo's account on 2026-09-29, so today the offered address names
  a dead process; once the flag is on, the present keying is right. The fix is not the plugin's
  alone: `ToolResult` carries no channel (D51), so it needs an additive per-process key on it,
  which stays safe under the flag, where it only hides a valid address until the next
  `ListAgents`.
- [x] **W8. time-marks says "Today" over yesterday's rows** in a panel open past midnight: the day
  name is fixed when the node is built (`plugins/time-marks/src/index.tsx:124-131`), and the host
  rebuilds only when entries differ. **Fix:** re-register the decorator at local midnight, which
  resets and redraws (`host/src/kernel/transcript.ts:181-184`).

### `restore` and the state Rigline keeps

- [x] **W9. Per-version isolation is incomplete.** `status` and `check` stop at the first broken
  directory: a truncated `package.json` or a missing `extension.js` is a stack trace, and a
  directory holding only `package.json` stops `status` naming nothing else (`flow.ts:315-324`,
  `main.ts:802-816`). `install` rethrows `EPERM`, `EACCES`, `ENOSPC` and `EROFS`, skipping every
  later version (`flow.ts:410-414`), and `restore`'s payload `rmSync` is outside any `try`
  (`inject.ts:742`). **Fix:** each refuses that version with a sentence and goes on (D104).
- [x] **W10. A half-deleted directory is reported as "an extension update is probably in progress;
  try again"** (`inject.ts:450`, `flow.ts:661`), which never comes true, since VS Code renames into
  place (D83), so every window start says it needs you. Say what it is. `install --ext` on a path
  that does not exist gets the same line; `restore` on a directory with only `package.json` prints
  the path twice and tells a person to reinstall Claude Code over a directory holding nothing of
  Rigline's, where one missing only `extension.js` gets "nothing of Rigline's was in it".
- [x] **W11. A `generated.ts` in the working directory.** `readBaseline` takes any `generated.ts`
  where the command runs (`packages/core/src/update/baseline.ts:79-82`), so one that is not
  Rigline's makes `install` throw after injecting, losing the report, with advice that overwrites
  the file. **Fix:** pass over a `generated.ts` without codegen's header line. M6 is the companion's
  half.
- [x] **W12. An interrupted write destroys what `restore` restores.** A bundle cut short is taken
  as unrelated and becomes the backup; a first backup cut short is a prefix of the live bytes and is
  rolled back over Claude Code's bundle; `restore` then reports success (`inject.ts:197-226`, with
  the writes at `:200`, `:218`, `:224`, `:601`). **Fix:** write to a temporary file and rename. In
  `settleWebviewBackup`, live bytes that are a prefix of `PRE + backup + POST` are our own
  interrupted write, and a backup that is a strict prefix of loader-free live bytes is rewritten
  from them.
- [x] **W13. A truncated `baseline.json` fails every `install` and `check`** until somebody deletes
  it (`baseline.ts:84-91`), and it is rewritten at every companion window start. **Fix:** write it
  as W12 does, and treat an unreadable one as absent, since it is bookkeeping stability.md does not
  keep. The same write for `config.yaml` and `sources.json` (`plugins/config.ts:120,263,280,283`).
- [ ] **W14.** *Optional.* **A lost `extension.js.orig` leaves the host patch for good**, and
  `restore`, `status` and `doctor` all say vanilla (`inject.ts:176-177`, `:229-231`, `:738`).
  Reverse it from the baked manifests under `webview/rigline/plugins/*/rigline.json`, which carry
  each patch's find and replace. It needs the backup deleted. Only a person or another tool can
  cause it: the backup is written before the live file, and nothing of Rigline's deletes one. It
  lasts until the next Claude Code update replaces the directory, and `install` meanwhile reports
  the patch as refused, since `find` matches nowhere. **The reversal is unsafe**: with no backup it
  cannot tell a lost backup from a Claude Code build that ships the `replace` bytes itself, and
  would write the old bytes into that build. A report in `status` and `doctor` is the safe half.
- [x] **W43. `remove`, and replacing a plugin, over a link.** `remove` deletes a plugin's directory
  in `~/.rigline/plugins` whether or not `add` put it there (`plugins/manage.ts:298`), which is
  right, since the directory is Rigline's; its usage says such a plugin is only switched off, which
  is wrong. And `add`, and so `dev` after W2, delete a same-named directory before copying
  (`manage.ts:187`). Where that directory is a symlink or a junction — an author linking a working
  tree in, say — the target is somebody's source. **Fix:** both refuse, naming the link and its
  target, when the plugin's directory is a link; the usage says `remove` deletes. Check with a
  junction on Windows that `lstat` reports it as a link, and that a link *inside* a plugin
  directory is unlinked rather than followed. Now rather than later: refusing after 1.0 would
  refuse an invocation 1.0 accepted.

### What a user or author reads

- [x] **W15. The README's manual undo** names `anthropic.claude-code-<version>`; the directory is
  `-<version>-<platform>` (`host.md:9` has it right). And a companion still installed re-injects at
  the next window, since a copy leaves no `restored` mark: say to remove it first.
- [x] **W16. The README's first install** says *Reload Webviews*; the first install patches
  `extension.js`, and its own report says *Reload Window*. "The first command fetches the engine" is
  the first `rigline` command, not `npm install -g`. The Layout section leaves out `packages/vscode`
  and says core answers "every verb but `update`".
- [x] **W17. An uninstall section in the README**: `rigline vscode-setup --remove`, `rigline
  restore`, `npm uninstall -g rigline`, then `~/.rigline`. Only CONTRIBUTING has one.
- [x] **W18. core's README** says "zero third-party runtime dependencies" beside `es-module-lexer`
  and `yaml`, and that `rigline-engine` answers every verb "except `update`". Its description and
  first line call it a Node library, which invites a use stability.md excludes: "the engine".
- [x] **W19. The manifest schema's `$id`** is `https://rigline.dev/schema/manifest.json`
  (`packages/plugin-api/src/schema.ts:43`, published in `schema/manifest.json`), a domain belonging
  to an unrelated company. **Fix:**
  `https://cdn.jsdelivr.net/npm/@rigline/plugin-api@1/schema/manifest.json`, which resolves to the
  newest 1.x schema, the one `api: 1` means.
- [x] **W20. plugin-api's README** says an undeclared use "finds nothing there"
  (`packages/plugin-api/README.md:52-54`); it throws and disables the plugin.
- [x] **W21. Notes only `--verbose` prints**, which authoring.md:131-133 and :436-437 and
  anchors.md:132-135 say plain `install` shows (`inject.ts:579-584`). **Fix:** a certain failure
  ("calls onToolUse without declaring tools: it will throw and disable the plugin") goes in the
  plain report beside its plugin, since it explains a disabled plugin to anybody; the hand-written
  class notes and raw class-pair counts stay behind `--verbose`, and the docs say which is where.
  Neither changes the exit status. `dev` prints the certain ones too.
- [x] **W22. A Node floor check where the engine starts** (`packages/core/src/engine/bin.ts`), as M4
  is for the wrapper.
- [x] **W23. What exit 1 promises.** stability.md:92 promises exit 1 when something needs you;
  `list`, `status`, `doctor`, `diff` and bare `layout` always exit 0, and `check` exits 0 over a
  version that is not injected. **Fix:** stability.md names the two kinds. The commands that change
  or check the install — `install`, `check`, `update`, `add`, `remove`, `enable`, `disable`,
  `layout`'s edits, `restore`, `codegen --check` — exit 1 when something needs you. The reports —
  `list`, `status`, `doctor`, `diff`, bare `layout` — exit 0 whenever they produced their report,
  which is what the code does already. `check` exits 1 over a version not injected, unless a
  `restore` holds Rigline out, which it then says, with exit 0. And `update` exits 1 when adding the
  companion failed: it prints "added the companion to no profile" and exits 0, since the additions'
  `failed` never reaches the exit status (`main.ts:436-442`).
- [x] **W45. A layout place Rigline does not know is under *Needs you*.** `parsePlace`'s "is not a
  place" (`packages/plugin-api/src/layout.ts:60-63`) is only noted, with exit 0, where an unknown
  `config.yaml` key is under *Needs you* (D110). D110's reasoning holds for a place: it is a typo, or
  a place a later Rigline added, whose elements an older one would quietly send back to their
  defaults. **Fix:** name it under *Needs you*, exit 1, and suggest a later Rigline, as the key
  message does; stability.md's config paragraph says so. A place beside an anchor Claude Code
  removed stays a report, as stability.md already promises. Now, since moving an exit status to 1
  later is the tightening W23 rules out.
- [x] **W24. The scaffold's publishing steps** (`packages/create-plugin/template/README.md:83,
  101-104`, `template/.github/workflows/release.yml:7,12-13,126-127`) use `pnpm stage approve` and
  `pnpm publish --otp`, which a security-key account cannot do — the only kind npm enrols now
  (releasing.md). Point at npmjs.com's Staged Packages page, or `npm stage approve <id>`, and
  bootstrap with `npm publish`.
- [x] **W25. The scaffold's workflows** pin `actions/checkout@v5` and `actions/setup-node@v5`
  (`template/.github/workflows/ci.yml:40,47`, `release.yml:59,85`) against this repo's v7. Its
  README says CI runs the same Node set as the release (`:67-69`); the release runs 26 alone.
- [x] **W26. create-plugin's README** scaffolds `my-plugins` then adds `plugins/my-plugin`, shows
  `src/index.ts` for a `.tsx`, and credits `tsconfig.base.json` with what `tsconfig.plugin.json`
  does.
- [x] **W27. "Delete `generated.ts` and everything still compiles"** (authoring.md:366-367, and the
  header codegen writes, `codegen/generate.ts:228`) is false in the scaffold, whose
  `tsconfig.plugin.json` lists it under `files`. The same header says `rigline update` diffs against
  it; `install` does.
- [x] **W28. The first-party plugins' docs.** The probe's README describes the badge and panel it no
  longer has, and capabilities it does not declare. worktree-prefix's README (`:84-103`) says
  optional declarations throw when present and cites a report that does not exist; its patch `why`
  (`rigline.json:23`, printed by `list` and `doctor`) and `src/index.ts:228-233` name `onToolUse`
  where the code uses `onToolResult`; its description says "first eight characters" of a cut that
  goes by word. time-marks' README (`:49`) names 2.1.270.
- [x] **W29. Smaller wrong facts.** The engine usage and `doctor` say "RIG badge" (`main.ts:214`,
  `doctor/report.ts:224`), and the usage says to copy the report from it: it is *Diagnostics → Copy
  report* in Rigline's menu. The usage's `build` names only `src/index.ts`. CONTRIBUTING says the
  probe "adds a `RIG` badge" (`:45`) and that there is "no branching model yet" (`:79`), and never
  mentions `rigline.enginePath`, so a contributor with the released companion has this checkout's
  payload replaced at every window start. `restore`'s own last line (`main.ts:886`) says "until you
  run `rigline install`" where any injecting command puts Rigline back. support.md and the README
  never state the VS Code floor, 1.90, which stability.md promises a notice for raising.
  `main.ts:823` mentions a `--logs` flag `doctor` lacks. `CLAUDE.md:191` says "`rigline update` is
  the wrapper's".
- [x] **W44. Draft the compliance page and the plugin policy to what is true**, for Leo to rework
  before anything is committed: the wording is his (D77). anthropic-compliance.md says Rigline does
  not "change what the extension sends or receives", and writes `extension.js` "only when a plugin
  asks"; the bundled worktree-prefix rewrites the `rename_tab` title on its way from the panel to
  the extension, its host patch widens the session-list request, and a default install always
  asks. It still calls the probe "a diagnostics badge" (`:59`, `:97-98`). plugin-policy.md:58-61,
  read literally, bans the bundled patch. The line both draw: a plugin may change what passes
  between the panel and the extension on the machine, never what the extension sends off it.

### Release scripts

- [x] **W30. `stageTag` stages below `latest` under `next`.** `scripts/lib/tags.mjs:49` is
  `hasStable && above(next)`, so with a stable line and `next` unset or behind, `stageTag("1.0.2",
  {latest: "1.1.0", next: null, hasStable: true})` gives `next` rather than refusing. **Fix:**
  `hasStable && above(latest) && above(next)`, with tests for `next` null and lagging.
- [x] **W31. `next` only while a preview line is open.** Once 1.0.0 is approved, `hasStable` turns
  true and `release:finish` as written runs `npm dist-tag add <pkg>@1.0.0 next` for all four
  packages, four browser authentications repeated every release
  (`scripts/release-finish.mjs:178-205`). **Fix:** amend D61; `release:finish` sets `next` only for
  a prerelease over a stable line, and removes it on a promotion. At 1.0.0 it sets nothing.
- [x] **W32. The runbook and the delivery doc.** `releasing.md:8` leads with `pnpm release
  prerelease`, which from 1.0.0 cuts `1.0.1-alpha.0` under `next` with no pause to back out: lead
  with `patch`. `ci.md:71` says `next` follows a new alpha; `ci.md:117-119` says `release:finish`
  needs HEAD to be the tag, where the code needs the tag in history;
  `.github/scripts/stage-summary.mjs:70-74` says approving takes one authentication, where
  releasing.md says to approve on the website.

### Optional, any 1.x

- [ ] **W33. The engine's messages.** `doctor --out` and `codegen --out` to a missing directory
  throw `ENOENT` (`main.ts:843`, `:932`), and `doctor` prints a raw `ENOENT` as a problem. An engine
  missing a dependency dies with `ERR_MODULE_NOT_FOUND` rather than the README's "delete it and run
  again". The release-age refusal ends "(D44)" (`core/src/plugins/npm.ts:196`, and the wrapper's
  copy at `cli/src/registry.ts:127`, which is list M's). "No Claude Code extension is installed"
  never names `~/.vscode/extensions`. A BOM in `rigline.json` or `anchors.json`, as PowerShell 5 and
  Notepad write, is refused with an invisible character (`anchors/overrides.ts:101`). `add` with an
  unknown manifest key or `api: 2` could suggest a later Rigline, as the config message does.
  `rigline help`, the engine's `--version` and `VERB --help` all say "unknown". The usage opens with
  the maintainer verbs.
- [ ] **W34. The engine's behaviour.** `install --ext DIR` injects DIR alone but keeps the global
  bookkeeping of a full install (`flow.ts:616-643`, `main.ts:307`): `baseline.json` and `drift.txt`
  move to DIR's version, a `generated.ts` in the working directory is rewritten from it, and the
  `restored` mark is cleared with "this puts it back", so the companion re-injects the real
  extension a person restored (D111). `--ext` writing none of the four is the fix. (Resolving
  `--ext` was W10's.) `status` and `doctor` never mention the
  `restored` mark, so a bug report will not show Rigline held out (`check` is W23's); `restore` with
  nothing installed writes it and says nothing. `status` says "webview unknown, no backup" for a
  version Rigline never touched, and lists oldest first where `install` and `check` list newest.
- [ ] **W35. `layout`'s wording.** "can also go rigRow"; "is not a place" lists places without
  `default` while bare `layout order` suggests `default`, which `order` refuses.
- [ ] **W36. Locks by PID alone.** Windows reuses PIDs quickly, so a crashed holder's PID can come
  back and pin a lock (`isStale` in both lock files). An absolute age cap of about ten minutes.
- [ ] **W37. Plugin files.** The tar reader declines exact duplicate names only, missing case and
  Unicode-normalisation collisions, and Windows reserved names (`con.js`) and trailing dots or
  spaces pass `safePath` (`plugins/tarball.ts:135-150`). An `entry` under a dot-directory, under
  `node_modules` or named `*.test.js` validates but is never copied (`plugins/discover.ts:104`).
  `readSources` is not given `list`'s logger (`plugins/list.ts:88`), so a source of an unknown kind
  reads as hand-placed with no reason.
- [ ] **W38. `rigline build` and `dev` through the wrapper** resolve rolldown from the engine's
  install, where it is not (`engine/build.ts:29-38`), and advise `pnpm add -D rolldown`, which
  cannot help there. Resolve from the plugin's directory. The scaffold's own scripts are unaffected.
- [ ] **W39. `codegen` and line endings.** `codegen --check` and settle's rewrite check
  (`main.ts:923-924`, `flow.ts:582`) compare a checked-out `generated.ts` with LF output, and the
  template ships no `.gitattributes`, so a Windows author with `autocrlf` always reads "out of date",
  and the first install after a checkout rewrites the file and exits 1 over no diff. And when the
  shipped anchor table is ambiguous for an author's Claude Code version, `codegen` writes the file,
  exits 1, and tells them to edit `packages/plugin-api/src/anchors.ts` (`main.ts:963`), which can
  fail the scaffold's first `pnpm codegen`.
- [ ] **W40. The scaffold.** It never typechecks its tests (`plugins/__NAME__/tsconfig.json`
  excludes them), which is how alpha.3's type error went green. A release dry run reports "Staged,
  and awaiting approval" (`release.yml:108-130`); branch on `inputs.dry_run`.
- [ ] **W41. The host.** Plugins load one after another (`post.ts:380-386`) and the `import` is
  unbounded, so one whose top-level await never settles stalls every later plugin, the replay
  buffer's seal and the shell. Race it against a timeout and report it by name. A plugin named
  `core` shows its checks as the host's (`host/src/kernel/checks.ts:36`); rename the host's
  contributor to `rigline`, which is reserved.
- [ ] **W42. The plugins.** With the probe disabled, the pill still counts failures the menu cannot
  show (`shell/index.tsx:144-158`). The copied probe report carries the messaging address and the
  worktree label (against `probe/src/checks.ts:247-249`, D53). `EnterWorktree` with neither `name`
  nor `path` leaves a stale prefix (`worktree-prefix/src/index.ts:147-155`, *unconfirmed*).
  `worktreeLabel` slices by UTF-16 unit and can cut an emoji. time-marks shows no year on an old
  session. `list` prints each description on one line, and session-id's is about 330 characters;
  the four do not share a voice.

## List R: the release, Leo's

Alphas ship as there are things to test, as they have; 1.0.0 comes after lists M and W, bar their
optional items.

- [ ] **R1. The alpha reads.** On an alpha carrying lists M and W: M26 to M28, and the Mac's first
  install through the released wrapper under Homebrew's Node. The alpha carrying W1 ships at least a
  day before 1.0.0, since pnpm 12's `dlx` applies the one-day release age and so serves the version
  before on the day one ships.
- [ ] **R2. A last look at the optional items** on both lists: which, if any, 1.0.0 takes.
- [ ] **R3. The release text**, which `release.mjs` does not touch and which must be committed
  before it runs, since it refuses a dirty tree: `README.md:26`, "1.0 is under construction"; the
  CHANGELOG preamble, "While the line is `1.0.0-alpha.*`"; `stability.md:7`, "Until 1.0.0 ships".
- [ ] **R4. The 1.0.0 changelog lead.** `## Unreleased` becomes the 1.0.0 section and the GitHub
  release's notes. Before 1.0.0 is cut, a paragraph ahead of its first `###`: the first stable
  release, what stability.md keeps, and the step from an alpha, `npm i -g rigline@latest`.
- [x] **R5. W44's draft**, reworked into the compliance page and the plugin policy.
- [ ] **R6.** `pnpm release major --dry-run`, then `pnpm release major`.

## Handed over to the Mac

- [ ] **From W43.** `packages/cli/README.md:73` says `rigline remove` deletes "a plugin rigline
  installed". It deletes whatever is in `~/.rigline/plugins` under that name, and refuses a link
  there; the engine's usage now says "Delete a plugin from ~/.rigline/plugins, however it got there".
