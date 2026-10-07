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
 * what `SendMessage`'s `to` takes. The CLI writes it to `~/.claude/sessions/<pid>.json`, and the
 * extension host's registry parser drops it; `get_status` carries all of it only for a renamed
 * session, too rare to ask for (D120). So this plugin reads it from the plain text of a
 * `ListAgents`/`SendMessage` tool result, which the host relays verbatim, and from no other tool's:
 * a Read or a Grep of text holding the sentence is not this session speaking.
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
  type ToolResult,
} from "@rigline/plugin-api";
import {
  copyText,
  MenuItem,
  MenuNote,
  Pill,
  Submenu,
  useFlash,
  useStore,
} from "@rigline/plugin-api/ui";
import type { ReactNode } from "react";

/** How much of the raw session id the pill shows, and the menu offers as a short form. */
const SHORT_LENGTH = 8;

/** Shown while the panel has no session id at all — a brand-new session has none until Claude
 * assigns one. Distinguishing "mounted, waiting" from "never mounted" this way is most of what a
 * live check of this plugin can ask for, so the dimmed placeholder is deliberate, not a stopgap. */
const PLACEHOLDER = "...";

const NO_ADDRESS = "No messaging address yet - it appears once this session runs ListAgents";
const NO_SESSION = "No session id yet - Claude assigns one when the session starts";

/** One session's messaging address. */
export interface Identity {
  readonly name: string;
  readonly ref: string;
}

/** An address, stamped with the session and the CLI process it was seen for. */
export interface Observed {
  readonly sessionId: string | null;
  /** How many CLI processes the panel had launched when it was seen. */
  readonly launch: number;
  /** Whether the result that stated it said it survives a restart. */
  readonly stable: boolean;
  readonly identity: Identity;
}

/** One row the menu can show: a value to copy, or a note standing in the slot it would occupy. */
export type Entry =
  | { readonly kind: "copyable"; readonly label: string; readonly value: string }
  | { readonly kind: "missing"; readonly message: string };

/**
 * The CLI's own-session sentence, in the two wordings `ListAgents` and `SendMessage` use: `"This
 * session is NAME [REF]"` in the session itself, `"This process's main session is NAME [REF]"` in
 * a subagent, both interpolating the same token.
 *
 * The name is captured non-greedily and never as `\S+`, since a name set via `/rename` may hold a
 * space; it stops at a line end and at 64 characters, so prose that only describes the sentence
 * cannot run on to a later bracket. The ref is six hex characters or more: a listing extends a
 * peer's ref past six when two collide on the prefix.
 */
