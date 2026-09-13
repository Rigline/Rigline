# Spike: booting the real webview bundle headlessly for Playwright

Time-boxed spike for the phase 2 acceptance line in [plan.md](../plan.md): can
`webview/index.js` from the installed extension be booted outside VS Code, well enough that
host and plugin DOM tests could run against it in CI. Scratch work is under
`.local/spike/` (gitignored); this document is the record.

**Answer: yes.** The 2.1.270 bundle boots cleanly in a plain page under a fake
`acquireVsCodeApi` and a small scripted host, reaches a real composer and a real transcript
row, with zero console errors or warnings once the reply table is right. The harness is cheap:
one static HTML page, ~10 scripted replies, under 100 lines of JS.

## What was tried

1. Read `getHtmlForWebview` in `extension.js` (anchored on the unique string `IS_SIDEBAR`,
   since the function name itself appears twice for unrelated reasons) to get the exact HTML
   template, CSP, and the three `window.IS_*` globals VS Code sets before loading the bundle.
   Worth noting: the extension's own template already carries a comment referencing Playwright
   (`#claude-error:empty` sizing, "Playwright's waitFor({state:'visible'}) needs both
   dimensions > 0") — the app's own team already drives it headlessly for something, which is
   independent confirmation this is viable.
2. Wrote a static page (`.local/spike/index.html`) reproducing that template: `#root`, the
   three globals, an inline script defining `window.acquireVsCodeApi` before the module script
   runs, and `<script type="module" src="index.js">`. A CSP meta tag close to the real one
   (`default-src 'none'`, nonce'd `script-src`, no `connect-src`) is included, loosened only on
   origin (`'self'` instead of `$.cspSource`, since there's no vscode-webview: origin outside
   the real webview) and `font-src`/`img-src` widened to `data:` for the bundle's embedded
   icon font and base64 images.
3. Wrote a trivial static server (`.local/spike/server.mjs`, `node:http`, no dependencies)
   serving that page plus `index.js` and `index.css` read directly from
   `C:\dev\kb\vscode-claude-code-versions\2.1.270\webview\` — no copying the 5 MB/400 KB
   bundle into the repo tree.
4. Drove it with the Playwright MCP tools (`browser_navigate`, `browser_console_messages`,
   `browser_evaluate`). First load: the module evaluated with no uncaught error, and the app
   posted `{type:"request", request:{type:"init"}}` immediately, then blocked — `getClaudeState`
   never fires until `init` resolves, and nothing after that until `getClaudeState` resolves.
   With no host answering, `#root` stayed empty (the app's own JS had thrown nothing; it was
   just parked awaiting a `response` message that never came).
5. Added a fake host: a `message`-driven reply table keyed by the outbound request's inner
   `type`, replying `{type:"from-extension", message:{type:"response", requestId, response}}`.
   Iterated by reading each crash/warning off the console and grepping the bundle for the
   field it dereferenced, rather than trying to fully reverse-engineer every message up front:
   - `init` answered `{}` for `state` rendered a plausible-looking page — the **login screen**
     ("How do you want to log in?"), because `state.authStatus` was `undefined` and the app's
     gate (`BX0` in the bundle: `if ($.authStatus !== null) return true`) needs any non-null
     value, object or not.
   - Setting `state.authStatus = {}` passed the gate and rendered the main composer, but two
     uncaught `TypeError`s followed immediately: `Cannot read properties of undefined (reading
     'fable5_launch_show')` and the same for `'tengu_lantern_sconce'`. Both are experiment-gate
     reads of the shape `$.config.value?.experimentGates.fable5_launch_show` — the `?.` only
     guards `.value`, not `.experimentGates`, so any `state` without an `experimentGates` object
     throws the moment a component reads a flag. Adding `state.experimentGates = {}` (not
     `get_claude_state`'s `config` — that's a *different* reactive value, fed by a different
     request) cleared both.
   - With `init` answering a `state` carrying `authStatus` and `experimentGates`, the app moved
     on to `get_claude_state`, `webview_focused`, `get_current_selection`, `get_asset_uris`,
     `list_sessions_request`, `get_session_groups` (x2), `get_collapsed_panel_sections` (x2) —
     replying `{}` (or a type-tagged empty array/object matching the field the console warning
     named) to each silenced every remaining warning, and the app proceeded to create a session
     and send a bare `launch_claude` (fire-and-forget, no reply expected).
   - `launch_claude` opened a channel keyed by a fresh `channelId`. Pushing one synthetic
     `io_message` push (not a response — an unprompted `from-extension` message) with a
     `type:"user"` record, then one with `type:"assistant"`, both shaped per
     `packages/plugin-api/src/transcript.ts`'s `recordTime` (`uuid`, ISO `timestamp`, `message`),
     rendered both as `.message_07S1Yg` rows in the transcript.
   - One more request appeared once a session existed: `get_mcp_servers`. Replying `{}` left an
     `console.error` ("no server list in the response") because the bundle reads `mcpServers`,
     not `servers`; renaming the field to `mcpServers: []` cleared it.
6. End state: `document.getElementsByClassName("modelPill_gGYT1w").length === 1`,
   `document.getElementsByClassName("message_07S1Yg").length === 2`, **zero console errors or
   warnings**, composer and input footer fully rendered.

Wall clock: well under the 90-minute box — the anchors in the task prompt (the HTML template,
the `init`/`get_claude_state` call sites) meant almost no blind exploration was needed; the
rest was reading one console message at a time and grepping the bundle for the field it named.

## The minimal host replies (as JSON)

In the order the app asks for them:

```json
{ "requestType": "init",
  "response": { "type": "init_response", "state": { "authStatus": {}, "experimentGates": {} } } }

{ "requestType": "get_claude_state",
  "response": { "type": "get_claude_state_response", "cached": false, "config": {} } }

{ "requestType": "webview_focused",
  "response": { "type": "webview_focused_response" } }

{ "requestType": "get_current_selection",
  "response": { "type": "get_current_selection_response", "selection": null } }

{ "requestType": "get_asset_uris",
  "response": { "type": "get_asset_uris_response", "uris": {} } }

{ "requestType": "list_sessions_request",
  "response": { "type": "list_sessions_request_response", "sessions": [] } }

{ "requestType": "list_remote_sessions",
  "response": { "type": "list_remote_sessions_response", "sessions": [] } }

{ "requestType": "get_session_groups",
  "response": { "type": "get_session_groups_response", "groups": [] } }

{ "requestType": "get_collapsed_panel_sections",
  "response": { "type": "get_collapsed_panel_sections_response", "sections": [] } }

{ "requestType": "get_mcp_servers",
  "response": { "type": "get_mcp_servers_response", "mcpServers": [] } }
```

Plus one push, not a reply — sent unprompted after `launch_claude`, on the channel it opened:

```json
{ "type": "io_message", "channelId": "<from launch_claude>",
  "message": { "type": "user", "uuid": "<uuid>", "timestamp": "<ISO>",
               "message": { "role": "user", "content": "hello from the spike" } } }

{ "type": "io_message", "channelId": "<from launch_claude>",
  "message": { "type": "assistant", "uuid": "<uuid>", "timestamp": "<ISO>",
               "message": { "role": "assistant", "content": [{ "type": "text", "text": "hello back" }] } } }
```

Three traps worth naming explicitly, since they are the places the empty-object default
(`{}`) is *not* good enough or where two things that look interchangeable are not:

- The app holds two config-like values fed by different requests: `get_claude_state`'s response
  feeds one, and `init`'s `state` feeds the `config` that gates such as `openNewInTab` read. A
  flag that "does not work" is usually being set on the wrong one.

- `authStatus` must be **non-null**, but its shape doesn't matter (`BX0` in the bundle checks
  only `!== null`). `undefined` fails the same as `null` would, because the app's own fallback
  (`this.authStatus.value===void 0 → null`) collapses "no answer" to the same null.
