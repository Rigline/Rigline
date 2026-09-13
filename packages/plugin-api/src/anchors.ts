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
 * Adding an entry: verify the pair against the installed bundle (the class map the core harvests
 * is the source of truth; search the bundle for `local:"local_hash"`), describe what the element
 * is and where it renders, mark whether it is something to mount against or a style to borrow,
 * and note any condition under which it does not render. An entry is a promise to keep the name
 * pointing at the same piece of UI across versions.
 */

/** The webview surfaces the extension creates. The full editor is the one with no distinguishing global. */
export type Surface = "editor" | "sidebar" | "sessionList";

export interface AnchorSpec {
  /** The six-character CSS-module hash. */
  readonly module: string;
  /** The local class name inside that module. */
  readonly local: string;
  /** "element": something to mount against or observe. "style": a class borrowed for a plugin's own markup. */
  readonly kind: "element" | "style";
  /** What it is and where it renders, for authors and for the install-time permission summary. */
  readonly description: string;
  /** The surfaces it renders on, where known. Absent means not yet measured. */
  readonly surfaces?: readonly Surface[];
  /** The condition under which it renders, when it is not always present. */
  readonly when?: string;
}

export const ANCHORS = {
  modelPill: {
    module: "gGYT1w",
    local: "modelPill",
    kind: "element",
    description:
      "The model picker pill in the composer footer. It is a combobox button, so mount after it rather than inside it, or a decoration inherits its click handling and its accessible name and stops being selectable text.",
    surfaces: ["editor", "sidebar"],
  },
  modelPillRow: {
    module: "gGYT1w",
    local: "modelPillRow",
    kind: "element",
    description: "A wrapper around the model pill in one of the footer's two layouts.",
    surfaces: ["editor", "sidebar"],
    when: "The footer renders the pill bare in one layout and inside this row in the other; the pill always renders, the row only sometimes.",
  },
  composer: {
    module: "07S1Yg",
    local: "inputContainer",
    kind: "element",
    description: "The container of the prompt input at the foot of the transcript.",
    surfaces: ["editor", "sidebar"],
  },
  transcriptRow: {
    module: "07S1Yg",
    local: "message",
    kind: "element",
    description:
      "Every transcript row, user and assistant alike. The transcript capability finds rows by this class. Rows are keyed by index upstream, so one element is reused for a different message when the list is spliced; hold nothing against an element.",
    surfaces: ["editor", "sidebar"],
  },
  assistantRow: {
    module: "07S1Yg",
    local: "timelineMessage",
    kind: "element",
    description:
      "An assistant transcript row: one per content block, so a thinking block, a tool call and a text block are each their own row.",
    surfaces: ["editor", "sidebar"],
  },
  userRow: {
    module: "07S1Yg",
    local: "userMessageContainer",
    kind: "element",
    description: "A user transcript row.",
    surfaces: ["editor", "sidebar"],
    when: "Most user rows carry it; rely on transcriptRow to enumerate rows.",
  },
  sessionListItem: {
    module: "OOQiHg",
    local: "sessionItem",
    kind: "element",
    description:
      "One row of the session list. The list is virtualised, so only rows on screen exist.",
    surfaces: ["sessionList"],
  },
  sessionListItemName: {
    module: "OOQiHg",
    local: "sessionName",
    kind: "element",
    description: "The title text inside a session-list row.",
    surfaces: ["sessionList"],
  },
  sessionStatusFilterButton: {
    module: "OOQiHg",
    local: "statusFilterMenuButton",
    kind: "element",
    description: "The button that opens the session list's status and tab filter menu.",
    surfaces: ["sessionList"],
  },
  worktreePill: {
    module: "OOQiHg",
    local: "worktreePill",
    kind: "element",
    description: "The pill naming a session's worktree in the session list.",
    surfaces: ["sessionList"],
    when: "The session is in a worktree other than the one the window is open on.",
  },
  worktreeBanner: {
    module: "aqhumA",
    local: "worktreeBannerName",
    kind: "element",
    description: "The worktree name inside the banner that says this session is in a worktree.",
    surfaces: ["editor", "sidebar"],
    when: "The panel's session is in a worktree other than the one the window is open on.",
  },
  branchPill: {
    module: "5FHdxw",
    local: "branchPill",
    kind: "element",
    description: "The git branch pill on a session-list row.",
    surfaces: ["sessionList"],
  },
  repoPill: {
    module: "W2z5EA",
    local: "repoPill",
    kind: "element",
    description: "The repository pill on a session-list row.",
    surfaces: ["sessionList"],
  },
  focusNavTab: {
    module: "hONcXw",
    local: "navTab",
    kind: "element",
    description: "A tab in the focus view's navigation.",
    when: "The focus view is open.",
  },
  marketplaceTabBar: {
    module: "yumWmQ",
    local: "tabBar",
    kind: "element",
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
