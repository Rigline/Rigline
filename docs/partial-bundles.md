# Refusing a bundle that is not whole

Closes the failure D81 names but only defends against from the outside: that Rigline can read an
extension directory VS Code is still writing, and record the fragment as the thing `restore`
restores.

The companion waits for the directory to stop moving (D81), which removes the exposure it created by
reacting to `extensions.onDidChange`. That guards one caller. The defect is at the injector, which
refuses a directory that is structurally unfinished, and one whose bytes are still moving.

## The failure

`settleWebviewBackup` in [inject.ts](../packages/core/src/inject/inject.ts) decides what
`webview/index.js.orig` should hold. Two of its branches make the live bytes the pristine baseline:
when there is no backup at all, and when live and backup share no relation.

Both are correct reasoning about a *new version* and exactly wrong about a *half-written* one, and
**the no-backup branch is the one that matters**. An update installs a new directory, which by
definition has no backup yet, so racing it takes that path every time; the replaced-in-place branch
needs a reinstall over an existing directory, which is rarer. Either way a fragment is written over
the only copy of the bytes we could have restored, and the same shape applies to `extension.js.orig`
through `hostBackupIsCurrent`.

Three properties make it worse than an ordinary bug.

- **It is silent.** A backup file exists, has plausible bytes, and is the right age. Nothing reports
  a problem, then or later.
- **It destroys the recovery path.** `rigline restore` is the answer to a blank panel and to
  uninstalling Rigline. After this it restores a fragment, and the extension is broken in a way that
  looks like Rigline broke it.
- **The harvest agrees with it.** Identifiers are harvested from the pristine bundle, so a fragment
  produces a harvest that is short rather than wrong — some layers resolve, some do not, and the
  refusals name anchors rather than naming the real cause.

## Who could hit it

- **The CLI's watcher** (`update/watch.ts`), which polls every thirty seconds. Accidentally safe most
  of the time because the window is small relative to the interval, not because anything checked.
- **A person running `rigline install` or `rigline update`** while VS Code is updating the extension
  — the likeliest one in practice, because an update is exactly when somebody thinks to re-run it.
- **Any future caller.** A guard living only in the companion would mean the next thing to drive an
  install has to know to add its own, which is why the check belongs at the injector.

## What was built

`wholenessProblem` in [bundles.ts](../packages/core/src/extension/bundles.ts), asked by `install`
before it reads or writes anything. It refuses a directory where any of `webview/index.js`,
`extension.js`, `webview/index.css` or `package.json` is absent or empty, or where the manifest does
not parse to something with a version — naming which, and saying an update is probably in progress.

That catches the commoner shape by itself. An install part-way through has *some* of its files, and
the two bundles are megabytes that do not appear atomically.

## The content check, evidenced and rejected

Worth recording as a negative result, because it is the obvious next idea and the evidence appears
to support it.

The rule considered was: a bundle must end on a closing brace. The corpus agrees without exception —
four versions, both bundles each, all ending `}` and a newline — and it is one seek, and it is the
only cheap check that speaks to truncation rather than to absence.

**It was dropped on the risk it carries in the other direction.** A build that appended a
`//# sourceMappingURL=` line, which is the commonest tail in all of JavaScript, would make the check
refuse *every* install the day a new extension version shipped. That trades a rare silent bug for a
certain loud outage, on a code path with no way for a user to override it, and absent beats wrong
(P8). The same objection applies to any rule about what the bytes look like: it is a bet on somebody
else's bundler config, renewed weekly, with an outage as the stake.

A test in `bundles.test.ts` feeds `wholenessProblem` a bundle with exactly that tail and asserts it
passes, so the reasoning is enforced rather than remembered.

## The stability half

The gap the structural checks leave: a directory whose files are all present and one of which is
still growing. Structure cannot see it, and content should not try.

**Stability can.** Stat the four files, wait, stat again, and refuse when anything moved — the same
shape the companion uses (D81), and a direct measurement rather than a guess about content. It
cannot refuse a legitimate bundle, whatever a future bundler emits, which is exactly the property
the content check lacked.

