# Anchors, and repairing one that has broken

An anchor is a stable name for a piece of the extension's UI: `modelPill`, `footerSpacer`,
`transcriptRow`. A plugin declares the names it needs in its `rigline.json` and reaches for them
through `ctx.anchor()`; Rigline resolves each name against whichever extension version is installed,
at install time, and writes the answers beside the loader.

The extension's classes are CSS-modules output, so every class is `<local>_<hash>` and the hash is
rebuilt on every upstream build. A plugin that named classes itself would need correcting in every
plugin, by every author, every time the extension moved one. The anchor table is the alternative:
one entry per piece of UI, corrected in one place.

That matters because of a cadence. The extension updates about weekly and people take the update
almost at once; npm does not move that fast, and a plugin's author may be asleep, on holiday, or
finished with the plugin. **The anchor table is the only thing in Rigline that can repair a plugin
whose author has not touched it**, and `~/.rigline/anchors.json` is what lets that repair reach you
the day it is found rather than the day it is released.

## When you need one

`rigline check` names the anchor. Two ways one stops resolving, and they are repaired differently.

**The class has gone.** An upstream rename, or the markup was rebuilt. The report says:

    2.1.271: the anchor table does not resolve worktreePill

The repair is a new module-and-local pair. `rigline diff` between the old and new extension
directories usually names the likely successor, because a rename shows up as one local name gone
from a module and one new name arrived in it.

**The class is still there but no longer means one thing.** A class names a look, and the extension
applies a look wherever it wants one; the week a second control starts wearing the pill class, the
name stops being a name. The report says:

    2.1.271: modelPill (3 application sites) name one element each, and this version applies
    their classes in more than one place; the anchor table needs a refinement for each

The repair is a refinement — the rest of a CSS selector, appended to the resolved class — or, where
the extra references are not a second control at all, a `knownSites` acknowledgement. A new pair
cannot fix this one: the class is right there, and it is the identity that has gone.

## The file

`~/.rigline/anchors.json`. It is read by `rigline install`, `check`, `watch`, `dev` and `doctor`,
and merged over the table Rigline ships. `rigline codegen` does not read it, and neither does the
`generated.ts` that `install` rewrites for a repository that keeps one: that file is committed and
read by everyone who clones, and a local repair belongs in none of their checkouts.

```json
{
  "anchors": {
    "modelPill": {
      "refine": "[data-testid=\"model-picker\"]",
      "why": "2.1.271 dropped role=combobox from the picker; the test id is on the picker only"
    },
    "worktreePill": {
      "module": "OOQiHg",
      "local": "worktreeChip",
      "why": "renamed in 2.1.271; the old local name is gone from the same module"
    }
  }
}
```

An entry is merged field by field over the shipped one, so **state only what moved**. Every field an
anchor has may appear:

| field | what it is |
| --- | --- |
| `module` | the six-character CSS-module hash |
| `local` | the local class name inside that module |
| `kind` | `singleton` (exactly one; a second match is a bug), `collection` (many by design), or `style` (a look to borrow) |
| `description` | what the element is and where it renders |
| `refine` | the rest of the selector: `[role="combobox"]`, `:not(…)`, a second class |
| `within` | the name of an ancestor anchor this one sits inside |
| `knownSites` | `{ "count": 2, "why": "…" }`: these application sites were read, and they are one control |
| `surfaces` | any of `editor`, `sidebar`, `sessionList` |
| `when` | the condition under which it renders, if it is not always there |
| `why` | **required.** What this override repairs |

`null` takes a field back out — `"refine": null` is how a refinement that has stopped refining is
undone rather than replaced. The four an anchor cannot be without (`module`, `local`, `kind`,
`description`) cannot be cleared, and an entry naming an anchor the shipped table has not got has to
supply all four, because there is nothing to merge over.

`why` is required because this is the thing that gets pasted into an issue thread and copied by
strangers, and the next person to read it — usually you, six weeks later — needs to know what it
repaired.

### Writing a refinement

Anchor it on something that crosses a serialisation boundary: an ARIA role or state, a `data-`
attribute the app queries itself. Those are contracts the extension is unlikely to break quietly,
and they are not minifier output. Never refine on a second hashed class, which would need resolving
too and would be stale by the next build.

### Finding a pair

`rigline codegen --out scratch.ts` writes every module and every local name the installed extension
has, as types. Searching the extension's own `webview/index.js` for `local:"name_hash"` does the
same thing by hand.

## What the install tells you

Every entry is named, per installed version, with what that version makes of it:

    2.1.271: refreshed
      anchor overrides, from C:\Users\you\.rigline\anchors.json:
        modelPill: repairs an anchor this version does not otherwise resolve
        composer: changes nothing; this version resolves the anchor without it
        agentMap: adds an anchor the table has not got, and it resolves here

`changes nothing` is the line that says an override has done its job and can be deleted: the shipped
table has caught up.

An override that *stops* an anchor resolving is called out under **Needs you**, and so is a file
that will not parse. Neither ever blocks the install: a file that cannot be read is ignored
entirely, a single bad entry is dropped and reported while the rest apply, and the plugins that do
work are injected either way.

`rigline doctor` carries the file's path and the names it changes, because an anchor resolving
differently on your machine than on everybody else's is otherwise invisible in a bug report.

## Afterwards

An override is a local repair, not a fork. Post it — the entry is already the shape a fix takes —
so it can be checked against the extension and moved into the shipped table, and then deleted from
your file. Until it is, `install` will keep telling you it is there.

## Two things it cannot repair

**A raw class pair.** `ctx.cls(module, local)` is the escape hatch for UI nobody has curated, and
nothing in the anchor table reaches it. The install counts them per plugin for exactly this reason:

    session-id: 2 raw class pair(s), which no anchor-table fix can repair

**Anything that is not an anchor.** A message type, an outbound payload field or a host patch that
has moved is the plugin's own dependency and needs the plugin's author.

## Adding a name

An entry naming something the shipped table has not got adds an anchor rather than overriding one.
That is a curation convenience — proving an entry against a live extension before it is proposed —
and not a way to ship a plugin: everyone installing that plugin would need the same file. A plugin
meant for other people uses `ctx.cls()` for uncurated UI, and the name gets curated properly.

A locally added name is not in `AnchorName`, so TypeScript will not know it and the manifest schema
will flag it in your editor. Both are the curated vocabulary being the curated vocabulary; the
install honours the name regardless.
