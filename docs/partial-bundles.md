# Refusing a bundle that is not whole

A slice, not yet built. It closes the failure D81 names but only defends against from the outside:
that Rigline can read an extension directory VS Code is still writing, and record the fragment as
the thing `restore` restores.

The companion waits for the directory to stop moving (D81), which removes the exposure it created
by reacting to `extensions.onDidChange`. That is a guard at one caller. The defect is at the
injector, and two other callers still walk into it.

## The failure

`settleWebviewBackup` in [inject.ts](../packages/core/src/inject/inject.ts) decides what
`webview/index.js.orig` should hold. Its last branch reads: live and backup share no relation, so
the extension was replaced in place, so the live bytes become the new pristine baseline.

That is correct reasoning about a *new version* and exactly wrong about a *half-written* one. A
truncated `index.js` also shares no relation with the previous version's backup, so it takes the
same branch and is written over the only copy of the bytes we could have restored. The same shape
applies to `extension.js.orig` through `hostBackupIsCurrent`.

Three properties make it worse than an ordinary bug.

- **It is silent.** A backup file exists, has plausible bytes, and is the right age. Nothing reports
  a problem, then or later.
- **It destroys the recovery path.** `rigline restore` is the answer to a blank panel and to
  uninstalling Rigline. After this it restores a fragment, and the extension is broken in a way that
  looks like Rigline broke it.
- **The harvest agrees with it.** Identifiers are harvested from the pristine bundle, so a fragment
  produces a harvest that is short rather than wrong — some layers resolve, some do not, and the
  refusals name anchors rather than naming the real cause.

## Who can still hit it

- **The CLI's watcher** (`update/watch.ts`), which polls every thirty seconds. Accidentally safe
  most of the time because the window is small relative to the interval, not because anything checks.
- **A person running `rigline install` or `rigline update`** while VS Code is updating the
  extension. No guard at all; this is the likeliest one in practice, because an update is exactly
  when somebody thinks to re-run it.
- **Any future caller.** The guard being in the companion means the next thing to drive an install
  has to know to add its own.

## What to build

A predicate the injector applies before a bundle may become a backup, and a refusal when it fails.
Whatever it is must be cheap — it runs on a 3.6 MB file on every install — and must not need the
extension to be a version we know about (D1: the harvest adapts to the installed version; a
wholeness check that encoded version knowledge would be a second thing to maintain per release).

Candidates, cheapest first:

- **The declared size.** `package.json` beside the bundle is small and written by the same install.
  If it is absent or unparseable the directory is not finished, which is a useful check on its own
  and costs a stat.
- **A complete tail.** A minified bundle ends in a predictable shape — a closing brace, a
  semicolon, a source-map comment. A file still being written almost never does. Reading the last
  few hundred bytes is one seek.
- **Both bundles present and non-empty**, plus `webview/index.css`, since a partial install
  frequently has some and not others.

The tail check is the one that actually distinguishes truncation, and it is the one that needs
evidence before it is trusted: collect the last bytes of every version in the corpus and see whether
a single rule holds across all of them. If it does not, say so and fall back to the cheaper checks
rather than inventing a rule that fits four versions.

## Where the refusal goes

Not a throw from deep inside `settleWebviewBackup`. The install should refuse *before* it has
written anything, name the version it refused, and say that an extension update is probably in
progress and to try again — which is true, actionable, and the opposite of what happens now.

`restore` must **not** apply the check. It reads a backup and writes it back; if a backup is already
a fragment, refusing to restore leaves the user with no path at all. It is the last resort and
should stay the thing that always runs.

## Verification

Tier 1 covers it entirely, and cheaply: truncate a corpus bundle at several fractions of its length
and assert the predicate refuses each one and accepts the whole file. The corpus already holds four
versions, so the same table runs across all of them and answers the question the tail check needs
answered.

Worth one tier 4 case as well: an install pointed at a directory holding a truncated bundle must
leave `*.orig` untouched. That is the property that actually matters, and it is not the same
assertion as the predicate's.

## What this does not do

It does not make an install atomic. Two processes writing one extension directory is still the
injector's problem and the home lock's (D80); this only stops *reading* a directory somebody else is
mid-way through writing.

It also does not remove D81's settle from the companion. Waiting two seconds is cheaper than
refusing and retrying, and the two answer different halves: the settle avoids the refusal, and the
refusal catches what the settle missed.