**Refuse rather than wait for it.** `wholenessProblem` answers a question and every one of its other
answers is a refusal, so a settle loop here would be the one branch that blocks for twenty seconds
and then succeeds. One sample gap, then the same sentence as every other problem: an update is
probably in progress, try again in a moment. The retry is the caller's — a person's next command, or
the watcher's next poll, both of which already exist.

**The wait is `Atomics.wait`, and the alternative was an async `install`.** Settled with Leo,
2026-09-22. A sleep needs either an `install` that can await — which ripples through `update`,
`check`, `reinject`, the CLI's switch, `watch.ts`, `dev` and the harness — or a synchronous block.
`Atomics.wait` on a `SharedArrayBuffer` is the latter in three lines, and the objection to it is
that blocking a thread is a thing one does not do. That objection is about a process with something
else to do. The engine is spawned per command, does one job and exits; the companion only ever sees
it as a child that took a quarter of a second longer. There is no event loop here to starve.

A quarter of a second, not the companion's two. The companion is sampling a directory it has been
told changed, where the write may not have started; this is sampling one it is about to write into,
where the question is only whether a write is in flight *now* — and a file being streamed onto disk
moves within that window. It is paid by every `install`, `dev` rebuild included, which is the honest
cost and is under a bundler build.

## `install` writes only what is not already right

Settled with Leo, 2026-09-22. The bundle has always been skip-if-identical — `alreadyPatched`
compares bytes and leaves them alone — and everything beside it was rewritten every run: `pre.js`,
`post.js`, `generated.js`, `registry.js`, and `plugins/`, which was deleted whole and copied back.
So a run over four installed versions rewrote four payloads when one had changed, three of them onto
directories that were already exactly right, and one of those was under a live webview.

**The check is the content, not a record of it.** A stamp of the inputs — engine version, each
plugin's version and hash, `config.json`, `anchors.json` — would also skip the harvest, and was
rejected for where it puts the risk: it has to enumerate every input that affects the output, now
and for as long as the file exists, and the day one is missed `install` does nothing and says it
succeeded. That is the failure this milestone exists to remove, reintroduced by an optimisation.
Comparing what we are about to write against what is there cannot go stale, because there is no
second copy of the truth to drift from.

The harvest still runs, twice per version, and is left alone: it costs CPU in a process spawned for
the purpose, not bytes written underneath a running extension.

**`plugins/` is reconciled rather than replaced.** `rmSync` then copy is the one write that makes an
enabled plugin briefly absent from a directory a live panel is reading, and it happened on every
run. Each enabled plugin's files are now compared and written only where they differ; a file that is
no longer part of a plugin, and a plugin that is no longer enabled, are removed.

**Nothing written is worth saying.** A run that changes nothing logs that it changed nothing, which
is the difference between "we rewrote the payload and it happened to be the same" and "this version
was already current" — and it is what makes a companion's output channel readable weekly.

## Where the refusal goes

Not a throw from deep inside `settleWebviewBackup`. `install` refuses *before* it has read or
written anything, names what is missing, and says an extension update is probably in progress and to
try again — true, actionable, and the opposite of what happened before.

The refusal is that one version's. The flow reports it under *Needs you* and installs every other
version, and the CLI's watcher keeps the listing outstanding until a pass finds the directory
finished (D104).

`restore` deliberately does **not** apply the check. It reads a backup and writes it back; if a backup is already
a fragment, refusing to restore leaves the user with no path at all. It is the last resort and
should stay the thing that always runs.

## Verification

Tier 1, in `bundles.test.ts`: each missing or empty file named, an unparseable manifest, a manifest
with no version, the source-map tail that the rejected content rule would have refused, a file that
grows between the two samples, and that `sleepSync` really blocks.

And in `inject.test.ts`, the property that actually matters, which is not the same assertion as the
predicate's — a predicate can be right while a caller checks it too late: an install pointed at a
directory that is still being written leaves `index.js.orig` untouched.

## What this does not do

It does not make an install atomic. Two engines writing one extension directory is the injection
lock's problem (D105); this only stops *reading* a directory somebody else is mid-way through
writing. The sample cannot tell who that somebody is, which is why the lock exists.

It also does not remove D81's settle from the companion. Waiting two seconds is cheaper than
refusing and retrying, and the two answer different halves: the settle avoids the refusal, and the
refusal catches what the settle missed.
