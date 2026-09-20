/**
 * The session's short id in the composer footer, and every identifier it has in a pop-up behind it.
 *
 * Where the messaging address comes from, and why it has to be scraped from text rather than read
 * from a declared field, is set out below rather than anywhere else: this file is the authority.
 *
 * **The pill shows the session id, never the messaging address.** The address is unbounded: the CLI
 * names a session after its directory, so a worktree called `abcd-1234-ticket-work-46` produces an
 * address that wide, and a Remote Control session takes its title, which can be a whole sentence.
 * A badge in the composer footer has room for a token. Eight characters of a session id identify a
 * session as well as anything does and are always eight characters, so the pill shows the thing it
 * can rely on; the address lives one click away, in the pop-up, which is where you go when you
 * actually want to copy it.
 *
 * The address (`atlas-ae [61b4a3]`-shaped: a name plus a hex ref) is what `ListAgents` prints and
 * what `SendMessage`'s `to` takes. It never reaches the webview as a declared field: the CLI writes
 * it to `~/.claude/sessions/<pid>.json`, the extension host's own registry parser drops it before
 * anything downstream sees it, and `ctx.rewrite`/`ctx.resend` can only shape what the app already
 * sends, never originate a request that might answer for it. The one place it survives to the
 * webview is inside the plain text of a `ListAgents`/`SendMessage` tool result, which the host
 * relays verbatim — so that is where this plugin reads it from, for the pop-up.
 *
 * Because the address is scraped rather than declared, `messagingIdentity` and the regex it runs
 * are this plugin's one piece of "derived from a bundle" risk, and are pinned by src/index.test.ts
 * against the exact wording the CLI uses.
 */
import {
  type AnchorName,
  definePlugin,
  type PluginContext,
  type Teardown,
} from "@rigline/plugin-api";

/** How much of the raw session id the pill shows, and the pop-up offers as a short form. */
const SHORT_LENGTH = 8;

/** Shown while the panel has no session id at all — a brand-new session has none until Claude
 * assigns one. Distinguishing "mounted, waiting" from "never mounted" this way is most of what a
 * live check of this plugin can ask for, so the dimmed placeholder is deliberate, not a stopgap. */
const PLACEHOLDER = "...";

/** The DOM id of the badge's root element. Rigline's mount ids are prefixed `rigline-`, never a
 * plugin's own name alone, so two plugins mounting at the same anchor cannot collide on id. */
const BADGE_ID = "rigline-session-id";

/** How long a "copied"/"copy failed" flash sits in place of the normal content before reverting. */
const FLASH_MS = 1200;

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

/** One row the pop-up can show: a value to copy, or a note standing in the slot it would occupy. */
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
 * badge shows the thing it can rely on and the pop-up carries the address, which is
 * where you go when you actually want to copy it.
 */
export function headlineText(sessionId: string | null): string {
  return sessionId === null ? PLACEHOLDER : sessionId.slice(0, SHORT_LENGTH);
}

/**
 * The pop-up's rows, in a fixed order: the address first, then the full session id, then its short
 * form. A value that is not yet known becomes a note *in the slot the value would occupy* rather
 * than being omitted, so the address row's position never shifts once real data arrives.
 */
