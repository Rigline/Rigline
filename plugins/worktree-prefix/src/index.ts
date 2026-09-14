/**
 * Prefixes a session's native VS Code tab label with the worktree it belongs to: a ticket key
 * (e.g. `TD-1234`) when the worktree directory's name starts with one, and as much of the name as
 * fits in eight characters, cut at a word boundary, otherwise.
 *
 * **Why a rewrite, and not DOM.** A session's tab is a real VS Code editor tab, entirely outside
 * the webview's DOM. `WebviewPanel.title` is assigned in exactly one place in the extension host —
 * its `rename_tab` handler — and the host never re-derives it from its own state, so intercepting
 * that one outbound message is not merely *a* route to the label, it is the only one there is.
 *
 * **Why the rewrite reapplies on every send, not once.** The app's own `rename_tab` sender is a
 * reactive effect with no dependency list, so it re-fires — resending an *unchanged* title —
 * whenever the panel's visibility toggles or a permission request comes and goes. A prefix applied
 * only the first time would be silently overwritten by the very next one of those. The same
 * behaviour is what makes this plugin's own boot race harmless: if a `rename_tab` crosses the bus
 * before `setup()` has registered the rewrite, it goes out bare once, and the next resend (never
 * far away) carries the prefix.
 *
 * **Two independent detection sources, and why neither subsumes the other.** `list_sessions_response`
 * reports where a session *began*: it covers a session already relocated into a worktree before
 * this panel connected, which no tool call in this panel's lifetime could ever observe.
 * `ctx.onToolResult` reports where a session *moves to*, and whether it got there: it covers a
 * relocation made during the current conversation, which triggers no list refetch at all (the app refetches the list on
 * connection, an archive change, a config-home move, activating a session it does not already
 * hold, and opening the session picker — a session changing its own cwd is none of those). The
 * host patch below changes what a fetch *contains*; it does nothing to make one happen sooner.
 *
 * **Why `list_sessions_response` entries are keyed by `entry.id`, not `entry.sessionId`.** The two
 * session-carrying messages on this bus disagree about which field name carries the session
 * identifier, and reading the wrong one does not throw — it silently finds nothing, which reads as
 * "this session is never in a worktree" instead of as a bug.
 *
 * **The `null` vs `undefined` split on the observed worktree is load-bearing.** `undefined` means
 * nothing has been observed this session, so the list decides. `null` is a *positive* answer — an
 * observed `ExitWorktree` — and must override a list entry that still claims the session is in a
 * worktree; reading a farewell as "clear unless something else is true" instead of "clear, full
 * stop" is the kind of inversion that looks like a passing feature until a stale entry is in play.
 *
 * **What this plugin fundamentally cannot see.** The extension's own worktree detection is one
 * regex over a session's cwd, matching only a `.claude/worktrees/<name>` suffix. A worktree made
 * anywhere else (`git worktree add ../foo`) reports `worktree: undefined` from the extension
 * itself — the information never reaches the webview at all — and no amount of cleverness here
 * recovers it. `EnterWorktree`'s `{path}` form is read the same way for the same reason: the path
 * may sit outside that convention, so only its last segment is usable as a label.
 */
import { definePlugin, type Payload } from "@rigline/plugin-api";

/**
 * Separates the marker from the app's own title, e.g. `"TD-1234 - Refactor the bus"`.
 *
 * The 0.x archive's OCR pass rendered this constant as `": "`, but the same archive's *un-OCR'd*
 * test file expects `" - "` in every single assertion. The test file is clean TypeScript, not a
 * scanned screenshot, so it is authoritative here: `": "` is read as the OCR error, not the test.
 */
const SEPARATOR = " - ";

/** How much of a non-ticket worktree name to show. A budget, not a hard cut — see `worktreeLabel`. */
const SHORT_LENGTH = 8;

/**
 * A ticket key at the *start* of a worktree directory's name: a letter, one to nine more letters or
 * digits, a hyphen, one to six digits, and then anything that is not alphanumeric, or the end.
 *
 * The bounds are the real ones rather than tidy ones. Jira allows a project key of two to ten
 * characters and issue numbers run past five digits in any long-lived project; Linear's team keys
 * and Shortcut's `sc-1234` both sit inside the same shape. Requiring a *letter* first is what makes
 * that width safe: it is the rule that stops `2026-09-14-spike` reading as ticket `2026-09`, which
 * an alphanumeric-first pattern of the same width would happily do. The trailing
 * `(?![A-Za-z0-9])` stops `TD-1234x` being read as `TD-1234`.
 *
 * Anchored at the start because it describes how a name *begins*, not a key found anywhere inside
 * it: a worktree called `revert-ABC-123` is not that ticket's worktree.
 *
 * Two other conventions were considered and are deliberately not matched. `AB#1234` (Azure DevOps)
 * and a bare leading issue number (`1234-fix-the-thing`, GitHub flow) are both real, but `#` is
 * vanishingly rare in a directory name, and a leading bare number cannot be told apart from a date
 * or a version without guessing — and guessing a ticket number wrong is the failure this whole
 * function exists to avoid.
 */
