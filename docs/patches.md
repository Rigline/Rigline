# Host patches: changing the other bundle

Almost everything Rigline does happens in the webview. A host patch is the exception: a byte
substitution in `extension.js`, declared by a plugin and applied by the installer. It is a different
kind of change from everything else here — different bundle, different process, different reload,
and no way for the panel to see what happened — so it has its own rules. The reasoning is D25 and
D26 in [decisions.md](decisions.md); the code is `packages/core/src/inject/hostpatch.ts` and
`patchShapeProblem` in `packages/plugin-api/src/manifest.ts`.

## Why the capability exists at all

The extension host has already required `extension.js` before any webview code runs, so nothing
injected into the webview can reach it. Some behaviour lives only there, and not always because
anybody decided it should: the session list's own fetch passes `includeWorktrees:!1` to an
enumeration the extension already implements and already uses elsewhere. No message, no setting and
no DOM anywhere can flip that flag. One byte can.

That is the shape of a justified host patch — a capability the extension already has, switched on —
and it is worth holding a proposal against it. A patch that adds behaviour, rather than reaching
behaviour that is already there, is carrying much more risk for much less.

## What a patch is

```json
{
  "find":    "{dir:this.cwd,includeWorktrees:!1,includeProgrammatic:…}",
  "replace": "{dir:this.cwd,includeWorktrees:!0,includeProgrammatic:…}",
  "why":     "…what it buys, and what is lost without it",
  "required": false
}
```

`patches` is top-level in `rigline.json`, beside `uses` rather than inside it, because it is not a
use of the webview. Everything under `uses` names something the *installed extension's webview* must
still have; this changes a different bundle in a different process.

Four rules are checked when the manifest is read, before anything is applied:

- **`find`, `replace` and `why` are non-empty strings.** `why` is not optional, because the bytes
  cannot say what they buy and the next person to read them is somebody deciding whether to keep
  them.
- **`replace` is the same byte length as `find`.** Everything downstream rests on this: every match
  is located in the pristine bundle *before* any is written, so a substitution that resized the file
  would invalidate every offset after it. It also has a second life — see the backup-currency check
  below.
- **`find !== replace`**, which would patch nothing.
- **`required` is a boolean when present**, defaulting to false.

## How it is applied

`extension.js` is **rebuilt from `extension.js.orig` on every install**, never patched
incrementally. Three properties fall out of that one choice, and each is worth more than it looks:

- `find` always sees the bytes the extension shipped, so a declaration written against the real
  bundle keeps working.
- Applying the same declarations twice produces the same bytes both times, so a reinstall is a no-op
  rather than a second layer.
- Disabling or removing a plugin removes its patch, with nothing to undo.

The pristine bytes are the backup when the backup still belongs to this build, and the live file
otherwise. "Still belongs" is a size comparison, and it is exact precisely because a declared
substitution never resizes the file: a backup of a different length belongs to a build
`extension.js` has since replaced, and reading it would hand a harvest an older build's protocol and
hand a restore a downgrade.

The backup is written the moment the first patch is about to land, not at install time generally —
`extension.js.orig` present therefore means something patched the host bundle, which is why
`hostVerdict` can answer `vanilla` from its absence where the webview side has to answer `unknown`.

The file is written **only when the bytes change**, because a change needs *Developer: Reload
Window*, which ends every Claude session in that window. An install that changes nothing must not
cost anybody a turn.

## When a patch is refused

Three conditions, all reported by plugin name, none of them fatal to the install:

| condition | why it is refused rather than resolved |
| --- | --- |
| `find` matches nowhere | the bundle this was written against has moved |
| `find` matches more than once | the same drift wearing a different face; picking one of several would patch a site nobody reviewed |
| two located ranges overlap | nothing defines how two substitutions of the same bytes compose, and silently preferring one would make the outcome depend on discovery order |

An overlap refuses **both** patches, each naming every plugin it overlaps, so neither author is left
wondering why theirs behaved differently on somebody else's machine.

`required: true` refuses the plugin itself when its patch does not apply. `required: false` — the
better default, and what worktree-prefix uses — loads the plugin without it: the plugin does less,
and says so in its `why`. Deciding between them is deciding whether the plugin is coherent without
the patch.

## Carried, not derived

Nothing in a webview can read `extension.js`. The CSP has no `connect-src`, and the only process
that ever tried to apply the patch is the installer — so the installer is the only thing that can
say whether it landed.

So each outcome is baked into `registry.js` as data, published to `diagnostics.hostPatches`, and
read by the kernel before a plugin is imported: `patchRefusal` is checked first of all, ahead of the
declaration check, because there is no point checking identifiers for a plugin that cannot work
here.

This is the one diagnostic reporting what some *other* process did rather than what this one saw,
and it carries the same caveat every generated table does: it is exactly as current as the payload
beside it.

## Installing a plugin is the yes

A plugin's declared patch applies because the plugin is enabled (D26). Installing a plugin is the
act that says yes and nothing after it asks again — the same bargain VS Code strikes with an
extension, and the same one `rigline add` already makes for the webview half.

The safety net is a backup, not a question. `extension.js.orig` is written before the first patch
lands, every install rebuilds from it, disabling a plugin removes its patch, and `restore` needs
neither VS Code nor a working extension host. That asks nobody to have predicted a problem, which is
the one thing a prompt cannot do.

What the install *does* is name the plugins whose patches it applied. The author's `why` is a
paragraph, it is the same paragraph on every installed version, and `rigline doctor` carries it in
full for the one case — a panel behaving oddly — where somebody wants to read it.

## Writing one

1. **Find the site in a corpus bundle**, not in the live extension directory. Confirm `find` occurs
   exactly once there, and check it in every corpus version you can: a string unique in one build
   and doubled in the next is the ambiguity refusal waiting to happen.
2. **Keep the byte length.** `!1` to `!0` is the archetype. If the change you want cannot be made
   without resizing, it is not a host patch.
3. **Include enough context to be unique, and no more.** A longer `find` is more likely to be broken
   by an unrelated edit nearby; a shorter one is more likely to match twice. Anchor on structure the
   minifier preserves — property names, string literals — rather than on identifiers it invents.
4. **Write the `why` for somebody deciding whether to keep it**: what it buys, what is lost without
   it, and why `required` is set the way it is.
5. **Default to `required: false`** unless the plugin genuinely cannot work without it.
6. **Test it against a copy.** Never point a test at the live extension directory (D39). The
   injector's own tests work over throwaway copies and the corpus, and that is the pattern to
   follow.

## Restoring

`rigline restore` recovers the webview and host bundles **independently**: a missing webview backup
must not strand a host bundle that still has one, and each write is re-read to confirm the bytes
match. The reported `restored` is the webview side, since that is the one whose absence blanks the
panel. Afterwards, *Developer: Reload Window* is always the safe reload.
