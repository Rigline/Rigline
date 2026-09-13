import { booleanShape, type CapabilityContract, switchContract } from "./types.ts";

/** DOM placement, with re-placement and ordering owned by the host. Depends on nothing harvested. */
export const mountContract: CapabilityContract<"mount"> = {
  key: "mount",
  grants: ["mount", "mountAfter", "watch"],
  shape: booleanShape,
  violation: () => null,
  summary: (declared) => (declared ? ["adds elements to the panel"] : []),
};

/** A host-managed stylesheet, removed on teardown. Depends on nothing harvested. */
export const styleContract: CapabilityContract<"style"> = {
  key: "style",
  grants: ["style"],
  shape: booleanShape,
  violation: () => null,
  summary: (declared) => (declared ? ["adds a stylesheet, which can restyle the panel"] : []),
};

/**
 * Tool calls lifted out of the conversation stream. A switch rather than a list of tool names:
 * tool names belong to the CLI and to whoever wrote the tool, so there is nothing to check them
 * against, and a list here would look like a guarantee that does not exist.
 */
export const toolsContract = switchContract({
  key: "tools",
  grants: ["onToolUse"],
  messages: ["io_message"],
  anchors: [],
  summary: "watches the tool calls the assistant makes, including their arguments",
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
 * One entry per transcript row, with the real time of each. Expands over both layers: the two
 * message types that carry times, and the anchor the host finds rows by. A renamed row class
 * would otherwise leave the taps working, the times collected, and nothing on screen.
 */
export const transcriptContract = switchContract({
  key: "transcript",
  grants: ["decorateTranscript"],
  messages: ["get_session_response", "io_message"],
  anchors: ["transcriptRow"],
  summary: "reads every transcript entry's identity and time, and draws on transcript rows",
});