const TICKET = /^([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})(?![A-Za-z0-9])/;

/** Where a name's own word boundaries are: the separators a directory name is built from. */
const SEPARATORS = /[-_. ]/;

/**
 * The label for a worktree: its ticket key when it starts with one, whole, however long; otherwise
 * as much of the name as fits in `SHORT_LENGTH`, cut at a word boundary.
 *
 * The boundary is not cosmetic, and it is the half of this that was wrong. A blind
 * `slice(0, 8)` turns `ABCD-1234` into `ABCD-123` — not a shortened name but a *different,
 * perfectly plausible ticket number*, printed onto a real VS Code tab with no way for a reader to
 * tell. That is exactly what P8 means by absent beating wrong, and widening the pattern above does
 * not fix it, because there is always a name just outside whatever the bounds are. Cutting at a
 * separator instead yields `ABCD`, which nobody will read as a ticket.
 *
 * Falling back to a hard cut when there is no separator in budget is safe for the same reason: a
 * single unbroken word has no hyphen-then-digits shape to be mistaken for.
 */
export function worktreeLabel(name: string): string {
  const ticket = TICKET.exec(name)?.[1];
  if (ticket !== undefined) return ticket;
  if (name.length <= SHORT_LENGTH) return name;

  const budget = name.slice(0, SHORT_LENGTH);
  for (let i = budget.length - 1; i > 0; i--) {
    if (SEPARATORS.test(budget[i] as string)) return budget.slice(0, i);
  }
  return budget;
}

