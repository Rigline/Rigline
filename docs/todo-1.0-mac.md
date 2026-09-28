# Before 1.0: the Mac's to-do list

**List M**, for an agent on the Mac: the companion and the wrapper, which is where every
macOS-specific finding lives, then the macOS checks nothing on Windows can do. Read
[todo-1.0.md](todo-1.0.md)'s opening, *Working the lists* and *Decisions that are Leo's* first:
they apply here, and the W and R items this list names are in that file. Only the Mac edits this
file.

## Findings to settle first

- [ ] **M1. Which npm Homebrew's Node has.** Read-only, and it decides M3's scope. Run
  `node -p process.execPath`, `brew ls node | grep npm-cli` and `ls /opt/homebrew/lib/node_modules`
  with Homebrew's `node` first on `PATH`, and note which Node the Mac's own Rigline has been using.

## The companion and the wrapper finding Node and npm

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

## The companion's surface

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

## Optional, any 1.x

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

## The macOS checks

After W1 and W2 have landed and been pulled, all in a scratch `HOME` and `RIGLINE_HOME`:

- [ ] **M22.** `pnpm create rigline-plugin x` and `npm create rigline-plugin x` from packed tarballs
  create the workspace; before W1 both exit 0 having done nothing.
- [ ] **M23.** In that workspace, `pnpm rigline add` then `pnpm rigline dev plugins/x`: an edit
  reaches `webview/rigline/plugins/x/dist/index.js` in a copied extension directory.
- [ ] **M24.** `install` then `restore` into a copy of the Mac's Claude Code directory leaves
  `webview/index.js` and `extension.js` byte-identical to the copy's originals.
- [ ] **M25.** The full `pnpm test` passes on macOS.

## Live reads, with Leo

`rigline.enginePath` skips acquisition (D94), so M2 to M5 are read with it cleared: a companion
built from this checkout, running the released engine it acquires.

- [ ] **M26.** The companion under Homebrew's Node, and under a version manager if one is installed:
  the output shows the engine moving, not `engine update did not happen`.
- [ ] **M27.** VS Code started with `code .` in a scaffolded workspace, then a Claude Code update:
  the workspace's `generated.ts` is untouched.
- [ ] **M28.** A reload offer left to time out shows *reload to apply*; *needs you* after a `restore`
  opens the output when clicked and says why in its tooltip.

## Handed over to Windows

Nothing yet.
