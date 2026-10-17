import { booleanShape, type CapabilityContract, switchContract } from "./types.ts";

/** DOM placement, with re-placement and ordering owned by the host. Depends on nothing harvested. */
export const mountContract: CapabilityContract<"mount"> = {
  key: "mount",
  grants: ["mount", "mountAfter", "mountBefore", "watch"],
  schema: { type: "boolean", description: "Adds elements to the panel." },
  shape: booleanShape,
  gaps: () => [],
  summary: (declared) => (declared ? ["adds elements to the panel"] : []),
};

/** A host-managed stylesheet, removed on teardown. Depends on nothing harvested. */
export const styleContract: CapabilityContract<"style"> = {
  key: "style",
  grants: ["style"],
  schema: { type: "boolean", description: "Adds a stylesheet, which can restyle the panel." },
  shape: booleanShape,
  gaps: () => [],
  summary: (declared) => (declared ? ["adds a stylesheet, which can restyle the panel"] : []),
};

/** A place in Rigline's own menu, behind the RIG pill. Depends on nothing harvested. */
export const menuContract: CapabilityContract<"menu"> = {
  key: "menu",
  grants: ["menu"],
  schema: { type: "boolean", description: "Adds to Rigline's menu." },
  shape: booleanShape,
  gaps: () => [],
  summary: (declared) => (declared ? ["adds to Rigline's menu"] : []),
};

/** A tab in Rigline's settings screen, which the shell draws. Depends on nothing harvested. */
export const settingsTabContract: CapabilityContract<"settingsTab"> = {
  key: "settingsTab",
  grants: ["settingsTab"],
  schema: { type: "boolean", description: "Adds a tab to Rigline's settings screen." },
  shape: booleanShape,
  gaps: () => [],
  summary: (declared) => (declared ? ["adds a tab to Rigline's settings screen"] : []),
};

/**
 * Tool calls lifted out of the conversation stream. A switch rather than a list of tool names:
 * tool names belong to the CLI and to whoever wrote the tool, so there is nothing to check them
 * against, and a list here would look like a guarantee that does not exist.
 */
export const toolsContract = switchContract({
  key: "tools",
  grants: ["onToolUse", "onToolResult"],
  messages: ["io_message"],
  anchors: [],
  summary:
    "watches the tool calls the assistant makes, including their arguments and whether each worked",
});

/** The panel's session id, derived by the host through the farewell rule. */
export const sessionContract = switchContract({
  key: "session",
  grants: ["onSessionId"],
  messages: ["update_session_state"],
  anchors: [],
  summary: "follows which session the panel is hosting",
});

/**
 * One entry per transcript row, with the real time of each. Expands over three layers: the two
 * message types that carry times, the anchor the host finds rows by, and the react-dom internals it
 * identifies them with. A renamed row class would otherwise leave the taps working, the times
 * collected, and nothing on screen.
 */
export const transcriptContract = switchContract({
  key: "transcript",
  grants: ["decorateTranscript"],
  messages: ["get_session_response", "io_message"],
  anchors: ["transcriptRow"],
  react: true,
  summary: "reads every transcript entry's identity and time, and draws on transcript rows",
});

/** How full the session's context is, derived by the host from the stream and its asks (D121). */
export const contextContract = switchContract({
  key: "context",
  grants: ["onContextUsage"],
  messages: ["io_message"],
  anchors: [],
  summary: "follows how full the session's context is",
});

/**
 * What the session has cost, from each `result`. No auth message: without one, `metered` is null
 * (D129).
 */
export const costContract = switchContract({
  key: "cost",
  grants: ["onSessionCost"],
  messages: ["io_message"],
  anchors: [],
  summary: "follows what the session has cost, as Claude Code estimates it",
});

/** The plan's usage windows, as the extension pushes them to every panel (D129). */
export const limitsContract = switchContract({
  key: "limits",
  grants: ["onUsageLimits"],
  messages: ["panel_usage_update"],
  anchors: [],
  summary: "follows how much of the plan's usage limits is used",
});

/**
 * Which models this install offers and which is live, read off the panel's own session (D120 as
 * amended). The messages are the ones whether a session has chosen is read from: a launch, and the
 * panel's own requests for a model or an effort (D139).
 */
export const modelsContract = switchContract({
  key: "models",
  grants: ["onModelState"],
  messages: ["launch_claude", "set_model", "apply_settings"],
  anchors: [],
  panelSession: true,
  summary: "reads which models this install offers, and which model and effort are live",
});

/**
 * Changing the model and the effort that goes with it, through the panel's own controls (D120 as
 * amended).
 *
 * The summary is the audit surface: the line somebody reads in `rigline list` to know this plugin
 * can change their model, so it says so plainly rather than describing the mechanism.
 */
export const modelChoiceContract = switchContract({
  key: "modelChoice",
  grants: ["applyChoice"],
  messages: [],
  anchors: [],
  panelSession: true,
  summary: "can change which model and effort Claude Code uses, when you click something",
});