const ADDRESS = /This (?:process's main )?session is (.{1,64}?) \[([0-9a-f]{6,})\]/;

/**
 * What the CLI appends to the own-session sentence when the address is keyed on the session rather
 * than on its process. Without it, an address is taken to die with the process that stated it.
 */
const STABLE = /normally stay the same when a session restarts/;

/** The tools whose result states this session's address. Any other result is text anybody wrote. */
const ADDRESSING_TOOLS: ReadonlySet<string> = new Set(["ListAgents", "SendMessage"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A result's text: a string as it came, or its text blocks, a line apart so none run together. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

/** The messaging address a `ListAgents` or `SendMessage` result states, or null. */
export function messagingIdentity(result: ToolResult): Identity | null {
  if (!ADDRESSING_TOOLS.has(result.name)) return null;
  const match = ADDRESS.exec(resultText(result.content));
  if (!match) return null;
  const [, name, ref] = match;
  return name && ref ? { name, ref } : null;
}

/** Whether a result that states an address also says it survives the CLI restarting. */
export function survivesRestart(result: ToolResult): boolean {
  return STABLE.test(resultText(result.content));
}

/** The display form of an address: `name [ref]`. */
export function formatAddress(identity: Identity): string {
  return `${identity.name} [${identity.ref}]`;
}

/**
 * The address to show right now, or null.
 *
 * An address dies with the CLI process that stated it — *Reload Claude* starts another under the
 * same session id — unless the result said addresses "stay the same when a session restarts".
 * Either way it belongs to one session: the panel switches sessions, the webview outlives a switch,
 * and a stale address pasted into the wrong conversation fails silently. So `observed` keeps the
 * session and launch it was seen under and is compared with the current ones on every read, never
 * cleared on change: an address that arrives before `ctx.onSessionId` has caught up never matches
 * until the id it was seen with is the id showing.
 */
export function currentAddress(
  observed: Observed | null,
  sessionId: string | null,
  launch: number,
): Identity | null {
  if (observed === null || observed.sessionId !== sessionId) return null;
  return observed.stable || observed.launch === launch ? observed.identity : null;
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

/** Each flash is no wider than the narrowest value it covers, the short id, so no pill grows. */
function copy(value: string, flash: (text: string) => void): void {
  flash(copyText(value) ? "copied" : "failed");
}

interface Stores {
  readonly session: Store<string | null>;
  readonly launches: Store<number>;
  readonly observed: Store<Observed | null>;
}

function useAddress(props: Stores): Identity | null {
  return currentAddress(
    useStore(props.observed),
    useStore(props.session),
    useStore(props.launches),
  );
}

/** One identifier in the menu: choosing it copies the value and flashes the outcome over its label. */
function CopyRow(props: { readonly label: string; readonly value: string }): ReactNode {
  const { label, value } = props;
  const [flash, setFlash] = useFlash();
  return (
    <MenuItem
      label={label}
      // A 36-character UUID in a narrow panel: monospace, and the menu lets it wrap.
      description={
        <span style={{ fontFamily: "var(--app-monospace-font-family, monospace)" }}>{value}</span>
      }
      flash={flash}
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
  const address = useAddress(props);
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
  const address = useAddress(props);
  const [flash, setFlash] = useFlash();
  return (
    <Pill
      muted={!known(sessionId)}
      title={buildTooltip(buildEntries(address, sessionId), sessionId)}
      flash={flash}
      onClick={sessionId === null ? undefined : () => copy(sessionId, setFlash)}
    >
      {headlineText(sessionId)}
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
    <Pill
      title={`${label}: ${value}\nClick to copy`}
      flash={flash}
      onClick={() => copy(value, setFlash)}
    >
      {value}
    </Pill>
  );
}

function FullId(props: Stores): ReactNode {
  return <Identifier label="Session id" value={useStore(props.session)} missing={NO_SESSION} />;
}

function Address(props: Stores): ReactNode {
  const address = useAddress(props);
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
      launches: store(0),
      observed: store<Observed | null>(null),
    };

    // Before the results, so the replayed boot launch is counted ahead of any result it preceded.
    const stopLaunches = ctx.onMessage("launch_claude", () => {
      stores.launches.set(stores.launches.get() + 1);
    });
    const stopResults = ctx.onToolResult((result) => {
      const identity = messagingIdentity(result);
      if (identity !== null) {
        stores.observed.set({
          sessionId: stores.session.get(),
          launch: stores.launches.get(),
          stable: survivesRestart(result),
          identity,
        });
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
     * which reports on it under `rigline`, while the address is this plugin's one piece of
     * derived-from-someone-else's-wording risk — a bounded regex over a stringified tool result, in
     * two CLI phrasings, pinned by this plugin's tests against a form that can change without
     * anything here breaking loudly. A rewording turns the menu's first row into a permanent "no
     * messaging address yet", which is also exactly what an ordinary session that never ran
     * `ListAgents` looks like.
     *
     * So it stays `n/a` in most sessions, and that is the honest answer rather than a defect in the
     * check: it says the scrape has had no opportunity, not that it works.
     *
     * The detail never carries the address, which names the session and is in the menu already:
     * every check's detail goes into the copied report (D53).
     */
    ctx.check("messaging address observed", () => {
      const observed = stores.observed.get();
      const identity = currentAddress(observed, stores.session.get(), stores.launches.get());
      if (identity !== null) {
        const lasts = observed?.stable ? "stable across a restart" : "for this Claude process";
        return { verdict: "pass", detail: `seen, ${lasts}` };
      }
      if (observed !== null) {
        const gone =
          observed.sessionId === stores.session.get()
            ? "a Claude process since restarted"
            : "a session this panel has left";
        return { verdict: "n/a", detail: `one was seen, for ${gone}` };
      }
      return { verdict: "n/a", detail: "none yet — it appears once this session runs ListAgents" };
    });

    return () => {
      stopLaunches();
      stopResults();
    };
  },
});
