# Before 1.0: the to-do list

Three lists. **List W** is worked on the Windows machine, **list M** by an agent on the Mac, and
**list R** is Leo's release, after both. Everything not marked *optional* is wanted before 1.0.0;
an *optional* item can land in any 1.x. An item marked *waits on decision N* needs Leo's answer to
that decision first. Items marked *unconfirmed* carry a reviewer's reasoning but have not been
reproduced: reproduce them before fixing.

Where things stand: lint, typecheck and all 1387 tests pass with no skips, `pnpm release major`
takes 1.0.0-alpha.13 to 1.0.0 correctly, and every curated anchor still resolves on 2.1.283.

## Working the lists

- **Ownership.** List M owns `packages/vscode` and `packages/cli`, their READMEs and
  `docs/companion.md`. List W owns everything else. An item that needs a file the other list owns
  gets a note under that list's item here, not an edit.
- **Both lists commit to `main`.** Pull before starting and before each batch; commit small, tick
  the item here (`[x]`) in the same commit as its fix, and push straight after, so the other
  machine sees it. A conflict in `CHANGELOG.md`'s `## Unreleased` keeps both entries.
- **Decision numbers.** The next free one is D114. Pull before taking one, and push the commit that
  takes it at once. A fix that moves a recorded decision amends it and says so.
- **The repo's rules hold**: root `CLAUDE.md`, and planning a batch before coding it (its plan in
  `.local/plans/` on the machine doing it). The Mac has no corpus at `c:/dev/kb`, so the corpus tier
  and the harness skip there, as they do in CI; that does not touch list M's packages.

## Decisions that are Leo's

1. **An alpha.14 before 1.0.0.** Recommended. Nothing under `## Unreleased` has shipped, and W1 is
   the first command in authoring.md. pnpm 12's `dlx` applies the one-day release age, so on the
   day a version ships `pnpm create rigline-plugin` serves the one before it: the scaffolder fix
   must be out at least a day before 1.0.0.
2. **`next` at 1.0.0.** Once 1.0.0 is approved, `hasStable` turns true and `release:finish` runs
   `npm dist-tag add <pkg>@1.0.0 next` for all four packages — four browser authentications, on a
   path that has never run live (`scripts/release-finish.mjs:178-205`), repeated every release.
   Recommended: amend D61 so `next` exists only while a preview line is open, and a promotion
   removes it. W30 is wanted either way.
3. **The engine's Node floor, checked at acquisition.** Nothing reads `engines.node` when the wrapper
   or the companion moves the engine. When a minor drops a Node version, as stability.md allows, a
   1.0 wrapper or companion moves to an engine that cannot run, and the companion cannot then update
   itself, since that asks the engine. Only 1.0.0's acquisition code can withhold the move.
   Recommended: take it (M5).

## List M: the Mac

The companion and the wrapper, which is where every macOS-specific finding lives, then the macOS
checks nothing on Windows can do.

### Findings to settle first

- [ ] **M1. Which npm Homebrew's Node has.** Read-only, and it decides M3's scope. Run
  `node -p process.execPath`, `brew ls node | grep npm-cli` and `ls /opt/homebrew/lib/node_modules`
  with Homebrew's `node` first on `PATH`, and note which Node the Mac's own Rigline has been using.

### The companion and the wrapper finding Node and npm

- [ ] **M2. A version-manager shim strands the companion.** `findNode` returns the first `node` on
  `PATH` (`packages/vscode/src/node.ts:95-101`). Under volta, asdf, mise, nodenv, scoop or snap that
  is a shim, and `findNpmCli` finds no npm beside it, so every engine move fails, is only logged
  (`acquire.ts:258-264`), and the status stays green: engine fixes and the companion's self-update
  never arrive, and a first run with no engine fails outright. Setting `rigline.nodePath` to what
  `which node` prints gives the shim again (`node.test.ts:58` uses a volta shim as its example).
  **Fix:** ask the found Node for `process.execPath` and `process.version` in one hidden spawn with
  a short timeout, use the real binary for npm and every spawn, and refuse a Node below 22.12 by
  name. Lands with M3: the real binary under Homebrew is in the Cellar.
