/**
 * The session's identifiers, as elements and in Rigline's menu. The short id is in the composer
 * footer by default; the full id and the messaging address are there to place in `rigRow`, and start
 * off (D90).
 *
 * Where the messaging address comes from, and why it has to be scraped from text rather than read
 * from a declared field, is set out below rather than anywhere else: this file is the authority.
 *
 * **The pill shows the session id, never the messaging address.** The address is unbounded: the CLI
 * names a session after its directory, so a worktree called `abcd-1234-ticket-work-46` produces an
 * address that wide, and a Remote Control session takes its title, which can be a whole sentence.
 * A badge in the composer footer has room for a token. Eight characters of a session id identify a
 * session as well as anything does and are always eight characters, so the pill shows the thing it
 * can rely on; the address lives in the menu, and in `rigRow` for whoever places it there.
 *
 * The address (`atlas-ae [61b4a3]`-shaped: a name plus a hex ref) is what `ListAgents` prints and
 * what `SendMessage`'s `to` takes. It never reaches the webview as a declared field: the CLI writes
 * it to `~/.claude/sessions/<pid>.json`, the extension host's own registry parser drops it before
 * anything downstream sees it, and `ctx.rewrite`/`ctx.resend` can only shape what the app already
 * sends, never originate a request that might answer for it. The one place it survives to the
 * webview is inside the plain text of a `ListAgents`/`SendMessage` tool result, which the host
 * relays verbatim — so that is where this plugin reads it from, for the menu.
 *
 * Because the address is scraped rather than declared, `messagingIdentity` and the regex it runs
 * are this plugin's one piece of "derived from a bundle" risk, and are pinned by src/index.test.ts
 * against the exact wording the CLI uses.
 */
import {
  definePlugin,
  type PluginContext,
  type Store,
  store,
  storeFrom,
  type Teardown,
} from "@rigline/plugin-api";
import { MenuItem, MenuNote, Pill, Submenu, useStore } from "@rigline/plugin-api/ui";
import { type ReactNode, useEffect, useState } from "react";

/** How much of the raw session id the pill shows, and the menu offers as a short form. */
const SHORT_LENGTH = 8;

/** Shown while the panel has no session id at all — a brand-new session has none until Claude
 * assigns one. Distinguishing "mounted, waiting" from "never mounted" this way is most of what a
 * live check of this plugin can ask for, so the dimmed placeholder is deliberate, not a stopgap. */
const PLACEHOLDER = "...";

/** How long a "copied"/"copy failed" flash sits in place of the normal content before reverting. */
const FLASH_MS = 1200;

const NO_ADDRESS = "No messaging address yet - it appears once this session runs ListAgents";
const NO_SESSION = "No session id yet - Claude assigns one when the session starts";

/** One session's messaging address. */
export interface Identity {
  readonly name: string;
  readonly ref: string;
}

/** An address, stamped with the session it was seen for — never with the session id alone. */
export interface Observed {
  readonly sessionId: string | null;
  readonly identity: Identity;
}

/** One row the menu can show: a value to copy, or a note standing in the slot it would occupy. */
export type Entry =
  | { readonly kind: "copyable"; readonly label: string; readonly value: string }
  | { readonly kind: "missing"; readonly message: string };