/** The last non-empty segment of a Windows or POSIX path, ignoring trailing separators. */
export function lastSegment(path: string): string {
  const segments = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

/** The half of a tool call this plugin reads, shared by `ToolUse` and `ToolResult`. */
export interface ToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * The worktree a tool call says a session just moved to or from.
 *
 * `null` for `ExitWorktree` (a positive "left the worktree" answer), `undefined` for anything
 * that says nothing about a worktree at all, and otherwise the label `EnterWorktree` supplies:
 * its `name` input verbatim when given (a new worktree), or the last segment of its `path` input
 * (an existing one, which may sit outside `.claude/worktrees/`) when `name` is absent. Tool names
 * are matched, never checked — they belong to the CLI and to whoever wrote the tool, not to this
 * extension, so a rename upstream is allowed to silently stop the prefix appearing rather than
 * throw.
 */
export function worktreeFromTool(tool: ToolCall): string | null | undefined {
  if (tool.name === "ExitWorktree") return null;
  if (tool.name !== "EnterWorktree") return undefined;
  const name = tool.input.name;
  if (typeof name === "string" && name.length > 0) return name;
  const path = tool.input.path;
  if (typeof path === "string" && path.length > 0) return lastSegment(path);
  return undefined;
}

/** `path`, case-folded, with every separator normalised to `/` and trailing separators stripped. */
function normalizePath(path: string): string {
  return path
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

/**
 * Whether `a` and `b` name the same directory, ignoring separator style, a trailing separator and
 * case. A real transcript was observed to record `c:\dev\ai\prototype` and `C:\dev\ai\prototype` for the
 * *same* workspace root — `defaultCwd` comes through `realpathSync`, which preserves whatever case
 * it was handed — so a plain `===` here systematically fails to recognise the root as matching
 * itself. The accepted cost is a false positive on a case-sensitive filesystem that happens to
 * hold two directories differing only in case; on Windows that gate never fires, and the extension
 * makes the same allowance in its own path matching.
 */
export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** A value read off the bus, narrowed to a plain object without asserting its shape further. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One entry of `list_sessions_response.sessions[]`, keyed by `entry.id`. */
interface WorktreeEntry {
  readonly name: string;
  readonly path: string | null;
}

export default definePlugin({
  setup(ctx) {
    // The panel's own session, from the farewell rule `ctx.onSessionId` already applies. Reset
    // below whenever it changes, because `observedWorktree` is scoped to a live conversation: a
    // tool-call observation made in a session this panel has since left over must not leak its
    // answer into whichever session the panel hosts next (a farewell before a fresh EnterWorktree
    // would otherwise show a stale prefix on someone else's tab).
    let sessionId: string | null = null;

    // The session list's own account of where a session began, keyed by `entry.id` — deliberately
    // not `entry.sessionId`, which belongs to a different message and would silently find nothing
    // here. Replaced wholesale on every `list_sessions_response`, which is a full snapshot rather
    // than an answer to one question.
    const worktrees = new Map<string, WorktreeEntry>();

    // The workspace root, from whichever of `update_state`/`init_response` happens to carry it.
    // `null` means "not known yet", not "no prefix": both messages spread this value in rather than
    // spelling it as a literal key, so it cannot be declared as a harvested field, and a rename
    // upstream of either message would otherwise leave this permanently null. Treating an unknown
    // root as "gate open" would make that failure invisible; treating it as "gate closed" (this
    // plugin's choice) costs at most one redundant prefix on the one tab that is already the
    // worktree, which self-corrects the moment either message arrives.
    let defaultCwd: string | null = null;

    // undefined: nothing observed this session, defer to the list. null: an observed exit, a
    // positive answer that must override a list entry still claiming a worktree. A string: the
    // worktree last observed via a tool call, which outranks the list either way because it
    // reflects what actually happened rather than a possibly-stale fetch.
    let observedWorktree: string | undefined | null;

    function readDefaultCwd(payload: Payload): void {
      const cwd = asRecord(payload.state)?.defaultCwd;
      if (typeof cwd === "string" && cwd.length > 0) defaultCwd = cwd;
    }
    ctx.onMessage("update_state", readDefaultCwd);
    ctx.onMessage("init_response", readDefaultCwd);

    // Declared under `uses.optional` (D41), alone among this plugin's taps. It is the one
    // dependency with a working fallback: losing the list costs the session that was already in a
    // worktree before this panel connected, while every move made during the conversation still
    // arrives through `ctx.onToolUse`. Everything else here is load-bearing — without the rewrite
    // there is no feature, and without the session id the list cannot be read at all — so refusing
    // the plugin by name is the right answer for those and the wrong one for this.
    ctx.onMessage("list_sessions_response", (payload) => {
      const sessions = payload.sessions;
      if (!Array.isArray(sessions)) return;
      worktrees.clear();
      for (const raw of sessions) {
        const entry = asRecord(raw);
        const id = entry?.id;
        const worktree = asRecord(entry?.worktree);
        const name = worktree?.name;
        if (typeof id !== "string" || typeof name !== "string") continue;
        const path = worktree?.path;
        worktrees.set(id, { name, path: typeof path === "string" ? path : null });
      }
    });

    ctx.onSessionId((id) => {
      if (id !== sessionId) observedWorktree = undefined;
      sessionId = id;
    });

    // The *result*, not the call (D51). `ctx.onToolUse` reports what the assistant asked for, and a
    // worktree move the user declined — or one that failed because the branch was already checked
    // out somewhere — arrives there looking exactly like one that worked. Acting on it renames a
    // real VS Code tab after a move that never happened, and nothing on screen says so. A failed
    // result is dropped rather than treated as an exit: the session did not go anywhere, so the
    // answer this plugin already held is still the right one.
    ctx.onToolResult((result) => {
      if (!result.ok) return;
      const next = worktreeFromTool(result);
      // undefined: a tool call this plugin has no opinion about. Leaving observedWorktree alone
      // (rather than setting it to undefined) is what lets "nothing observed yet, defer to the
      // list" and "observed and it said nothing new" both read the same way.
      if (next === undefined || next === observedWorktree) return;
      observedWorktree = next;
      // Entering or leaving a worktree does not itself make the app resend rename_tab, so without
      // this the new prefix would only appear whenever the app happened to rename the tab next —
      // in practice, by hand. Only done here: a worktree arriving via the session list at boot is
      // always followed by the app's own next rename_tab soon enough that the bare label is a
      // flicker, not a wait.
      ctx.resend("rename_tab");
    });

    /** The marker to prepend, or null for no prefix. Recomputed fresh on every rename. */
    function prefix(): string | null {
      if (observedWorktree !== undefined) {
        if (observedWorktree === null) return null;
        // No path is available from a tool call's {name} form, so the same "window itself is the
        // worktree" suppression the list path applies by full path falls back to comparing the
        // workspace root's own directory name against the observed worktree name.
        if (defaultCwd !== null && samePath(lastSegment(defaultCwd), observedWorktree)) return null;
        return worktreeLabel(observedWorktree);
      }
      const entry = sessionId !== null ? worktrees.get(sessionId) : undefined;
      if (!entry) return null;
      if (defaultCwd !== null && entry.path !== null && samePath(entry.path, defaultCwd))
        return null;
      return worktreeLabel(entry.name);
    }

    ctx.rewrite("rename_tab", (payload) => {
      const label = prefix();
      const title = payload.title;
      if (label === null || typeof title !== "string") return null;
      const marker = `${label}${SEPARATOR}`;
      // The app holds the clean title and never sees this plugin's own output, so this cannot
      // double up today. The guard is defensive against a future where something upstream echoes a
      // previously-rewritten title back through the pipe — the difference between a feature and a
      // bug the day that stops being true.
      return title.startsWith(marker) ? null : { title: marker + title };
    });
  },
});