- [ ] **M3. Homebrew's Node: the wrapper finds no npm.** *Unconfirmed; M1 settles it.* On macOS
  `process.execPath` resolves symlinks, so under Homebrew it is
  `/opt/homebrew/Cellar/node/<v>/bin/node`, and npm is in the keg's `libexec/lib/node_modules/npm`,
  where `findNpmCli` (`packages/cli/src/engine.ts:174-191`) does not look. The first `rigline` run
  then fails, and every later `update` reports `engine: FAILED`. **Fix:** add
  `../libexec/lib/node_modules/npm`, which is still the npm belonging to that Node (D73). In the
  same function, quote the `--prefix` path in the fallback line, which breaks on a home with a
  space.
- [ ] **M4. A Node floor check where the wrapper starts.** Below 22.12 the engine dies mid-install
  with a `TypeError` (`entry.parentPath` is undefined before Node 20.12). One sentence naming the
  floor and the Node found, before anything runs. W22 is the engine's half.
- [ ] **M5. The engine's Node floor at acquisition.** *Waits on decision 3.* Read
  `versions[v].engines.node` from the registry data `updateEngine` already fetches
  (`packages/cli/src/engine.ts:408-462`), and withhold a move the running Node cannot satisfy the
  way the age gate withholds one, saying why. The companion needs the found Node's version from M2.
- [ ] **M6. The companion's engine runs in VS Code's launch directory.** VS Code changes directory
  only on Windows, and `spawnEngine` passes no `cwd` (`packages/vscode/src/extension.ts:249-256`).
  So on macOS and Linux, after `code .` in a plugin workspace, the companion's `install` takes that
  workspace's `generated.ts` as its baseline, rewrites it after each Claude Code update, and says
  it needs you. **Fix:** spawn with `cwd` at the home. W11 is the engine's half.

### The companion's surface

- [ ] **M7. `rigline.nodePath` has no `scope`**, so Settings Sync carries a Mac's path to a Windows
  machine, which then reads *no Node* (`packages/vscode/build-manifest.mjs:56-63`). **Fix:**
  `"scope": "machine"`, as `enginePath` has (D94). stability.md keeps the setting, so this is now or
  never.
- [ ] **M8. *Needs you* is a dead end.** The item has no command (`extension.ts:26-34`), and its
  tooltip says what the engine said is "in this output channel, above" (`acquire.ts:219`), which a
  tooltip has not got. Its commonest cause is a `restore` from weeks ago (D111). **Fix:** clicking
  it shows the output channel, and the tooltip carries the engine's own reason — `runEngine`'s
  `onLine` sees every line, so keep the *Needs you* lines.
- [ ] **M9. A reload offer nobody answers leaves the status green over a stale panel.** `put()` goes
  stale only once `ask` resolves (`reload.ts:85-94`), and a toast that times out stays pending
  (`c:\dev\knowledge\vscode-extension-internals.md`, *A notification's promise waits for a
  person*). The tests model a dismissal as an immediate `undefined` (`reload.test.ts:99-106`), so
  none leaves a toast pending. **Fix:** stale when the offer goes up, respecting `keepStatus`, and
  cleared when the reload is taken; companion.md's "Dismissed" line changes with it.
