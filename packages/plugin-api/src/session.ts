/**
 * Which session a panel is hosting, derived from the bus.
 *
 * The one report of this is `update_session_state`, sent by an effect whose whole job is naming
 * the panel's active session: it fires whenever the active session or that session's state
 * changes, and — on a switch — first re-sends the departing id with `isFarewell: true`. That
 * farewell is what makes a switch observable rather than merely eventually-consistent, and it is
 * the reason the three obvious alternatives lose:
 *
 * - `get_session_request` also carries a `sessionId` and also fires on load, but it says a
 *   session was fetched, never that one was left.
 * - `session_states_update` carries an `activeSessionId`, but it is the workspace-wide active
 *   session broadcast to every panel, not this panel's own.
 * - The panel's own `?session=` URL parameter carries the same id and is easy to read, but it is
 *   not an identifier layer a manifest can declare against, so nothing could refuse a plugin when
 *   the extension moved it.
 *
 * `isFarewell` reaches the wire through a spread rather than a literal key, so it is readable at
 * runtime but not mechanically harvestable into the generated identifier tables.
 *
 * The rule below is read off minified code and its one branch is easy to invert: treating a
 * farewell for id X as "clear unless X is current" instead of "clear when X is current" looks
 * like the feature working right up until a second session is open, because with only one session
 * open the two versions agree. `null` deliberately does not distinguish "no session assigned yet"
 * from "the session we had has departed" — nothing downstream needs those told apart, since both
 * mean there is no id to show or join on.
 */

/**
 * The session id a panel is hosting after `message`, given that it was hosting `current`.
 *
 * A farewell for some other session is a report about a panel state we never saw, so it leaves
 * the answer alone; only the farewell for what we are already showing means this panel has
 * stopped hosting it.
 */
export function nextSessionId(current: string | null, message: unknown): string | null {
  if (typeof message !== "object" || message === null) {
    return current;
  }
  const { sessionId, isFarewell } = message as Record<string, unknown>;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return current;
  }
  if (isFarewell) {
    return sessionId === current ? null : current;
  }
  return sessionId;
}