- `experimentGates` must be **present as an object** (not merely non-throwing on its parent),
  because every flag read is `state.experimentGates.<flag>` with the optional-chain placed one
  level too high (`state?.experimentGates.<flag>`) to protect the flag lookup itself. This is
  presumably true of other `state` sub-objects gated the same way; none surfaced in this spike
  only because this session never opened the surfaces that read them (settings, MCP panel
  details, etc.) before the goal state was reached.

## What rendered and what did not

- **Rendered, fully and correctly**: the login screen (before `authStatus`), then the full
  editor composer — header, message input, model-pill row, add/menu buttons — plus two
  transcript rows once the synthetic `io_message`s landed. Visually and structurally
  indistinguishable from a real session in the shapes this spike touched.
- **Not exercised**: the sidebar and session-list-only surfaces (`IS_SIDEBAR` /
  `IS_SESSION_LIST_ONLY`), real streaming (partial/`stream_event` records, tool-use blocks,
  permission-request dialogs), the settings and MCP-server panels, and anything gated by a
  request type this run never triggered (111 distinct outbound request types exist per
  `plan.md`'s harvest; this run touched about a dozen). No reason to expect these are harder in
  kind — the same "empty object, read the console, fix the field" loop applies — but each is
  unverified.

## Console errors seen along the way (all resolved)

| symptom | cause | fix |
| --- | --- | --- |
| `#root` stays empty, no error | app awaiting `init` response that never comes | reply to `init` |
| Renders the **login** screen instead of the composer | `state.authStatus` undefined | any non-null `authStatus` |
| `TypeError: … reading 'fable5_launch_show'` / `'tengu_lantern_sconce'` | `state.experimentGates` undefined, read without a guard on the inner property | `state.experimentGates = {}` |
| `console.warn` "no reply scripted for request type …" (x8, one per still-unanswered request) | reply table incomplete | add each request type, `{}` is enough for all of these |
| `console.error` "Failed to refresh MCP server command rows: no server list in the response" | replied `{ servers: [] }`; bundle reads `.mcpServers` | rename the field |
| CSP violation loading a `data:font/ttf;…` icon font | this spike's own CSP had `font-src 'self'` only, unlike the extension's real `font-src ${cspSource}` (which does admit inline data via the webview's own origin) | add `data:` to `font-src` |

Nothing here was a dead end — every symptom traced to one specific field in one specific reply,
found by grepping the bundle for the property name in the error or warning.

## Recommended shape of a test harness

A **fixture page plus a scripted fake host**, not a recorded-bus replay:

- **Fixture page**: exactly `.local/spike/index.html`'s shape — the real HTML template
  (root div, three globals, CSP, nonce'd script tags), served by a tiny `node:http` static
  server that reads `index.js`/`index.css` straight from the installed extension directory
  (or, for CI, from the pinned corpus snapshot) rather than copying multi-MB files into the
  repo. This is a fixture worth committing (outside `packages/` and `plugins/`, per a
  dedicated test-fixtures location) since it is version-independent — it hard-codes no
  identifier, only the boot contract (`IS_*`, `#root`, `acquireVsCodeApi`).
- **Fake host as a reply table**: a map from request `type` to a response-builder function,
  seeded with the ten entries above as the "boot floor" every test needs, extended per-test
  with whatever additional requests that test's surface triggers. Keep it a plain table rather
  than a stateful mock of the real extension host — the real host's behaviour is not what is
  under test; only "does the webview react correctly to this bus traffic" is.
- **Per-test pushes**: `io_message` (and other inbound pushes: `session_states_update`,
  `update_state`, etc.) as explicit, readable JSON literals in the test body, shaped per
  `packages/plugin-api/src/transcript.ts`'s derivations where a test cares about transcript
  rows — that module already encodes the exact record shape (`uuid`, ISO `timestamp`, `role`)
  the DOM will key off, and its existing Vitest suite is the shape reference, not a new one.
  A recorded-bus replay was considered and rejected for this tier: it would need a live VS Code
  session to record from, couples every test to whatever that recording happened to contain,
  and hides which fields a test actually depends on — the explicit reply table makes that
  legible and is what a future extension-version diff should react against.
- **Prototype's own pieces on top**: once this fixture exists, `pre.js` and `post.js` (or a built
  plugin) load into the page the same way the real injector's two lines would — a static import
  before the module script, a dynamic import after — so host and plugin DOM tests are "navigate
  to the fixture, wait for the goal-state selector, assert" against the same Playwright surface
  used here.

## Cost of a follow-up

Turning this spike into a committed harness is small: promote `.local/spike/index.html` and
`server.mjs` into a real fixture (a `fixtures/webview-harness/` or similar, outside
`packages/`/`plugins/`), wire the reply table into a small TypeScript helper so tests can
extend it per-test rather than editing one shared file, and add a Playwright dependency and
config to the workspace (none exists yet — this spike ran under the Playwright MCP tools, not
a project-local install). Call it half a day: most of the request/response shapes for the
paths a phase-2 test would touch (mount, style, transcript, probe) are already known from this
spike or from the anchor/message tables `codegen` already harvests: the reply table for a new
message can very likely be generated at the same anchoring points as `generated.ts` reads,
which was not verified here (out of scope for a 90-minute spike) but is the obvious next
optimization. No blocker was found; nothing in the four Physics facts is violated by this
approach — the fixture doesn't need `connect-src`, doesn't call `acquireVsCodeApi` more than
once, and never touches `extension.js`.

## The exact page HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'nonce-spike123'; worker-src 'self' blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="index.css" rel="stylesheet">
</head>
<body>
  <pre id="claude-error"></pre>
  <div id="root"></div>

  <script nonce="spike123">
    window.IS_SIDEBAR = false;
    window.IS_FULL_EDITOR = true;
    window.IS_SESSION_LIST_ONLY = false;

    window.__prototypeSpike = { sent: [] };

    window.acquireVsCodeApi = function () {
      return {
        postMessage(m) {
          window.__prototypeSpike.sent.push(m);
          try {
            if (window.__prototypeHost) window.__prototypeHost(m);
          } catch (e) {
            console.error("[spike host] handler threw", e);
          }
        },
        getState() { return undefined; },
        setState(s) { return s; },
      };
    };
  </script>

  <!-- fake-host script goes here, see below -->

  <script nonce="spike123" src="index.js" type="module"></script>
</body>
</html>
```

The static server, for reference — no dependencies, reads the bundle from the corpus in place:

```js
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundleDir = "C:\\dev\\kb\\vscode-claude-code-versions\\2.1.270\\webview";

const routes = {
  "/": { file: path.join(here, "index.html"), type: "text/html" },
  "/index.html": { file: path.join(here, "index.html"), type: "text/html" },
  "/index.js": { file: path.join(bundleDir, "index.js"), type: "application/javascript" },
  "/index.css": { file: path.join(bundleDir, "index.css"), type: "text/css" },
};

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";
  const route = routes[url];
  if (!route) { res.writeHead(404); res.end("not found: " + url); return; }
  fs.readFile(route.file, (err, data) => {
    if (err) { res.writeHead(500); res.end(String(err)); return; }
    res.writeHead(200, { "content-type": route.type });
    res.end(data);
  });
});

