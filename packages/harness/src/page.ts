/**
 * The fixture page: the extension's own webview template as `getHtmlForWebview` builds it
 * (docs/spikes/playwright-harness.md), standing in a fake host for the real extension. It hard-
 * codes no identifier from any bundle, only the boot contract every version relies on (`IS_*`,
 * `#root`, `acquireVsCodeApi`), so the same page serves every corpus version.
 *
 * The fake host is a reply table keyed by request type, seeded with the boot floor every surface
 * needs (docs/spikes/playwright-harness.md's ten replies) plus `rename_tab`, which this harness's
 * fixtures exercise. `get_claude_state`'s `config.openNewInTab` is set true rather than left `{}`:
 * the app's own tab-title effect only calls through to `renameTab()` when that flag is set, so
 * this is what turns "the app naturally renames its tab once a session exists" from a dead branch
 * into the thing a rewrite test can observe.
 */
import type { Surface } from "@rigline/plugin-api";

export interface FixturePageOptions {
  readonly surface: Surface;
  readonly nonce: string;
}

const FAKE_HOST = `
  // Reply table keyed by the outbound request's inner type. A plain table, not a stateful mock:
  // the real host's behaviour is not what is under test, only "does the webview react correctly
  // to this bus traffic" is. See docs/spikes/playwright-harness.md for how each reply was found.
  const replyTable = {
    // authStatus must be non-null (any object) to pass the app's "is authenticated" gate.
    // openNewInTab: true is what makes the app's tab-title effect actually call renameTab() —
    // the connection's "config" reactive value is fed from this reply's state, not from
    // get_claude_state's own "config" field (which feeds a separate reactive value).
    init: () => ({
      type: "init_response",
      state: { authStatus: {}, experimentGates: {}, openNewInTab: true },
    }),
    get_claude_state: () => ({ type: "get_claude_state_response", cached: false, config: {} }),
    // The naming convention this reply follows (docs/archive/0.x/inventory-tools.md) is the "_request"
    // to "_response" exception, not the general "append _response" rule: the real extension answers
    // list_sessions_request with list_sessions_response, which is also the one confirmed message
    // type any plugin (worktree-prefix) taps for it. A stand-in "list_sessions_request_response" here
    // silenced the app's console warning just as well, since the app itself never reads the reply's
    // own type field, but it meant onMessage("list_sessions_response", ..) could never fire from this
    // boot-time reply — a latent harness-fidelity gap nothing had caught before a plugin needed it.
    list_sessions_request: () => ({ type: "list_sessions_response", sessions: [] }),
    list_remote_sessions: () => ({ type: "list_remote_sessions_response", sessions: [] }),
    get_session_groups: () => ({ type: "get_session_groups_response", groups: [] }),
    get_collapsed_panel_sections: () => ({
      type: "get_collapsed_panel_sections_response",
      sections: [],
    }),
    get_asset_uris: () => ({ type: "get_asset_uris_response", uris: {} }),
    get_current_selection: () => ({ type: "get_current_selection_response", selection: null }),
    webview_focused: () => ({ type: "webview_focused_response" }),
    get_mcp_servers: () => ({ type: "get_mcp_servers_response", mcpServers: [] }),
    rename_tab: () => ({ type: "rename_tab_response" }),
  };

  function sendFromExtension(message) {
    window.postMessage({ type: "from-extension", message }, "*");
  }

  function harnessUuid() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
    );
  }

  // Once launch_claude opens a channel, push one user + one assistant io_message down it so the
  // transcript has something to render (.message_07S1Yg rows). This mimics the CLI relay, not a
  // real request/reply, and is why the transcript test needs no explicit push of its own.
  function pushSyntheticTranscript(channelId) {
    const now = new Date().toISOString();
    sendFromExtension({
      type: "io_message",
      channelId,
      message: {
        type: "user",
        uuid: harnessUuid(),
        timestamp: now,
        message: { role: "user", content: "hello from the harness" },
      },
    });
    sendFromExtension({
      type: "io_message",
      channelId,
      message: {
        type: "assistant",
        uuid: harnessUuid(),
        timestamp: now,
        message: { role: "assistant", content: [{ type: "text", text: "hello back" }] },
      },
    });
  }

  // The channel the app opened, so a test can push down it after boot. Remembered rather than
  // passed around because rerender is called from a fixture plugin, which has no way to know it.
  // No backticks anywhere in this script: it is a template literal, and one would end it here.
  let lastChannelId = null;

  window.__harness = {
    sent: [],
    push: sendFromExtension,
    // Make the app actually re-render, which is the only thing that detaches a host-placed mount in
    // practice and the signal the mount service re-places on (D52). Two more transcript rows is the
    // cheapest commit the real bundle will do on demand; a test that only needs *a* commit should
    // not have to care which message produces one.
    rerender() {
      if (lastChannelId !== null) pushSyntheticTranscript(lastChannelId);
    },
  };

  window.acquireVsCodeApi = function () {
    return {
      postMessage(m) {
        window.__harness.sent.push(m);
        try {
          replyHost(m);
        } catch (e) {
          console.error("[harness host] handler threw", e);
        }
      },
      getState() {
        return undefined;
      },
      setState(s) {
        return s;
      },
    };
  };

  function replyHost(m) {
    if (m.type === "request") {
      const reqType = m.request && m.request.type;
      const make = replyTable[reqType];
      const response = make ? make(m) : {};
      if (!make) console.warn("[harness host] no scripted reply, sending {} for", reqType, m);
      sendFromExtension({ type: "response", requestId: m.requestId, response });
    } else if (m.type === "launch_claude") {
      lastChannelId = m.channelId;
      setTimeout(() => pushSyntheticTranscript(m.channelId), 50);
    }
  }
`;

/** The fixture HTML for one surface, nonce'd to match the CSP's `script-src`. */
export function fixturePage(options: FixturePageOptions): string {
  const { surface, nonce } = options;
  const isSidebar = surface === "sidebar";
  const isSessionListOnly = surface === "sessionList";
  const isFullEditor = surface === "editor";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'nonce-${nonce}'; worker-src 'self' blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="index.css" rel="stylesheet">
</head>
<body>
  <!-- #claude-error:empty sizing matches the extension's own template comment: Playwright's
       waitFor({state:'visible'}) needs both dimensions > 0. -->
  <pre id="claude-error"></pre>
  <div id="root"></div>

  <script nonce="${nonce}">
    window.IS_SIDEBAR = ${isSidebar};
    window.IS_FULL_EDITOR = ${isFullEditor};
    window.IS_SESSION_LIST_ONLY = ${isSessionListOnly};
${FAKE_HOST}
  </script>

  <script nonce="${nonce}" src="index.js" type="module"></script>
</body>
</html>
`;
}
