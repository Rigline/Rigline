/**
 * The curated anchor table: stable names for the pieces of the extension's UI a plugin may target.
 *
 * The extension's stylesheet is CSS-modules output, so every class is `<local>_<hash>` where the
 * six-character hash identifies the module the class was defined in. Local names are reused across
 * modules (`message` is defined in five, `menuPopup` in five, `branchPill` in two), so a class is
 * only meaningful as a module-scoped pair. Plugins could carry those pairs themselves, and may
 * (`uses.classes` in the manifest, `ctx.cls()` at runtime), but a pair is opaque to read, opaque to
 * review, and has to be corrected in every plugin when the extension moves it.
 *
 * This table is the alternative: one name per piece of UI, resolved to the pair here, validated
 * against every extension version by the update flow, and corrected in one place. A plugin
 * declares `uses.anchors: ["modelPill"]` and calls `ctx.anchor("modelPill")`. An anchor whose
 * class has gone from the installed extension is reported against this table and refuses only
 * the plugins that declared it.
 *
 * **A class is not an identity** (D7). One class is applied wherever that look is wanted, so
 * `modelPill_gGYT1w` is on the model picker *and* on the agent-map button, and a name resolved to
 * a bare class and taken as `[0]` can point at the wrong control while every check passes. So an
 * entry says which of three things it names — one element, many elements, or a look to borrow —
 * and carries whatever else it takes to pick its element out of the ones sharing the class. Core
 * counts how many places the bundle applies each class and refuses to resolve a `singleton` that
 * is applied more than once without a refinement — or without `knownSites`, which is how an entry
 * says the extra references were read and are one control.
 *
 * Adding an entry: verify the pair against the installed bundle (the class map the core harvests
 * is the source of truth; search the bundle for `local:"local_hash"`), describe what the element
 * is and where it renders, mark whether it is one element, many, or a style to borrow, refine it
 * against whatever else carries the class, and note any condition under which it does not render.
 * An entry is a promise to keep the name pointing at the same piece of UI across versions.
 */

/** The webview surfaces the extension creates. The full editor is the one with no distinguishing global. */
export type Surface = "editor" | "sidebar" | "sessionList";

/**
 * What an anchor names.
 *
 * `singleton` and `collection` were one `element` kind until the uniqueness rule needed saying:
 * the model pill is one element and a second match is a bug, transcript rows are many by design
 * and the question there is whether everything carrying the class really is a row. Held apart,
 * the distinction is simply which of the two standard query calls the host makes. `style` is
 * exempt from all of it, because a borrowed class being applied in several places is the point of
 * borrowing it.
 */
export type AnchorKind = "singleton" | "collection" | "style";

export interface AnchorSpec {
  /** The six-character CSS-module hash. */
  readonly module: string;
  /** The local class name inside that module. */
  readonly local: string;
  /** One element, many elements, or a look a plugin borrows for its own markup. */
  readonly kind: AnchorKind;
  /** What it is and where it renders, for authors and for the install-time permission summary. */
  readonly description: string;
  /**
   * The rest of the selector, appended to the resolved class: `[role="combobox"]`, `:not(...)`,
   * a second class. Plain CSS, with none of our own vocabulary in it. Required of a `singleton`
   * whose class the bundle applies at more than one site, and the way a `collection` says which of
   * the elements carrying the class are the ones it means.
   *
   * Anchor it on something that crosses a serialisation boundary (P1) — ARIA, a `data-` attribute
   * the app queries itself — and never on a second hashed class, which would need resolving too.
   */
  readonly refine?: string;
  /**
   * The name of an ancestor anchor this one sits inside, resolved to
   * `<ancestor selector> <this selector>`. For the case a module-and-local pair can never express:
   * a class that means one thing inside a particular container and something else outside it. An
   * ancestor that does not resolve leaves this one unresolved rather than falling back to the bare
   * class.
   *
   * Typed `string` rather than `AnchorName` because `ANCHORS` infers its own key union, so naming
   * the union here makes the table circularly reference itself. `WithinAnchors` below asserts the
   * same thing after the fact, and the table's own test asserts what a type cannot: that the
   * ancestor is an element rather than a style, and that no chain of them loops.
   */
  readonly within?: string;
  /**
   * "I have read these application sites and they are one control." For a `singleton` only, and
   * only where a refinement is not the answer.
   *
   * The site count is an upper bound: it counts every reference to a class, so the bundle passing
   * one somewhere as a value reads as a site — which is exactly what one of `modelPill`'s three
   * already is. Without this, a maintainer meeting that has two discharges, and both are bad: a
   * refinement against something that discriminates nothing, or relabelling the anchor
   * `collection`, which switches the check off permanently. Under weekly extension releases the
   * relabel is the cheaper move every time, so the rule would corrode itself.
   *
   * It is bounded, not a blanket exemption: a count above `count` is ambiguous again, and the
   * failure names both numbers. `why` is required for the same reason a host patch's is — the field
   * exists to be read by the next person, and a bare number invites bumping without looking.
   */
  readonly knownSites?: { readonly count: number; readonly why: string };
  /** The surfaces it renders on, where known. Absent means not yet measured. */
  readonly surfaces?: readonly Surface[];
  /** The condition under which it renders, when it is not always present. */
  readonly when?: string;
}

