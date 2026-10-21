# Screenshots and recordings

Every image the docs show, what it has to show, and how to capture it by hand. Claude Code's panel
changes most weeks, so these go stale: redo a capture when it would mislead somebody, not every time
the panel moves a pixel. Filenames never change, so redoing one never means editing a doc, unless
what it shows has changed and its alt text with it.

All of them live in `docs/media/`.

## The list

Width is what the doc displays it at. Capture at **twice** that, so it stays crisp on a high-density
screen.

| File | Shown in | What it shows | Width |
| --- | --- | --- | --- |
| `hero.webp` | README, `packages/cli/README.md` | The panel with both rows; edit in place; the cost dragged to a new row, the address into the bar; Save | 800 |
| `composer.png` | README | The composer with the starting layout's two rows | 800 |
| `layout-edit.webp` | `docs/layout.md` | A longer edit: the right of a row, *New row*, the bar, the tray, a row handle, Save | 800 |
| `settings.png` | `docs/config.md` | The settings screen on Rigline's tab | 800 |
| `presets.png` | `docs/presets.md` | The edit bar's *Presets* list open | 800 |
| `scaffold.png` | `docs/authoring.md` | The scaffolded plugin's badge in the composer footer | 600 |
| `context-meter.png` | `plugins/context-meter/README.md` | The percentage and bar | 600 |
| `usage-meter.png` | `plugins/usage-meter/README.md` | Cost and both limits, the five-hour tooltip open | 600 |
| `model-favourites.png` | `plugins/model-favourites/README.md` | The favourites pill with one favourite live | 600 |
| `time-marks.png` | `plugins/time-marks/README.md` | Times on tool-call rows and a *later* divider | 600 |
| `worktree.png` | `plugins/worktree/README.md` | Session tabs prefixed with their worktrees | 600 |
| `session-id.png` | `plugins/session-id/README.md` | The pill, and *Session identifiers* open in the menu | 600 |
| `diagnostics.png` | `plugins/probe/README.md` | *Diagnostics* open, every check passing | 600 |
| `social-preview.png` | GitHub's repository settings only | A still of the panel at 1280×640 | — |

Each doc's `alt` text says exactly what its image shows. If a capture shows something different,
change the alt text with it.

## Tools

- **Stills:** Windows' Snipping Tool (Win+Shift+S), whose delay option keeps a hover tooltip or an
  open menu in the frame; on macOS, Cmd+Shift+4, or Cmd+Shift+5 for a delay.
- **Recordings:** anything that records a region of the screen to MP4 with the pointer showing.
  ScreenToGif on Windows lets you trim and delete frames before exporting; Cmd+Shift+5 on macOS
  records a region.