/**
 * The CLI's own-session sentence, in the two wordings `ListAgents` and `SendMessage` use: `"This
 * session is NAME [REF]"` in the session itself, `"This process's main session is NAME [REF]"` in
 * a subagent, both interpolating the same token. One pattern covers both by making the subagent
 * half an optional non-capturing group.
 *
 * This runs against `JSON.stringify(record)` — one line, with a literal newline in tool output
 * already turned into the two characters `\n` — which is exactly the shape the repo's "bound any
 * regex you run over a stringified record" rule exists for. Three choices make it safe:
 *
 * - The name is captured non-greedily, and never as `\S+`: a name set via `/rename` collapses
 *   whitespace but does not forbid it, so a name may contain a space.
 * - The name's character class excludes `"` and `\`, so a match cannot cross a JSON string
 *   boundary — the delimiters that separate this field from the next one in the same stringified
 *   object, or one `tool_result` content block from another.
 * - The name is additionally capped at 64 characters. The quote/backslash exclusion alone stops a
 *   match crossing into another field, but does nothing to stop it running the full length of one
 *   very long field — a minified line of output, or (the failure this was written to prevent) prose
 *   that merely *describes* "This session is" with no real token following, which let an earlier
 *   unbounded version's capture run on to the next bracketed hex string anywhere in the record and
 *   render everything in between into the badge, growing the composer to the height of the panel.
 *
 * The ref is `[0-9a-f]{6,}`, six *or more*, not exactly six: the own-session token is always six
 * hex characters, but a listing extends a peer's ref past six when two sessions collide on that
 * prefix, and this regex has to read both. It does not need an explicit upper bound of its own —
 * "]" is not a hex digit, so the greedy match already stops at the closing bracket.
 */