export const ANCHORS = {
  modelPill: {
    module: "gGYT1w",
    local: "modelPill",
    kind: "singleton",
    refine: '[role="combobox"]',
    description:
      "The model picker pill in the composer footer. It is a combobox button, so mount after it rather than inside it, or a decoration inherits its click handling and its accessible name and stops being selectable text. The agent-map button wears the same pill class and is not a picker, which is what the refinement excludes.",
    surfaces: ["editor", "sidebar"],
  },
  modelPillRow: {
    module: "gGYT1w",
    local: "modelPillRow",
    kind: "singleton",
    description: "A wrapper around the model pill in one of the footer's two layouts.",
    surfaces: ["editor", "sidebar"],
    when: "The footer renders the pill bare in one layout and inside this row in the other; the pill always renders, the row only sometimes.",
  },
  composer: {
    module: "07S1Yg",
    local: "inputContainer",
    kind: "singleton",
    description: "The container of the prompt input at the foot of the transcript.",
    surfaces: ["editor", "sidebar"],
  },
  transcriptRow: {
    module: "07S1Yg",
    local: "message",
    kind: "collection",
    refine: "[data-transcript-message]",
    description:
      "Every transcript row, user and assistant alike. The transcript capability finds rows by this class. Rows are keyed by index upstream, so one element is reused for a different message when the list is spliced; hold nothing against an element. The refinement is the app's own row marker, which it queries itself; without it the focus view's todo item comes back as a row.",
    surfaces: ["editor", "sidebar"],
  },
  assistantRow: {
    module: "07S1Yg",
    local: "timelineMessage",
    kind: "collection",
    refine: '[data-testid="assistant-message"]',
    description:
      "An assistant transcript row. The class alone is the timeline look rather than the row: the focus view's fold, subagent and todo rows all wear it, and so does a user row carrying IDE diagnostics, which is why this is refined down to the app's own test id.",
    surfaces: ["editor", "sidebar"],
  },
  userRow: {
    module: "07S1Yg",
    local: "userMessageContainer",
    kind: "collection",
    refine: "[data-transcript-message]",
    description:
      "A user transcript row. The refinement is the app's own row marker, which the two per-block containers nested inside the row do not carry.",
    surfaces: ["editor", "sidebar"],
    when: "Most user rows carry it; a user row with IDE diagnostics wears the assistant row's class instead. Rely on transcriptRow to enumerate rows.",
  },
  sessionListItem: {
    module: "OOQiHg",
    local: "sessionItem",
    kind: "collection",
    description:
      "One row of the session list. The list is virtualised, so only rows on screen exist.",
    surfaces: ["sessionList"],
  },
  sessionListItemName: {
    module: "OOQiHg",
    local: "sessionName",
    kind: "collection",
    within: "sessionListItem",
    description:
      "The title text inside a session-list row. Scoped to the row rather than refined, because the name renders as a span in one branch and a contentEditable span in another and both are legitimately it; the containment is what the pair alone could never say.",
    surfaces: ["sessionList"],
  },
  sessionStatusFilterButton: {
    module: "OOQiHg",
    local: "statusFilterMenuButton",
    kind: "singleton",
    description: "The button that opens the session list's status and tab filter menu.",
    surfaces: ["sessionList"],
  },
  worktreePill: {
    module: "OOQiHg",
    local: "worktreePill",
    kind: "collection",
    description: "The pill naming a session's worktree in the session list.",
    surfaces: ["sessionList"],
    when: "The session is in a worktree other than the one the window is open on.",
  },
  worktreeBanner: {
    module: "aqhumA",
    local: "worktreeBannerName",
    kind: "singleton",
    description: "The worktree name inside the banner that says this session is in a worktree.",
    surfaces: ["editor", "sidebar"],
    when: "The panel's session is in a worktree other than the one the window is open on.",
  },
  branchPill: {
    module: "5FHdxw",
    local: "branchPill",
    kind: "collection",
    description: "The git branch pill on a session-list row.",
    surfaces: ["sessionList"],
  },
  repoPill: {
    module: "W2z5EA",
    local: "repoPill",
    kind: "collection",
    description: "The repository pill on a session-list row.",
    surfaces: ["sessionList"],
  },
  focusNavTab: {
    module: "hONcXw",
    local: "navTab",
    kind: "collection",
    description: "A tab in the focus view's navigation.",
    when: "The focus view is open.",
  },
  marketplaceTabBar: {
    module: "yumWmQ",
    local: "tabBar",
    kind: "singleton",
    description: "The tab bar of the plugin marketplace dialog.",
    when: "The marketplace dialog is open.",
  },
  footerMenuPopup: {
    module: "8RAulQ",
    local: "menuPopup",
    kind: "style",
    description:
      "The composer footer's own pop-up menu. Borrow these footerMenu* classes so a plugin's pop-up matches the app's.",
  },
  footerMenuPopupRight: {
    module: "8RAulQ",
    local: "menuPopupRight",
    kind: "style",
    description: "The right-aligned variant of the footer pop-up.",
  },
  footerMenuHeader: {
    module: "8RAulQ",
    local: "menuHeader",
    kind: "style",
    description: "The header block of the footer pop-up.",
  },
  footerMenuHeaderTitle: {
    module: "8RAulQ",
    local: "menuHeaderTitle",
    kind: "style",
    description: "The title inside the footer pop-up's header.",
  },
  footerMenuHeaderHint: {
    module: "8RAulQ",
    local: "menuHeaderHint",
    kind: "style",
    description: "The hint text inside the footer pop-up's header.",
  },
  footerMenuDivider: {
    module: "8RAulQ",
    local: "menuDivider",
    kind: "style",
    description: "A divider between footer pop-up sections.",
  },
  footerMenuItem: {
    module: "8RAulQ",
    local: "menuItem",
    kind: "style",
    description: "A row in the footer pop-up.",
  },
  footerMenuItemText: {
    module: "8RAulQ",
    local: "menuItemText",
    kind: "style",
    description: "The text block of a footer pop-up row.",
  },
  footerMenuItemLabel: {
    module: "8RAulQ",
    local: "menuItemLabel",
    kind: "style",
    description: "The label of a footer pop-up row.",
  },
  footerMenuItemDescription: {
    module: "8RAulQ",
    local: "menuItemDescription",
    kind: "style",
    description: "The description under a footer pop-up row's label.",
  },
  itemTime: {
    module: "cO8y_Q",
    local: "itemTime",
    kind: "style",
    description:
      "The app's small, dimmed time label. Borrow it for a time that should look like the app's own.",
  },
} as const satisfies Record<string, AnchorSpec>;

export type AnchorName = keyof typeof ANCHORS;

export const ANCHOR_NAMES = Object.keys(ANCHORS) as readonly AnchorName[];

/** Every name the table's `within` fields mention. */
type WithinNames = {
  [K in AnchorName]: (typeof ANCHORS)[K] extends { readonly within: infer W } ? W : never;
}[AnchorName];

/**
 * `AnchorSpec.within` has to be typed `string` to keep the table from circularly referencing its
 * own key union, so the narrowing it wanted is asserted here instead: this alias fails to compile
 * if any `within` names something that is not an anchor. Exported so that it is a declaration
 * rather than an unused local, and so the failure names the file a reader has to fix.
 */
export type WithinAnchors = OnlyAnchorNames<WithinNames>;

/** The constraint is the assertion: a `within` that is not an anchor name fails to satisfy it. */
type OnlyAnchorNames<T extends AnchorName> = T;