- **[ffmpeg](https://ffmpeg.org/download.html)**, to turn a recording into animated WebP.

## Formats

The two recordings are **animated WebP**: an image, so it autoplays and loops wherever an image
renders, GitHub and npm included, in full colour and far smaller than a GIF. GIF has 256 colours,
which bands VS Code's dark greys and the meters' colours, so it is the fallback below and nothing
more. Video is wrong for these two: GitHub shows an uploaded MP4 as a player that may not autoplay,
and npm does not render video at all.

How far that is verified: GitHub autoplaying an animated WebP comes from one project's report, the
[shrinkerr v0.3.7 release notes](https://newreleases.io/project/github/I-IAL9000/shrinkerr/release/v0.3.7),
which also report GitHub stripping `autoplay` from a README's video tag; not yet checked here. GIF's
cost against video is from
[OpenReplay](https://blog.openreplay.com/replace-gifs-with-mp4/). So the first time `hero.webp`
lands, look at it on GitHub (step 4 of *Afterwards*) before announcing anything.

`packages/cli/README.md` uses absolute `https://github.com/Rigline/Rigline/raw/main/docs/media/...`
URLs, because npm's handling of a relative image path is undocumented: it appears to rewrite one
against the package's `repository`
([tsdocs#9](https://github.com/pastelsky/tsdocs/issues/9), observed behaviour, no spec found). That
page therefore shows an image once it is on `main`, and its npm page once a release has gone out.

## Set the stage

Do this once, then take the shots in the order below, since some of them change the layout and the
last ones need a session that has been running a while.

1. **Run the Rigline you are documenting.** Normally the release: the status bar reads *Rigline*,
   not *Rigline (dev)*, and `rigline --version` names the engine you mean. CONTRIBUTING.md's *The
   checkout or the release* says how to switch.
2. **Keep your own layout, and start from Rigline's:**

       rigline layout export before-shoot
       rigline layout reset

3. **Set favourites and a default**, so the pills have something to show. In *Settings…* behind the
   `RIG` pill, on the *Model favourites* tab, add Opus 5.5 at xhigh, Opus 5.5 at low and Sonnet 5.5
   at medium, and on Rigline's tab set the default model to Opus 5.5 at xhigh. Save. If the models
   on offer have moved on since this was written, use the current ones and change the alt text in
   `plugins/model-favourites/README.md`.
4. **Open this repository in VS Code**, the main checkout and not a worktree, with the default *Dark
   Modern* theme. Close every other editor tab, so nothing personal is in the tab strip.
5. **Make the panel the right size.** Open Claude Code in an editor tab. Make it wide enough that
   each of Rigline's rows fits on one line, and no wider: about half of a laptop's screen. On a
   display at 100% scaling, set VS Code's zoom to make up for it (`window.zoomLevel` at 3 or 4) so
   that the crops below come out at twice their width in the table. On a 200% or Retina display,
   leave the zoom alone.
6. **Start a session in a worktree.** In a new Claude Code session, ask Claude to enter a worktree
   named `RIG-101-launch-docs`. That makes `.claude/worktrees/RIG-101-launch-docs`, and the tab
   reads `RIG-101 › ...`. Then give it a few small tasks that use tools: read a file, grep for
   something, run `pnpm lint`. That gives the transcript rows with times, the context meter a
   reading and the usage meter a cost.

Everything on screen is your own: your session's cost, your plan's limits, the session id. None of
it is secret, but if you would rather not show something, crop it out rather than editing it.

## The shots

### composer.png

Crop the composer box from its top border to the bottom of Rigline's second row, across the full
width of the panel. Nothing open, nothing hovered.

### context-meter.png

Crop Rigline's second row from its left edge to just past the bar. The colour is whatever the
session's context makes it: green, early in a session, is fine.

### usage-meter.png

Hover the five-hour pill until its tooltip shows, then take a delayed snip of the right side of
the second row with the tooltip in it.

### model-favourites.png

Choose Opus 5.5 at xhigh in Claude Code's own model picker, so that favourite is lit. Crop the
first row from its left edge to just past the favourites pill.

### session-id.png

Open the menu behind the `RIG` pill, then *Session identifiers*. Take a delayed snip of the menu and
the session-id pill below it.

### diagnostics.png

Open *Diagnostics* from the menu behind the `RIG` pill and snip it whole. Every line should pass: if
one does not, that is a bug to look at before this is a picture.

### settings.png

Open *Settings…* from the menu behind the `RIG` pill, on Rigline's tab, and snip the screen with its
rail of tabs.

### presets.png

Give yourself a preset of your own first, so the list shows both kinds:

    rigline layout export mine

Then in the panel, *Reload* from the `RIG` menu's *Layout* so the new preset is listed. Start
editing with the move icon at the right of the first row, open *Presets* in the bar, and take a
delayed snip of the bar with the list open and the rows below it. Press *Done*.

### hero.webp

Rehearse it twice before recording. Move the pointer slowly, and pause for half a second before and
after every drop, so somebody watching can follow it. Aim for 12 to 15 seconds.

1. Start recording a region covering the last few transcript rows and the whole composer, with room
   above it for the edit bar.
2. Hold for two seconds on the panel as it is.
3. Click the move icon at the right of the first row. The handles and the bar appear.
4. Drag *Session cost*, on the right of the second row, onto *New row*.
5. Drag *Messaging address*, in the first row, onto the bar.
6. Click *Save*. Hold until *Saved.* has gone and the handles with it, then two seconds more.
7. Stop recording, and trim any dead frames at either end.

Convert it, from where the recording landed:

    ffmpeg -i hero.mp4 -vf "fps=15,scale=1600:-1:flags=lanczos" -c:v libwebp_anim -q:v 75 -loop 0 -an docs/media/hero.webp

`libwebp_anim` stores only what changes between frames, which suits a panel where little moves; if
your ffmpeg lacks it (`ffmpeg -hide_banner -encoders` lists what it has), use `libwebp`. Keep the
result under about 5 MB, for the page's sake: lower `fps` to 12, then `-q:v` to 60, before cutting
the width.

Then put the layout back for the shots after it:

    rigline layout reset

### layout-edit.webp

The same way as the hero, at 20 to 30 seconds, showing everything the panel can do:

1. Hold on the panel. Click the move icon.
2. Drag *Session id*, in the first row, to the right of the first row.
3. Drag *Context bar*, in the second row, onto *New row*.
4. Drag *Messaging address* onto the bar. It appears in the tray.
5. Drag it back out of the tray into the second row.
6. Drag the third row's handle, at its end, above the second.
7. Click a handle, so its moves show as a menu, hold a second, and press Escape to close the menu.
8. Click *Save*, and hold until editing ends.

Convert as for the hero, to `docs/media/layout-edit.webp`, and `rigline layout reset` after.

### time-marks.png

This one needs a pause in the conversation. Leave the session for more than ten minutes, then ask
for one more small task that uses a tool. Scroll the transcript until the divider reading
*... later* is on screen with a few timed rows above and below it, and crop those rows.
A session resumed on a later day works too, with *Yesterday* or a weekday as the divider.

### worktree.png

Start two more sessions, each in an editor tab of its own, asking Claude to enter worktrees named
`RIG-205-anchor-repair` and `presets-gallery`. Give each a prompt so it has a title. Crop VS Code's
tab strip across the three tabs: two read with ticket keys, `RIG-101 › ...` and `RIG-205 › ...`,
and the third with its name cut at a word, `presets › ...`.

### scaffold.png

This one installs a plugin into your live panel, so do it last.

    cd <somewhere outside this repository>
    pnpm create rigline-plugin my-plugin
    cd my-plugin
    pnpm install
    pnpm codegen
    pnpm build
    pnpm rigline add plugins/my-plugin

*Developer: Reload Webviews*, then give a session three small tasks that each use one tool, so the
badge reads *3 tool calls*. Crop the composer footer from the badge to the `RIG` pill.

Then take it out again, and put back the release's engine, since `add` injected with the
workspace's own:

    rigline remove my-plugin
    rigline install

### social-preview.png

A still of the panel cropped to 2:1, at 1280×640: the transcript's last rows and the composer with
both rows, centred, from the same session as `composer.png`. GitHub takes a PNG, JPG or GIF under
1 MB, and recommends 1280×640
([GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)).
Upload it from the repository's *Settings*, under *Social preview*. It is kept in `docs/media/` so
the next person can start from it, and no doc shows it.

## Afterwards

1. **Put things back:**

       rigline layout apply before-shoot
       git worktree remove .claude/worktrees/RIG-101-launch-docs
       git worktree remove .claude/worktrees/RIG-205-anchor-repair
       git worktree remove .claude/worktrees/presets-gallery

   and your own favourites and default in *Settings…*, if you had others.
2. **Check every file** is in `docs/media/` under the name in the list, and at twice its width.
3. **Make the stills smaller** if you have [oxipng](https://github.com/shssoichiro/oxipng):
   `oxipng -o 4 --strip safe docs/media/*.png`. It changes no pixel.
4. **Look at them on GitHub** before announcing anything: push a branch other than `main` and open
   the README there. If `hero.webp` does not move, make GIFs instead, and change `.webp` to `.gif`
   in the README and `packages/cli/README.md`:

       ffmpeg -i hero.mp4 -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 docs/media/hero.gif