server.listen(8934, "127.0.0.1", () => {
  console.log("spike server listening on http://127.0.0.1:8934");
});
```

## The fake-host script that got furthest

```html
<script nonce="spike123">
  // Fake host: reply table keyed by request type. Every reply is the
  // smallest object that let the boot path move forward; see this
  // document for how each entry was derived.
  const replyTable = {
    // authStatus must be non-null (any object) to pass BX0()'s "isAuthenticated" gate.
    init: () => ({ type: "init_response", state: { authStatus: {}, experimentGates: {} } }),
    get_claude_state: () => ({ type: "get_claude_state_response", cached: false, config: {} }),
    list_sessions_request: () => ({ type: "list_sessions_request_response", sessions: [] }),
    list_remote_sessions: () => ({ type: "list_remote_sessions_response", sessions: [] }),
    get_session_groups: () => ({ type: "get_session_groups_response", groups: [] }),
    get_collapsed_panel_sections: () => ({ type: "get_collapsed_panel_sections_response", sections: [] }),
    get_asset_uris: () => ({ type: "get_asset_uris_response", uris: {} }),
    get_current_selection: () => ({ type: "get_current_selection_response", selection: null }),
    webview_focused: () => ({ type: "webview_focused_response" }),
    get_mcp_servers: () => ({ type: "get_mcp_servers_response", mcpServers: [] }),
  };

  function sendFromExtension(message) {
    window.postMessage({ type: "from-extension", message }, "*");
  }

  function uuid() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
    );
  }

  // Once launch_claude opens a channel, push one user + one assistant
  // io_message down it so the transcript has something to render
  // (message_07S1Yg rows). This mimics the CLI relay, not a real request/reply.
  function pushSyntheticTranscript(channelId) {
    const now = new Date().toISOString();
    sendFromExtension({
      type: "io_message",
      channelId,
      message: { type: "user", uuid: uuid(), timestamp: now, message: { role: "user", content: "hello from the spike" } },
    });
    sendFromExtension({
      type: "io_message",
      channelId,
      message: { type: "assistant", uuid: uuid(), timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "hello back" }] } },
    });
  }

  window.__prototypeHost = function (m) {
    window.__prototypeSpike.sent.push({ seen: m });
    if (m.type === "request") {
      const reqType = m.request?.type;
      const make = replyTable[reqType];
      console.log("[spike host] request", reqType, m);
      const response = make ? make(m) : {};
      if (!make) console.warn("[spike host] no scripted reply, sending {} for", reqType, m);
      sendFromExtension({ type: "response", requestId: m.requestId, response });
    } else {
      console.log("[spike host] non-request outbound message", m);
      if (m.type === "launch_claude") {
        setTimeout(() => pushSyntheticTranscript(m.channelId), 50);
      }
    }
  };
</script>
```

## Goal state confirmed

```
document.getElementsByClassName("modelPill_gGYT1w").length === 1
document.getElementsByClassName("message_07S1Yg").length === 2
0 console errors, 0 console warnings
```
