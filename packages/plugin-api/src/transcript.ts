/**
 * The transcript as a sequence of entries: what each row is, and when it actually happened.
 *
 * Three facts have to be joined to answer "when did this happen", and none of them is where you
 * would first look.
 *
 * The row does not know its own time. Every rendered row carries a `timestamp`, and it is
 * `Date.now()` from the moment the row object was built: the converter that turns a CLI record
 * into a row passes `uuid`, `betaMessageId`, `parentToolUseId` and `origin` through, and not the
 * record's own `timestamp`, so the class default wins every time. Reopening a session rebuilds
 * the whole transcript through that converter, which stamps every row with the moment it was
 * loaded — which is why the app's own prompt-history popup reads "just now" for every entry of a
 * session you have just reopened. Nothing here ever reads that field, not even as a fallback.
 *
 * The real times are on the bus, in two carriers. `get_session_response` is the extension host
 * handing over the transcript it read from disk, as `envelope.messages[]`; `io_message` is one
 * CLI record relayed verbatim, as `envelope.message`. User and assistant records in both carry a
 * `uuid` and an ISO `timestamp`. Those are the only sources here, which is what makes `at ===
 * null` meaningful: it says no record has said when this entry happened, not that a guess was
 * unavailable.
 *
 * The DOM carries no identity: a row's uuid reaches the DOM through no attribute and no id. It is
 * read from React instead, and `rowIdentity` is the shape match that says which fiber is a row —
 * a shape match rather than a component name, because the component is minified and its
 * identifier changes every build.
 */

/** The least of a React fiber this module needs: props, and the parent link. */
export interface FiberLike {
  readonly memoizedProps?: unknown;
  readonly return?: FiberLike | null;
}

/** One transcript row: what it is, and where it sits. */
export interface TranscriptEntry {
  /** The message's uuid, stable across a reload and across the CLI process. */
  readonly id: string;
  readonly role: "user" | "assistant";
  /**
   * When the message happened, in epoch milliseconds, or null when no record has said. Null for a
   * prompt just sent: the row is minted in the webview and the record carrying its time arrives
   * from the CLI a beat later. There is deliberately no "first seen" fallback.
   */
  readonly at: number | null;
  /** Position in the entry list this entry came with, so a decoration can look at its neighbour. */
  readonly index: number;
}

/** One id-and-time pair read off a bus record. */
export interface MessageTime {
  readonly id: string;
  readonly at: number;
}

/** A value that might be an object, without asserting anything about its contents. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The role a row of this record type takes, or null for a row that has no time to show. `meta`,
 * `compact` and `refusal_fallback` rows are minted in the webview with a fresh uuid and exist in
 * no transcript on disk, so no record will ever carry a time for one. Skipping them keeps this
 * union ours rather than a passthrough of the app's row vocabulary, and keeps `at`
 * null-because-not-yet rather than null-because-never.
 */
function roleOf(type: unknown): TranscriptEntry["role"] | null {
  return type === "user" || type === "assistant" ? type : null;
}

/**
 * How far up from a row's host fiber the component holding its props may sit. Small on purpose:
 * the row div is returned directly by the component whose props carry the message, so one or two
 * steps is the real distance and the rest is slack for a wrapper. Walking further would eventually
 * reach an ancestor row's props and silently identify a row as its own parent; a bounded walk
 * turns that into "not a row", which is the safe answer.
 */
const PROP_SEARCH_DEPTH = 4;

/**
 * Which transcript entry a fiber belongs to, or null if it is not a row's.
 *
 * A shape match, never a name match: what is recognised is props carrying a message with a
 * non-empty string uuid and a role we show. `index` is filled in by the caller, which is the only
 * thing here that knows the order.
 */
export function rowIdentity(
  fiber: FiberLike | null | undefined,
): Omit<TranscriptEntry, "at" | "index"> | null {
  let node: FiberLike | null = fiber ?? null;
  for (let step = 0; node !== null && step < PROP_SEARCH_DEPTH; step++) {
    const props = asRecord(node.memoizedProps);
    const message = asRecord(props?.message);
    if (message !== null) {
      const id = message.uuid;
      const role = roleOf(message.type);
      if (role !== null && typeof id === "string" && id.length > 0) {
        return { id, role };
      }
    }
    node = node.return ?? null;
  }
  return null;
}

/**
 * The time carried by one CLI record, or null. Both a string and a number are accepted for
 * `timestamp`; everything observed writes the ISO string the transcript on disk holds, and
 * `Date.parse` of a malformed one is `NaN` rather than a throw, which would otherwise become a
 * plausible-looking time of 1970.
 */
function recordTime(value: unknown): MessageTime | null {
  const record = asRecord(value);
  if (record === null || roleOf(record.type) === null) {
    return null;
  }
  const id = record.uuid;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  const stamp = record.timestamp;
  const at =
    typeof stamp === "number" ? stamp : typeof stamp === "string" ? Date.parse(stamp) : NaN;
  return Number.isFinite(at) ? { id, at } : null;
}

/**
 * Every id-and-time pair one bus message carries. Handles both carriers because a caller wanting
 * one always wants the other: `get_session_response` is the transcript as it was on disk,
 * `io_message` is what has happened since, and an entry list built from either alone is
 * half-timed. Anything else yields nothing rather than being an error — `io_message` in
 * particular travels in both directions and mostly carries streaming events.
 */
export function messageTimes(message: unknown): MessageTime[] {
  const envelope = asRecord(message);
  if (envelope === null) {
    return [];
  }
  if (envelope.type === "get_session_response") {
    const messages = envelope.messages;
    if (!Array.isArray(messages)) {
      return [];
    }
    const times: MessageTime[] = [];
    for (const entry of messages) {
      const time = recordTime(entry);
      if (time !== null) {
        times.push(time);
      }
    }
    return times;
  }
  if (envelope.type === "io_message") {
    const found = recordTime(envelope.message);
    return found ? [found] : [];
  }
  return [];
}

/**
 * Whether two entry lists differ in anything a decoration could be drawn from. The sweep runs
 * after every React commit, and commits fire per streamed token, so the list is rebuilt far more
 * often than it changes; this is what stops a decoration being torn down and rebuilt on every one
 * of them. Order is part of the comparison because rows are keyed by index upstream: the same ids
 * in a different order is a different transcript, and comparing sets would leave every decoration
 * one row out of place.
 */
export function entriesDiffer(
  a: readonly TranscriptEntry[],
  b: readonly TranscriptEntry[],
): boolean {
  if (a.length !== b.length) {
    return true;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) {
      return true;
    }
    if (x.id !== y.id || x.at !== y.at || x.role !== y.role) {
      return true;
    }
  }
  return false;
}
