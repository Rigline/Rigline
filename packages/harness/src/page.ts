/**
 * The fixture page: the extension's own webview template as `getHtmlForWebview` builds it
 * (docs/spikes/playwright-harness.md), standing in a fake host for the real extension. It hard-
 * codes no identifier from any bundle, only the boot contract every version relies on (`IS_*`,
 * `#root`, `acquireVsCodeApi`), so the same page serves every corpus version.
 *
 * The fake host is `REPLY_TABLE`, seeded with the boot floor every surface needs
 * (docs/spikes/playwright-harness.md's ten replies) plus `rename_tab`, which this harness's
 * fixtures exercise. `init`'s `state.openNewInTab` is true rather than absent: the app's tab-title
 * effect only calls through to `renameTab()` when that flag is set, so it is what turns "the app
 * naturally renames its tab once a session exists" from a dead branch into something a rewrite test
 * can observe.
 */
import type { Surface } from "@rigline/plugin-api/internal";

export interface FixturePageOptions {
  readonly surface: Surface;
  readonly nonce: string;
  /** Whether the fake host says the app should stamp its own messages. The extension host's own
   * default is on, so this is on unless a test asks for the other half (D135). */
  readonly appTimestamps?: boolean;
  /** The CLI's `timeFormat`, as `init`'s state carries it: "auto", "12-hour", "24-hour",
   * "24-hour-utc", or a strftime pattern. Absent leaves `claudeSettings` out altogether. */
  readonly appTimeFormat?: string;
  /** The models Claude Code offers and what the panel launches on. Absent, it offers none. */
  readonly appModels?: AppModels;
}

/**
 * What the fake host says about models, where the real one says it: the list in its config reply,
 * and the model setting and the CLI's applied effort in `init`'s state, which the panel seeds its
 * session from when it launches.
 */
export interface AppModels {
  readonly list: readonly unknown[];
  readonly setting: string;
  readonly effort: string | null;
}

/**
 * Replies keyed by the outbound request's inner type. A plain table, not a stateful mock: the real
 * host's behaviour is not what is under test, only "does the webview react correctly to this bus
 * traffic" is. See docs/spikes/playwright-harness.md for how each body was found.
 *
 * Out here rather than inside the page's script so a test can check every `type` against the
 * harvested replies layer. The bodies are hand-found and cannot be derived; the types can, and a
 * wrong one is invisible until a plugin taps the message it should have carried.
 */
export const REPLY_TABLE: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  // authStatus must be non-null to pass the app's "is authenticated" gate, and the connection's
  // "config" is fed from this reply's state rather than from get_claude_state's own field.
  init: {
    type: "init_response",
    state: { authStatus: {}, experimentGates: {}, openNewInTab: true },
  },
  get_claude_state: { type: "get_claude_state_response", cached: false, config: {} },
  // Deliberate: this one follows the "_request" to "_response" exception, not the general rule.
  list_sessions_request: { type: "list_sessions_response", sessions: [] },
  list_remote_sessions: { type: "list_remote_sessions_response", sessions: [] },
  get_session_groups: { type: "get_session_groups_response", groups: [] },
  get_collapsed_panel_sections: { type: "get_collapsed_panel_sections_response", sections: [] },
  get_asset_uris: { type: "asset_uris_response", uris: {} },
  get_current_selection: { type: "get_current_selection_response", selection: null },
  webview_focused: { type: "webview_focused_response" },
  get_mcp_servers: { type: "get_mcp_servers_response", mcpServers: [] },
  rename_tab: { type: "rename_tab_response" },
  // The real reply's `applied` is the CLI's applied-settings object, absent where the write
  // returned none; absent here, so the panel re-reads it, and finds none either.
  set_model: { type: "set_model_response" },
  get_applied_settings: { type: "get_applied_settings_response" },
  apply_settings: { type: "apply_settings_response" },
  set_thinking_level: { type: "set_thinking_level_response" },
  // What the host asks for the context meter (D121): 15% of the way to auto-compact.
  get_context_usage: {
    type: "get_context_usage_response",
    usage: {
      totalTokens: 24_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 160_000,
      isAutoCompactEnabled: true,
    },
  },
};

/**
 * `REPLY_TABLE` as a literal for the page's inline script, with the two settings the app's own
 * message stamp reads folded into `init`'s state, which is where the extension host carries them
 * and where the webview feeds its `config` from. `</` is split because the browser ends a
 * `<script>` at the first one, whatever the JavaScript around it means.
 */
function replyTableLiteral(options: FixturePageOptions): string {
  const { appTimeFormat, appModels } = options;
  const init = REPLY_TABLE.init as { readonly state: Record<string, unknown> };
  const state: Record<string, unknown> = {
    ...init.state,
    showMessageTimestamps: options.appTimestamps ?? true,
  };
  // The CLI's own answer, whose `effective` the panel reads without checking it is there.
  const claudeSettings: Record<string, unknown> = {};
  if (appTimeFormat !== undefined) claudeSettings.effective = { timeFormat: appTimeFormat };
  let table: Record<string, unknown> = REPLY_TABLE;
  if (appModels !== undefined) {
    state.modelSetting = appModels.setting;
    // The host's cache of settings.json, which the CLI's own save of an effort leaves behind.
    state.settings = { effortLevel: appModels.effort };
    claudeSettings.effective ??= {};
    claudeSettings.sources = [];
    // The CLI's applied model is a concrete id, which the panel compares with its picker's.
    const entry = appModels.list.find(
      (m) => (m as { readonly value?: unknown } | null)?.value === appModels.setting,
    ) as { readonly resolvedModel?: unknown } | undefined;
    const model =
      typeof entry?.resolvedModel === "string" ? entry.resolvedModel : appModels.setting;
    claudeSettings.applied = { model, effort: appModels.effort };
    table = {
      ...table,
      get_claude_state: {
        type: "get_claude_state_response",
        cached: false,
        config: { models: appModels.list },
      },
    };
  }
  if (Object.keys(claudeSettings).length > 0) state.claudeSettings = claudeSettings;
  table = { ...table, init: { ...REPLY_TABLE.init, state } };
  return JSON.stringify(table).split("</").join("<\\/");
}

const fakeHost = (options: FixturePageOptions): string => `
  const replyTable = ${replyTableLiteral(options)};

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
    const reply = harnessUuid();
    sendFromExtension({
      type: "io_message",
      channelId,
      message: {
        type: "assistant",
        uuid: reply,
        timestamp: now,
        // The API message id every real one carries.
        message: { id: "msg_" + reply, role: "assistant", content: [{ type: "text", text: "hello back" }] },
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
    // One CLI record down the app's channel, as the relay would send it.
    pushRecord(message) {
      if (lastChannelId !== null) sendFromExtension({ type: "io_message", channelId: lastChannelId, message });
    },
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
      const scripted = replyTable[reqType];
      const response = scripted || {};
      if (!scripted) console.warn("[harness host] no scripted reply, sending {} for", reqType, m);
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
${fakeHost(options)}
  </script>

  <script nonce="${nonce}" src="index.js" type="module"></script>
</body>
</html>
`;
}
