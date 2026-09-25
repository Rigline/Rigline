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