- [ ] **M10. The wrong-major message omits the second step.** stability.md's *A major version*
  promises the wrapper and the companion each say "`npm i -g rigline@latest`, then `rigline
  vscode-setup`"; the wrapper says only the first.
- [ ] **M11. The companion's README and messages.** Its install step is `code --install-extension
  rigline.vsix` from nowhere; make it `rigline vscode-setup`, which also passes `--do-not-sync` and
  covers every profile. Its *Settings* list lacks `rigline.enginePath` and *Rigline: Show Plugins*.
  The no-Node message (`node.ts:70-75`) should end "then reload the window", since settings are read
  at activation. Its "until you run `rigline install`" after a restore (`README.md:18-19`) should
  match the rest: any command that injects puts Rigline back.
- [ ] **M12. The wrapper's README** (`packages/cli/README.md`): its commands leave out `watch`;
  "(a day, by default)" suggests a setting that does not exist; `npm create rigline-plugin` has no
  directory, and fails without one.
- [ ] **M13.** *Optional.* **A stranded companion updates itself.** In the *not in this editor*
  branch (`extension.ts:92-102`), with `enginePath` unset: find Node quietly, read the engine
  already on disk (`readEngineState(engineDir())`, no npm, no network), and if it is ready and of
  this major, `selfUpdate` with `green: false`, logging only. Without it, a later `rigline
  vscode-setup` still reinstalls a stranded companion with `--force`, so leaving it costs a line in
  the notes of the 1.x that supports another editor. Take it only alongside M8 and M9.

### Optional, any 1.x

- [ ] **M14.** The start run calls `run()` directly (`extension.ts:167`), outside the watcher's
  `running` guard (`watch.ts:163-179`), so a Claude Code update at window start overlaps two runs
  and a start that finishes last paints green over *ready*. *Unconfirmed.*
- [ ] **M15.** On Windows, `node.cmd` and a bare `node` are search candidates (`node.ts:34-36`) that
  cannot be spawned without a shell.
- [ ] **M16.** The wrapper's registry resolve honours `npm_config_registry` but not `.npmrc` or a
  proxy, and Node's `fetch` ignores `HTTPS_PROXY`, so behind a corporate proxy neither the wrapper
  nor the companion can move the engine. At least the failure could say so.
- [ ] **M17.** A non-JSON registry reply (a captive portal) is a `SyntaxError` stack trace
  (`packages/cli/src/registry.ts:188`); an offline first run says only "could not reach
  …/@rigline%2Fcore", not that it was installing the engine; a failed resolve could print the
  manual `npm install --prefix …` line.
- [ ] **M18.** The companion always follows `latest`, so `rigline update --tag next` lasts only to
  the next window start.
- [ ] **M19.** The wrapper's `--version` ignores extra arguments (`commands.ts:85`); `update --bogus`
  moves the engine before the engine refuses the flag; the rollback hint in `formatEngineUpdate`
  omits `--ignore-scripts` (D47); the fallback line hardcodes `@latest`.
- [ ] **M20.** D106's leftovers in `packages/cli/src/registry.ts`: `FetchResponse.arrayBuffer` is
  unused, `PluginSpec` is documented as what `add` was asked for, and `tarball` and `integrity` are
  computed and unused.
- [ ] **M21.** The home lock keeps two npm installs apart but not an npm install from a running
  engine, so a terminal `rigline install` during the companion's move can spawn from a directory
  npm is replacing. One failed run that succeeds when rerun; record it rather than fix it.

### The macOS checks

After W1 and W2 have landed and been pulled, all in a scratch `HOME` and `RIGLINE_HOME`:

- [ ] **M22.** `pnpm create rigline-plugin x` and `npm create rigline-plugin x` from packed tarballs
  create the workspace; before W1 both exit 0 having done nothing.
- [ ] **M23.** In that workspace, `pnpm rigline add` then `pnpm rigline dev plugins/x`: an edit
  reaches `webview/rigline/plugins/x/dist/index.js` in a copied extension directory.
- [ ] **M24.** `install` then `restore` into a copy of the Mac's Claude Code directory leaves
  `webview/index.js` and `extension.js` byte-identical to the copy's originals.
- [ ] **M25.** The full `pnpm test` passes on macOS.

### Live reads, with Leo

`rigline.enginePath` skips acquisition (D94), so M2 to M5 are read with it cleared: a companion
built from this checkout, running the released engine it acquires.

- [ ] **M26.** The companion under Homebrew's Node, and under a version manager if one is installed:
  the output shows the engine moving, not `engine update did not happen`.
- [ ] **M27.** VS Code started with `code .` in a scaffolded workspace, then a Claude Code update:
  the workspace's `generated.ts` is untouched.
- [ ] **M28.** A reload offer left to time out shows *reload to apply*; *needs you* after a `restore`
  opens the output when clicked and says why in its tooltip.

## List W: Windows

### Blockers: the documented author path does nothing

- [ ] **W1. `pnpm create rigline-plugin` exits 0 having done nothing**, and so does `npm create` on
  macOS and Linux. The guard at `packages/create-plugin/src/index.ts:230` compares
  `import.meta.url`, which is the realpath, with `resolve(process.argv[1])`, the path the bin shim
  used; pnpm reaches the package through a link and Unix npm through a symlinked `.bin`, so
  `main()` never runs. Reproduced through a junction. **Fix:** a separate bin file that calls
  `main()`, as core's `engine/bin.ts` does, and a tier-4 step running the scaffolder's bin by name
  through pnpm.
- [ ] **W2. `rigline dev` in an author's workspace re-injects the stale copy.** It builds the named
  directories in place, then installs from `discoveryRoots()`
  (`packages/core/src/engine/main.ts:225-228`), which outside this checkout are the home and the
  bundled set; the copy `add` made is never refreshed. **Fix:** `dev` adds each built directory as
  `add` from a path does, then injects, so stopping `dev` leaves the latest build installed.
  authoring.md could say which engine injects: the workspace's `@rigline/core`, while the companion
  re-injects with the machine's at each window start.

### The host and the plugins

- [ ] **W3. An `anchors.json` refinement that is not a valid selector takes down Rigline's UI.**
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
- [ ] **W4. An override that changes only `refine` is reported as "changes nothing"**, which
  anchors.md says means delete it. `anchorOverrideOutcomes` (`overrides.ts:163-172`) compares only
  whether the class resolves, and anchors.md's own worked example is a refine-only repair. **Fix:**
  compare the resolved selectors.
- [ ] **W5. The probe requires eleven identifiers it never uses.** `plugins/probe/rigline.json`
  declares three anchors and eight message types; the code calls `onMessage` for `request` and
  `rename_tab` only, and survives without `transcript` and the `rename_tab` rewrite
  (`src/index.tsx:299-313`). Any of them moving refuses the probe, so Diagnostics vanish just as
  the pill turns red, and `list` says the probe reads the whole conversation. **Fix:**
  `messages: ["request", "rename_tab"]`, and `transcript`, the tap and the rewrite under
  `uses.optional`.
- [ ] **W6. session-id adopts a messaging address from any tool result.** `messagingIdentity`
  (`plugins/session-id/src/index.tsx:116-140`) checks the stringified record contains
  `"tool_result"` and takes the first match anywhere, so a Read or Grep of text holding the phrase
  renames the address — reading this plugin's own tests does it. **Fix:** `ctx.onToolResult`
  filtered to `ListAgents` and `SendMessage`, the regex over `result.content`, and `tools` in place
  of `messages: ["io_message"]` in the manifest. The comment at `:106-114` saying `onToolUse` cannot
  see results is out of date.
- [ ] **W7.** *Optional; unconfirmed.* session-id keeps offering an address after *Reload Claude*,
  which keeps the session id (`currentAddress`, `index.tsx:160-165`), though the plugin says an
  address is per process. Stamp the observation with the envelope's `channelId`.
- [ ] **W8. time-marks says "Today" over yesterday's rows** in a panel open past midnight: the day
  name is fixed when the node is built (`plugins/time-marks/src/index.tsx:124-131`), and the host
  rebuilds only when entries differ. **Fix:** re-register the decorator at local midnight, which
  resets and redraws (`host/src/kernel/transcript.ts:181-184`).

### `restore` and the state Rigline keeps

- [ ] **W9. Per-version isolation is incomplete.** `status` and `check` stop at the first broken
  directory: a truncated `package.json` or a missing `extension.js` is a stack trace, and a
  directory holding only `package.json` stops `status` naming nothing else (`flow.ts:315-324`,
  `main.ts:802-816`). `install` rethrows `EPERM`, `EACCES`, `ENOSPC` and `EROFS`, skipping every
  later version (`flow.ts:410-414`), and `restore`'s payload `rmSync` is outside any `try`
  (`inject.ts:742`). **Fix:** each refuses that version with a sentence and goes on (D104).
- [ ] **W10. A half-deleted directory is reported as "an extension update is probably in progress;
  try again"** (`inject.ts:450`, `flow.ts:661`), which never comes true, since VS Code renames into
  place (D83), so every window start says it needs you. Say what it is. `install --ext` on a path
  that does not exist gets the same line; `restore` on a directory with only `package.json` prints
  the path twice and tells a person to reinstall Claude Code over a directory holding nothing of
  Rigline's, where one missing only `extension.js` gets "nothing of Rigline's was in it".
- [ ] **W11. A `generated.ts` in the working directory.** `readBaseline` takes any `generated.ts`
  where the command runs (`packages/core/src/update/baseline.ts:79-82`), so one that is not
  Rigline's makes `install` throw after injecting, losing the report, with advice that overwrites
  the file. **Fix:** pass over a `generated.ts` without codegen's header line. M6 is the companion's
  half.
- [ ] **W12. An interrupted write destroys what `restore` restores.** A bundle cut short is taken
  as unrelated and becomes the backup; a first backup cut short is a prefix of the live bytes and is
  rolled back over Claude Code's bundle; `restore` then reports success (`inject.ts:197-226`, with
  the writes at `:200`, `:218`, `:224`, `:601`). **Fix:** write to a temporary file and rename. In
  `settleWebviewBackup`, live bytes that are a prefix of `PRE + backup + POST` are our own
  interrupted write, and a backup that is a strict prefix of loader-free live bytes is rewritten
  from them.
- [ ] **W13. A truncated `baseline.json` fails every `install` and `check`** until somebody deletes
  it (`baseline.ts:84-91`), and it is rewritten at every companion window start. **Fix:** write it
  as W12 does, and treat an unreadable one as absent, since it is bookkeeping stability.md does not
  keep. The same write for `config.yaml` and `sources.json` (`plugins/config.ts:120,263,280,283`).
- [ ] **W14.** *Optional.* **A lost `extension.js.orig` leaves the host patch for good**, and
  `restore`, `status` and `doctor` all say vanilla (`inject.ts:176-177`, `:229-231`, `:738`).
  Reverse it from the baked manifests under `webview/rigline/plugins/*/rigline.json`, which carry
  each patch's find and replace. It needs the backup deleted.

### What a user or author reads

- [ ] **W15. The README's manual undo** names `anthropic.claude-code-<version>`; the directory is
  `-<version>-<platform>` (`host.md:9` has it right). And a companion still installed re-injects at
  the next window, since a copy leaves no `restored` mark: say to remove it first.
- [ ] **W16. The README's first install** says *Reload Webviews*; the first install patches
  `extension.js`, and its own report says *Reload Window*. "The first command fetches the engine" is
  the first `rigline` command, not `npm install -g`. The Layout section leaves out `packages/vscode`
  and says core answers "every verb but `update`".
- [ ] **W17. An uninstall section in the README**: `rigline vscode-setup --remove`, `rigline
  restore`, `npm uninstall -g rigline`, then `~/.rigline`. Only CONTRIBUTING has one.
- [ ] **W18. core's README** says "zero third-party runtime dependencies" beside `es-module-lexer`
  and `yaml`, and that `rigline-engine` answers every verb "except `update`". Its description and
  first line call it a Node library, which invites a use stability.md excludes: "the engine".
- [ ] **W19. The manifest schema's `$id`** is `https://rigline.dev/schema/manifest.json`
  (`packages/plugin-api/src/schema.ts:43`, published in `schema/manifest.json`), a domain belonging
  to an unrelated company. Use a github.com/Rigline URL.
- [ ] **W20. plugin-api's README** says an undeclared use "finds nothing there"
  (`packages/plugin-api/README.md:52-54`); it throws and disables the plugin.
- [ ] **W21. Notes only `--verbose` prints**, which authoring.md:131-133 and :436-437 and
  anchors.md:132-135 say plain `install` shows. Either say `--verbose`, or print the certain
  failures ("will throw and disable the plugin", `inject.ts:589`) without it. `dev` prints none.
- [ ] **W22. A Node floor check where the engine starts** (`packages/core/src/engine/bin.ts`), as M4
  is for the wrapper.
- [ ] **W23. stability.md:92 promises exit 1 when something needs you**; `list`, `status`,
  `doctor`, `diff` and bare `layout` always exit 0, and `list` prints unloaded plugins to stderr
  with exit 0. Name the commands the rule covers.
- [ ] **W24. The scaffold's publishing steps** (`packages/create-plugin/template/README.md:83,
  101-104`, `template/.github/workflows/release.yml:7,12-13,126-127`) use `pnpm stage approve` and
  `pnpm publish --otp`, which a security-key account cannot do — the only kind npm enrols now
  (releasing.md). Point at npmjs.com's Staged Packages page, or `npm stage approve <id>`, and
  bootstrap with `npm publish`.
- [ ] **W25. The scaffold's workflows** pin `actions/checkout@v5` and `actions/setup-node@v5`
  (`template/.github/workflows/ci.yml:40,47`, `release.yml:59,85`) against this repo's v7. Its
  README says CI runs the same Node set as the release (`:67-69`); the release runs 26 alone.
- [ ] **W26. create-plugin's README** scaffolds `my-plugins` then adds `plugins/my-plugin`, shows
  `src/index.ts` for a `.tsx`, and credits `tsconfig.base.json` with what `tsconfig.plugin.json`
  does.
- [ ] **W27. "Delete `generated.ts` and everything still compiles"** (authoring.md:366-367, and the
  header codegen writes, `codegen/generate.ts:228`) is false in the scaffold, whose
  `tsconfig.plugin.json` lists it under `files`. The same header says `rigline update` diffs against
  it; `install` does.
- [ ] **W28. The first-party plugins' docs.** The probe's README describes the badge and panel it no
  longer has, and capabilities it does not declare. worktree-prefix's README (`:84-103`) says
  optional declarations throw when present and cites a report that does not exist; its patch `why`
  (`rigline.json:23`, printed by `list` and `doctor`) and `src/index.ts:228-233` name `onToolUse`
  where the code uses `onToolResult`; its description says "first eight characters" of a cut that
  goes by word. time-marks' README (`:49`) names 2.1.270.
- [ ] **W29. Smaller wrong facts.** The engine usage and `doctor` say "RIG badge" (`main.ts:214`,
  `doctor/report.ts:224`), and the usage says to copy the report from it: it is *Diagnostics → Copy
  report* in Rigline's menu. The usage's `build` names only `src/index.ts`. CONTRIBUTING says the
  probe "adds a `RIG` badge" (`:45`) and that there is "no branching model yet" (`:79`), and never
  mentions `rigline.enginePath`, so a contributor with the released companion has this checkout's
  payload replaced at every window start. `restore`'s own last line (`main.ts:886`) says "until you
  run `rigline install`" where any injecting command puts Rigline back. support.md and the README
  never state the VS Code floor, 1.90, which stability.md promises a notice for raising.
  `main.ts:823` mentions a `--logs` flag `doctor` lacks. `CLAUDE.md:191` says "`rigline update` is
  the wrapper's".

### Release scripts

- [ ] **W30. `stageTag` stages below `latest` under `next`.** `scripts/lib/tags.mjs:49` is
  `hasStable && above(next)`, so with a stable line and `next` unset or behind, `stageTag("1.0.2",
  {latest: "1.1.0", next: null, hasStable: true})` gives `next` rather than refusing. **Fix:**
  `hasStable && above(latest) && above(next)`, with tests for `next` null and lagging.
- [ ] **W31. `next` only while a preview line is open.** *Waits on decision 2.* Amend D61, and
  `release:finish` sets `next` only for a prerelease over a stable line, and removes it on a
  promotion.
- [ ] **W32. The runbook and the delivery doc.** `releasing.md:8` leads with `pnpm release
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
- [ ] **W34. The engine's behaviour.** The `remove` usage says a plugin not installed through `add`
  is switched off instead, but it deletes a hand-placed plugin in `~/.rigline/plugins`
  (`manage.ts:298`), which may be somebody's only copy. `update` exits 0 after failing to add the
  companion (`main.ts:438-442`). `install --ext COPY` moves the real `baseline.json` to the copy's
  version and clears the restore mark, and `--ext` is not resolved. `check`, `status` and `doctor`
  never mention the `restored` mark, so a bug report will not show Rigline held out; `restore` with
  nothing installed writes it and says nothing. `status` says "webview unknown, no backup" for a
  version Rigline never touched, and lists oldest first where `install` and `check` list newest.
  Whether `check` exiting 0 over a version not injected counts as "needs you" is a decision.
- [ ] **W35. `layout`'s wording.** "can also go rigRow"; "is not a place" lists places without
  `default` while bare `layout order` suggests `default`, which `order` refuses; an unknown place in
  `config.yaml` is only noted with exit 0, where an unknown key is under *Needs you*, and does not
  suggest a later Rigline.
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

After lists M and W, bar their optional items.

- [ ] **R1.** Decisions 1 to 3 above.
- [ ] **R2. The release text**, which `release.mjs` does not touch and which must be committed
  before it runs, since it refuses a dirty tree: `README.md:26`, "1.0 is under construction"; the
  CHANGELOG preamble, "While the line is `1.0.0-alpha.*`"; `stability.md:7`, "Until 1.0.0 ships".
- [ ] **R3. The 1.0.0 changelog lead.** `## Unreleased` becomes the 1.0.0 section and the GitHub
  release's notes. Before 1.0.0 is cut, a paragraph ahead of its first `###`: the first stable
  release, what stability.md keeps, and the step from an alpha, `npm i -g rigline@latest`.
- [ ] **R4. Facts for Leo's documents.** anthropic-compliance.md says Rigline does not "change what
  the extension sends or receives" and writes `extension.js` "only when a plugin asks"; the bundled
  worktree-prefix rewrites the outbound `rename_tab` title, its host patch widens the session-list
  request, and a default install always asks. It still calls the probe "a diagnostics badge"
  (`:59`, `:97-98`). plugin-policy.md:58-61, read literally, bans the bundled patch. The GitHub
  repository's About section has no description, homepage or topics.
- [ ] **R5.** `1.0.0-alpha.14`, and its reads: M26 to M28, and the Mac's first install through the
  released wrapper under Homebrew's Node.
- [ ] **R6.** `pnpm release major --dry-run`, then, at least a day after alpha.14, `pnpm release
  major`.