const ADDRESS = /This (?:process's main )?session is ([^"\\]{1,64}?) \[([0-9a-f]{6,})\]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The messaging address a bus message carries, or null.
 *
 * Reads `io_message` raw rather than through `ctx.onToolUse`: the tool-use capability reports the
 * assistant's *call* (`{id, name, input}`), and the address is only present in the *result*, which
 * arrives afterward as its own `type: "user"` bus record — the case a raw tap exists to cover, and
 * why the manifest declares `messages: ["io_message"]` rather than `tools: true`.
 *
 * The `.includes("tool_result")` check before the regex ever runs is the spoof guard: a typed chat
 * message is also a `type: "user"` record, so without it, a peer pasting `ListAgents` output into
 * the composer as ordinary text would rename this badge to whatever the pasted text said. The regex
 * only ever runs against a genuine tool result.
 */
export function messagingIdentity(message: unknown): Identity | null {
  if (!isRecord(message) || message.type !== "io_message") {
    return null;
  }
  const record = message.message;
  if (!isRecord(record) || record.type !== "user") {
    return null;
  }
  let json: string;
  try {
    json = JSON.stringify(record);
  } catch {
    // A record that will not serialise (a cyclic object, say) is not one carrying tool output.
    return null;
  }
  if (!json.includes("tool_result")) {
    return null;
  }
  const match = ADDRESS.exec(json);
  if (!match) {
    return null;
  }
  const [, name, ref] = match;
  return name && ref ? { name, ref } : null;
}

/** The display form of an address: `name [ref]`. */
export function formatAddress(identity: Identity): string {
  return `${identity.name} [${identity.ref}]`;
}

/**
 * The address to show right now, or null.
 *
 * An address belongs to a CLI *process*, not to a session: both the name and the ref are re-rolled
 * when the process restarts, while the session id is the one thing that survives, so nothing about
 * an address may ever be looked up by session id alone. Worse, the panel is a session switcher and
 * the webview outlives a switch, so an address observed for a session the panel has since left must
 * stop being offered — silently, since nothing errors when a stale value gets pasted into the wrong
 * agent's conversation. `observed` is therefore held as the (address, session) pair it was seen
 * with, compared against the *current* session on every read rather than cleared on change, so an
 * address that arrives before `ctx.onSessionId` has caught up cannot be attributed to the wrong
 * session either — it simply never matches until the id it was seen with is the id showing.
 */
export function currentAddress(
  observed: Observed | null,
  sessionId: string | null,
): Identity | null {
  return observed !== null && observed.sessionId === sessionId ? observed.identity : null;
}

/**
 * What the badge shows: the short session id, or a placeholder until one exists.
 *
 * Always the session id, never the messaging address, even when an address is known — which is the
 * opposite of what this did first. The address is unbounded in practice: the CLI names a session
 * after its directory, so a worktree called `abcd-1234-ticket-work-46` produces an address of that
 * whole width, and a Remote Control session takes its *title*, which can be a sentence. The badge
 * sits at the end of the composer footer's left cluster and has room for a token, not a phrase —
 * and every character it takes is width the footer's own fit ladder has to find (D54). A session id
 * is fixed-width and its first eight characters identify a session as well as anything does, so the
 * badge shows the thing it can rely on and the menu carries the address, which is where you go when
 * you actually want to copy it.
 */
export function headlineText(sessionId: string | null): string {
  return sessionId === null ? PLACEHOLDER : sessionId.slice(0, SHORT_LENGTH);
}

/**
 * The submenu's rows, in a fixed order: the address first, then the full session id, then its short
 * form. A value that is not yet known becomes a note *in the slot the value would occupy* rather
 * than being omitted, so the address row's position never shifts once real data arrives.
 */
export function buildEntries(address: Identity | null, sessionId: string | null): readonly Entry[] {
  const entries: Entry[] = [
    address !== null
      ? { kind: "copyable", label: "Messaging address", value: formatAddress(address) }
      : { kind: "missing", message: NO_ADDRESS },
  ];
  if (sessionId !== null) {
    entries.push({ kind: "copyable", label: "Session id", value: sessionId });
    entries.push({
      kind: "copyable",
      label: "Short session id",
      value: sessionId.slice(0, SHORT_LENGTH),
    });
  } else {
    entries.push({ kind: "missing", message: NO_SESSION });
  }
  return entries;
}

/**
 * Whether the badge is labelling something yet, which is what its dimming means: full-ish once it
 * names a session, fainter while it is only holding its place. The address does not enter into it,
 * because the address is not what it shows.
 */
export function known(sessionId: string | null): boolean {
  return sessionId !== null;
}

/**
 * The hint appended to the badge's tooltip once there is something to copy.
 *
 * A click copies the session id in full, not the eight characters on screen: the short form is for
 * recognising a session at a glance and the full one is what anything else will ask for, and a copy
 * that silently hands over a truncated identifier is the kind of thing found out later.
 */
export function copyHint(sessionId: string | null): string | null {
  return sessionId === null
    ? null
    : "Click to copy the session id - every identifier is in the RIG menu";
}

/** The badge's tooltip: one line per entry, plus the copy hint once something is known. */
export function buildTooltip(entries: readonly Entry[], sessionId: string | null): string {
  const lines = entries.map((entry) =>
    entry.kind === "copyable" ? `${entry.label}: ${entry.value}` : entry.message,
  );
  const hint = copyHint(sessionId);
  if (hint !== null) lines.push(hint);
  return lines.join("\n");
}

/**
 * Copy `text` with `document.execCommand("copy")` over a detached, invisible textarea, rather than
 * the async Clipboard API. `navigator.clipboard.writeText` needs a permission a webview does not
 * necessarily hold and rejects its promise rather than throwing when denied, which would make a
 * failed copy silent. The execCommand route is deprecated but unconditional: it either does the
 * copy or returns false, never a permission prompt this panel has no chrome to show.
 */
function copyToClipboard(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

/** A "copied" or "copy failed" flash, shown in place of a value for a moment. */
function useFlash(): readonly [string | null, (text: string) => void] {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  return [flash, setFlash];
}

function copy(value: string, flash: (text: string) => void): void {
  flash(copyToClipboard(value) ? "copied" : "copy failed");
}

interface Stores {
  readonly session: Store<string | null>;
  readonly observed: Store<Observed | null>;
}

/** One identifier in the menu: choosing it copies the value and flashes the outcome in its place. */
function CopyRow(props: { readonly label: string; readonly value: string }): ReactNode {
  const { label, value } = props;
  const [flash, setFlash] = useFlash();
  return (
    <MenuItem
      label={label}
      // A 36-character UUID in a narrow panel: monospace, and the menu lets it wrap.
      description={
        <span style={{ fontFamily: "var(--app-monospace-font-family, monospace)" }}>
          {flash ?? value}
        </span>
      }
      title="Click to copy"
      onSelect={(event) => {
        event.preventDefault();
        copy(value, setFlash);
      }}
    />
  );
}

function Identifiers(props: Stores): ReactNode {
  const sessionId = useStore(props.session);
  const address = currentAddress(useStore(props.observed), sessionId);
  return (
    <Submenu label="Session identifiers" description={headlineText(sessionId)}>
      {buildEntries(address, sessionId).map((entry) =>
        entry.kind === "copyable" ? (
          <CopyRow key={entry.label} label={entry.label} value={entry.value} />
        ) : (
          <MenuNote key={entry.message}>{entry.message}</MenuNote>
        ),
      )}
    </Submenu>
  );
}

/**
 * The short id, in the composer footer by default. A click copies the id in full, not the eight
 * characters on screen: anything that asks for an id wants all of it.
 */
function ShortId(props: Stores): ReactNode {
  const sessionId = useStore(props.session);
  const address = currentAddress(useStore(props.observed), sessionId);
  const [flash, setFlash] = useFlash();
  return (
    <Pill
      muted={!known(sessionId)}
      title={buildTooltip(buildEntries(address, sessionId), sessionId)}
      onClick={sessionId === null ? undefined : () => copy(sessionId, setFlash)}
    >
      {flash ?? headlineText(sessionId)}
    </Pill>
  );
}

/** One identifier in full, for `rigRow`: a click copies it. */
function Identifier(props: {
  readonly label: string;
  readonly value: string | null;
  readonly missing: string;
}): ReactNode {
  const { label, value, missing } = props;
  const [flash, setFlash] = useFlash();
  if (value === null) {
    return (
      <Pill muted title={missing}>
        {PLACEHOLDER}
      </Pill>
    );
  }
  return (
    <Pill title={`${label}: ${value}\nClick to copy`} onClick={() => copy(value, setFlash)}>
      {flash ?? value}
    </Pill>
  );
}

function FullId(props: Stores): ReactNode {
  return <Identifier label="Session id" value={useStore(props.session)} missing={NO_SESSION} />;
}

function Address(props: Stores): ReactNode {
  const address = currentAddress(useStore(props.observed), useStore(props.session));
  return (
    <Identifier
      label="Messaging address"
      value={address === null ? null : formatAddress(address)}
      missing={NO_ADDRESS}
    />
  );
}

export default definePlugin({
  setup(ctx: PluginContext): Teardown {
    // Which message actually carries the session id, and why the three tempting alternatives are
    // each wrong, is answered once for the whole host in packages/plugin-api/src/session.ts; this
    // plugin only consumes the answer. Made here, in setup, so the store catches the replay.
    const stores: Stores = {
      session: storeFrom(ctx.onSessionId, null),
      observed: store<Observed | null>(null),
    };

    const stopMessages = ctx.onMessage("io_message", (payload) => {
      const identity = messagingIdentity(payload);
      if (identity !== null) {
        stores.observed.set({ sessionId: stores.session.get(), identity });
      }
    });

    ctx.element("short-id", () => <ShortId {...stores} />);
    ctx.element("full-id", () => <FullId {...stores} />);
    ctx.element("address", () => <Address {...stores} />);
    ctx.menu(() => <Identifiers {...stores} />);

    /**
     * Whether the address scrape has ever found anything.
     *
     * This is the check worth having here, and the session id is not: the id comes from the host,
     * which reports on it under `core`, while the address is this plugin's one piece of
     * derived-from-someone-else's-wording risk — a bounded regex over a stringified tool result, in
     * two CLI phrasings, pinned by this plugin's tests against a form that can change without
     * anything here breaking loudly. A rewording turns the menu's first row into a permanent "no
     * messaging address yet", which is also exactly what an ordinary session that never ran
     * `ListAgents` looks like.
     *
     * So it stays `n/a` in most sessions, and that is the honest answer rather than a defect in the
     * check: it says the scrape has had no opportunity, not that it works.
     */
    ctx.check("messaging address observed", () => {
      const identity = currentAddress(stores.observed.get(), stores.session.get());
      if (identity !== null) return { verdict: "pass", detail: formatAddress(identity) };
      if (stores.observed.get() !== null) {
        return { verdict: "n/a", detail: "one was seen, for a session this panel has left" };
      }
      return { verdict: "n/a", detail: "none yet — it appears once this session runs ListAgents" };
    });

    return stopMessages;
  },
});