export function buildEntries(address: Identity | null, sessionId: string | null): readonly Entry[] {
  const entries: Entry[] = [
    address !== null
      ? { kind: "copyable", label: "Messaging address", value: formatAddress(address) }
      : {
          kind: "missing",
          message: "No messaging address yet - it appears once this session runs ListAgents",
        },
  ];
  if (sessionId !== null) {
    entries.push({ kind: "copyable", label: "Session id", value: sessionId });
    entries.push({
      kind: "copyable",
      label: "Short session id",
      value: sessionId.slice(0, SHORT_LENGTH),
    });
  } else {
    entries.push({
      kind: "missing",
      message: "No session id yet - Claude assigns one when the session starts",
    });
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
 * The hint appended to the badge's tooltip once there is something to alt-click for.
 *
 * Alt-click copies the session id in full, not the eight characters on screen: the short form is
 * for recognising a session at a glance and the full one is what anything else will ask for, and a
 * copy that silently hands over a truncated identifier is the kind of thing found out later.
 */
export function copyHint(sessionId: string | null): string | null {
  return sessionId === null ? null : "Click for all - Alt-click to copy the session id";
}

/** The badge's tooltip: one line per entry, plus the alt-click hint once something is known. */
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

/** Typography the pop-up resets rather than inherits, and the layout it falls back to when the
 * footer's own pop-up classes are not there to supply it (see the `optional` note below). */
const POPUP_RESET =
  "user-select:none;cursor:default;letter-spacing:normal;" +
  "font-size:var(--vscode-chat-font-size, 13px);font-family:var(--vscode-chat-font-family);";
const POPUP_FALLBACK =
  "position:absolute;bottom:100%;right:0;min-width:200px;max-width:260px;" +
  "background:var(--vscode-menu-background, canvas);color:var(--vscode-menu-foreground, currentColor);" +
  "border:1px solid var(--vscode-menu-border, transparent);border-radius:4px;padding:4px 0;" +
  "box-shadow:0 2px 8px var(--vscode-widget-shadow, transparent);";
/**
 * What a row needs when the borrowed `footerMenuItem` class is not there to supply it: a `<button>`
 * with the browser's own chrome taken off and the app's own row layout approximated.
 *
 * Applied only in that case, never alongside the class. An inline style beats a class on every
 * property it names, so applying this unconditionally would quietly undo most of what borrowing the
 * class was for — including the `:hover` background, which is the affordance that says a row can be
 * clicked. `.menuItem_8RAulQ` in 2.1.270 already carries display, cursor, text-align, background,
 * border, width, padding, font-family and font-size, so where it applies there is nothing left to
 * add.
 */
const ROW_FALLBACK =
  "display:flex;width:100%;box-sizing:border-box;text-align:left;background:none;border:none;" +
  "padding:8px 12px;gap:8px;align-items:flex-start;cursor:pointer;color:inherit;font:inherit;" +
  "font-size:.9em;";

export default definePlugin({
  setup(ctx: PluginContext): Teardown {
    let sessionId: string | null = null;
    let observed: Observed | null = null;

    let badge: HTMLElement | null = null;
    let label: HTMLElement | null = null;
    let badgeFlashTimer: ReturnType<typeof setTimeout> | null = null;

    let popup: HTMLElement | null = null;
    let popupBody: HTMLElement | null = null;

    /**
     * Resolve an optional anchor and, when this extension has it, add its class. Every one of the
     * ten footer-menu classes below is declared under `uses.optional` rather than `uses`: they are
     * borrowed styling for the pop-up, not load-bearing for the badge, so losing one to a future
     * extension update should cost the pop-up some polish, never the plugin (D41). `footerSpacer`
     * is the opposite case and stays required: without it there is nothing to mount against.
     * `POPUP_FALLBACK` and the inline styles below are what keeps the pop-up usable — positioned,
     * legible, clickable — on a version of the extension that has retired the whole family.
     */
    function optionalClass(el: HTMLElement, name: AnchorName): boolean {
      const value = ctx.optional.anchor(name);
      if (value !== null) el.classList.add(value);
      return value !== null;
    }

    function currentIdentity(): Identity | null {
      return currentAddress(observed, sessionId);
    }

    function paint(): void {
      if (!badge || !label) return;
      const address = currentIdentity();
      label.textContent = headlineText(sessionId);
      // On the label, never on the badge. `opacity` applies to a whole subtree, and the pop-up is
      // mounted as the badge's other child, so dimming the badge dims the pop-up with it and the
      // transcript shows through the text. Holding the headline in its own element is the entire
      // reason that element exists; setting this one property on the wrong one of the two undoes it.
      label.style.opacity = known(sessionId) ? "0.65" : "0.35";
      badge.title = buildTooltip(buildEntries(address, sessionId), sessionId);
      if (popupBody) renderRows(popupBody, address, sessionId);
    }

    function flashBadge(text: string): void {
      if (!label) return;
      if (badgeFlashTimer !== null) clearTimeout(badgeFlashTimer);
      label.textContent = text;
      badgeFlashTimer = setTimeout(() => {
        badgeFlashTimer = null;
        paint();
      }, FLASH_MS);
    }

    function buildNote(message: string): HTMLElement {
      const note = document.createElement("div");
      optionalClass(note, "footerMenuHeader");
      const hint = document.createElement("span");
      optionalClass(hint, "footerMenuHeaderHint");
      hint.textContent = message;
      note.appendChild(hint);
      return note;
    }

    function buildRow(entry: Extract<Entry, { kind: "copyable" }>): HTMLElement {
      const button = document.createElement("button");
      button.type = "button";
      const hasRowChrome = optionalClass(button, "footerMenuItem");
      if (!hasRowChrome) button.style.cssText = ROW_FALLBACK;

      const text = document.createElement("span");
      optionalClass(text, "footerMenuItemText");

      const labelEl = document.createElement("span");
      optionalClass(labelEl, "footerMenuItemLabel");
      labelEl.textContent = entry.label;

      // "The longest of these is a 36-character UUID in a 260px panel" - the reason this span
      // gets the app's monospace editor font and permission to wrap anywhere rather than overflow.
      const description = document.createElement("span");
      optionalClass(description, "footerMenuItemDescription");
      description.style.cssText =
        "font-family:var(--vscode-editor-font-family, monospace);overflow-wrap:anywhere;";
      description.textContent = entry.value;

      text.append(labelEl, description);
      button.appendChild(text);

      let rowFlashTimer: ReturnType<typeof setTimeout> | null = null;
      button.addEventListener("click", () => {
        const ok = copyToClipboard(entry.value);
        if (rowFlashTimer !== null) clearTimeout(rowFlashTimer);
        description.textContent = ok ? "copied" : "copy failed";
        rowFlashTimer = setTimeout(() => {
          rowFlashTimer = null;
          description.textContent = entry.value;
        }, FLASH_MS);
      });

      return button;
    }

    function renderRows(
      container: HTMLElement,
      address: Identity | null,
      sid: string | null,
    ): void {
      container.replaceChildren();
      for (const entry of buildEntries(address, sid)) {
        container.appendChild(
          entry.kind === "copyable" ? buildRow(entry) : buildNote(entry.message),
        );
      }
    }

    function onPointerDownOutside(e: PointerEvent): void {
      const target = e.target;
      if (target instanceof Node && (popup?.contains(target) || badge?.contains(target))) return;
      closePopup();
    }

    function onPopupKeydown(e: KeyboardEvent): void {
      if (e.key === "Escape") closePopup();
    }

    /**
     * Unconditional about the listeners, and only then about the node. A mount's `build()` runs
     * again whenever the host re-places it, which can happen with a pop-up open — the old pop-up
     * leaves the document with the badge it was a child of, and `popup` is reassigned, so a version
     * of this that returned early on `!popup` left two document-level listeners behind with nothing
     * left to close.
     */
    function closePopup(): void {
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
      document.removeEventListener("keydown", onPopupKeydown, true);
      if (popup) popup.remove();
      popup = null;
      popupBody = null;
    }

    function openPopup(): void {
      if (!badge || popup) return;
      const div = document.createElement("div");
      const hasChrome = optionalClass(div, "footerMenuPopup");
      optionalClass(div, "footerMenuPopupRight");
      div.style.cssText = POPUP_RESET + (hasChrome ? "" : POPUP_FALLBACK);

      const header = document.createElement("div");
      optionalClass(header, "footerMenuHeader");
      const title = document.createElement("span");
      optionalClass(title, "footerMenuHeaderTitle");
      title.textContent = "Session identifiers";
      const hint = document.createElement("span");
      optionalClass(hint, "footerMenuHeaderHint");
      hint.textContent = "click a row to copy";
      header.append(title, hint);

      const divider = document.createElement("div");
      optionalClass(divider, "footerMenuDivider");

      const body = document.createElement("div");

      div.append(header, divider, body);
      // A child of the badge, not of document.body: torn down for free whenever the badge itself
      // is torn down (an anchor swap, or the plugin's own teardown), with nowhere else to leak.
      badge.appendChild(div);
      popup = div;
      popupBody = body;
      renderRows(body, currentIdentity(), sessionId);

      document.addEventListener("pointerdown", onPointerDownOutside, true);
      document.addEventListener("keydown", onPopupKeydown, true);
    }

    function onBadgeClick(e: MouseEvent): void {
      // Alt/shift-click-only for the direct-copy path, plain click to open: the badge sits beside
      // the model pill, and a control there that opened a menu on modified-click alone would be the
      // odd one out among its neighbours.
      if (e.altKey || e.shiftKey) {
        e.preventDefault();
        // The full session id, not the eight characters on screen: the short form is for
        // recognising a session, and anything that asks for an id wants all of it. Copying what is
        // literally displayed would hand over a truncated identifier that fails somewhere later.
        if (sessionId === null) return;
        const ok = copyToClipboard(sessionId);
        flashBadge(ok ? "copied" : "copy failed");
        return;
      }
      if (popup) closePopup();
      else openPopup();
    }

    function buildBadge(): HTMLElement {
      const span = document.createElement("span");
      span.id = BADGE_ID;
      // No colour of its own: inherits currentColor so the badge reads correctly in every VS Code
      // theme without resolving one. `position:relative` is what the pop-up's `bottom:100%` (or,
      // lacking that class, POPUP_FALLBACK's own `position:absolute;bottom:100%`) measures against.
      span.style.cssText =
        "position:relative;margin-left:6px;font-size:10px;" +
        "font-family:var(--vscode-editor-font-family, monospace);letter-spacing:.02em;" +
        "user-select:text;cursor:pointer;";
      span.addEventListener("click", onBadgeClick);

      // The label is a child of the badge, not the badge's own textContent, so that dimming it
      // with opacity while nothing is known yet does not also dim a pop-up mounted as the badge's
      // other child: opacity applies to a whole subtree, and an earlier version that set it on the
      // badge itself let the transcript show faintly through an open pop-up.
      const lbl = document.createElement("span");
      span.appendChild(lbl);

      // Before the new badge replaces the old one: a pop-up open at the moment the host re-places
      // this mount belongs to a node that is already out of the document, and its listeners are on
      // `document` rather than on that node.
      closePopup();
      badge = span;
      label = lbl;
      paint();
      return span;
    }

    // ctx.watch is the host's shared re-anchor observer: it finds the spacer once, keeps the badge
    // attached to it across an ordinary re-render (ctx.mountBefore's own job), and calls back here
    // again if the spacer *element itself* is ever swapped for a new one. The 0.x prototype ran its
    // own setInterval sync() for exactly that last case, because its mountAfter equivalent had no
    // way to notice an anchor being replaced outright; ctx.watch folds that polling into one shared
    // observer instead of one per plugin, so nothing here polls for anything.
    //
    // **The anchor is the footer's spacer, and not the model pill it sits beside.** The footer
    // measures the widths of its own element children to pick one of three fit stages, and the
    // widest stage moves the pill out of the footer into its own row; a badge anchored to the pill
    // therefore leaves and re-enters the measured container every time the measurement changes its
    // mind, and re-entering re-triggers the measurement. That oscillates at one cycle per frame,
    // and it is why this is not `watch("modelPill")` however much more it would read like one (D54;
    // docs/plan.md, "The composer footer measures its own children"). The spacer renders in every
    // stage, so the width this badge contributes is constant and the ladder settles.
    //
    // mountBefore, not mountAfter: the spacer is `flex-grow:1`, so after it is the right-hand
    // cluster beside the send button, and before it is the end of the left one, where the pill and
    // the selection chip are.
    const stopWatch = ctx.watch("footerSpacer", (spacer) => {
      const stopMount = ctx.mountBefore(spacer, buildBadge);
      return () => {
        stopMount();
        closePopup();
        badge = null;
        label = null;
      };
    });

    // Which message actually carries the session id, and why the three tempting alternatives are
    // each wrong, is answered once for the whole host in packages/plugin-api/src/session.ts; this
    // plugin only consumes the answer.
    const stopSession = ctx.onSessionId((id) => {
      sessionId = id;
      paint();
    });

    const stopMessages = ctx.onMessage("io_message", (payload) => {
      const identity = messagingIdentity(payload);
      if (identity !== null) {
        observed = { sessionId, identity };
        paint();
      }
    });

    ctx.check("badge is mounted", () =>
      badge?.isConnected
        ? { verdict: "pass", detail: headlineText(sessionId) }
        : { verdict: "fail", detail: "the badge is not in the document" },
    );

    /**
     * Whether the address scrape has ever found anything.
     *
     * This is the check worth having here, and the session id is not: the id comes from the host,
     * which reports on it under `core`, while the address is this plugin's one piece of
     * derived-from-someone-else's-wording risk — a bounded regex over a stringified tool result, in
     * two CLI phrasings, pinned by this plugin's tests against a form that can change without
     * anything here breaking loudly. A rewording turns the pop-up's first row into a permanent "no
     * messaging address yet", which is also exactly what an ordinary session that never ran
     * `ListAgents` looks like.
     *
     * So it stays `n/a` in most sessions, and that is the honest answer rather than a defect in the
     * check: it says the scrape has had no opportunity, not that it works.
     */
    ctx.check("messaging address observed", () => {
      const identity = currentIdentity();
      if (identity !== null) return { verdict: "pass", detail: formatAddress(identity) };
      if (observed !== null) {
        return { verdict: "n/a", detail: "one was seen, for a session this panel has left" };
      }
      return { verdict: "n/a", detail: "none yet — it appears once this session runs ListAgents" };
    });

    return () => {
      stopWatch();
      stopSession();
      stopMessages();
      if (badgeFlashTimer !== null) clearTimeout(badgeFlashTimer);
      closePopup();
    };
  },
});
