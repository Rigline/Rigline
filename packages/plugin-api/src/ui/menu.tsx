/**
 * Rigline's menu: the panel the shell opens from the RIG pill, and the components plugins fill it
 * with. One module, because the components read a context the panel provides, and a context is
 * shared only by code importing the same module instance (D88).
 */
import {
  Component,
  type CSSProperties,
  createContext,
  Fragment,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { MenuComponent } from "../context.ts";
import { FaultContext, message } from "./fault.ts";

/** Colours are the app's own tokens, each falling back to the theme variable the app aliases it to. */
export const MENU_CSS = `
.rigline-menu {
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  min-width: 220px;
  max-width: min(480px, calc(100vw - 16px));
  max-height: 60vh;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
  border-radius: var(--corner-radius-large, 8px);
  background: var(--app-menu-background, var(--vscode-menu-background, #252526));
  color: var(--app-primary-foreground, var(--vscode-foreground, #cccccc));
  box-shadow: 0 4px 16px var(--vscode-widget-shadow, transparent);
  letter-spacing: normal;
  user-select: none;
  cursor: default;
}
.rigline-menu-level:focus {
  outline: none;
}
.rigline-menu-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  padding: 6px 12px;
  border: none;
  border-radius: var(--app-list-border-radius, 4px);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.9em;
  text-align: left;
  cursor: pointer;
}
.rigline-menu-item:focus {
  outline: none;
  background: var(--app-list-active-background, var(--vscode-list-activeSelectionBackground));
  color: var(--app-list-active-foreground, var(--vscode-list-activeSelectionForeground));
}
.rigline-menu-item[aria-disabled="true"] {
  opacity: 0.5;
  cursor: default;
}
.rigline-menu-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.rigline-menu-description,
.rigline-menu-chevron,
.rigline-menu-back,
.rigline-menu-note {
  color: var(--app-secondary-foreground, var(--vscode-descriptionForeground));
}
.rigline-menu-description {
  font-size: 0.85em;
  overflow-wrap: anywhere;
}
.rigline-menu-item:focus .rigline-menu-description,
.rigline-menu-item:focus .rigline-menu-chevron,
.rigline-menu-item.rigline-menu-back:focus {
  color: inherit;
}
.rigline-menu-check,
.rigline-menu-chevron {
  display: flex;
  flex-shrink: 0;
  align-self: center;
  justify-content: center;
  width: 16px;
  margin-left: auto;
}
.rigline-menu-back {
  align-items: center;
  font-size: 0.85em;
}
.rigline-menu-note {
  padding: 4px 12px;
  font-size: 0.8em;
}
.rigline-menu-divider {
  height: 1px;
  margin: 4px 0;
  border: none;
  background: var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
}
`;

/** What `onSelect` is handed. */
export interface MenuSelectEvent {
  /** Keep the menu open after this choice. */
  preventDefault(): void;
}

export interface MenuItemProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** Makes the item a checkbox, with a check on the right while true. */
  readonly checked?: boolean;
  readonly disabled?: boolean;
  /** The tooltip. */
  readonly title?: string;
  /** Closes the menu afterwards unless it calls `event.preventDefault()`. A throw disables the plugin. */
  readonly onSelect?: (event: MenuSelectEvent) => void;
}

export interface SubmenuProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly title?: string;
  /** Shown in place of the menu while the submenu is open: items, notes, submenus or any content. */
  readonly children?: ReactNode;
}

export interface MenuNoteProps {
  readonly children?: ReactNode;
}

/** One plugin's contribution, as the shell hands it over. */
export interface MenuEntry {
  readonly key: number;
  readonly owner: string;
  readonly component: MenuComponent;
  /** The owning plugin's error path. */
  readonly onError: (reason: string) => void;
}

export interface MenuPanelProps {
  /** What the panel opens from: it sits above it, and a press on it is not a press outside. */
  readonly anchor: Element;
  readonly entries: readonly MenuEntry[];
  /** Opened from the keyboard, the first item; from the pointer, the menu, highlighting nothing. */
  readonly initialFocus: "first" | "menu";
  readonly onClose: (restoreFocus: boolean) => void;
}

interface MenuState {
  /** The open submenus, outermost first. */
  readonly stack: readonly string[];
  /** Where an open submenu portals its level. */
  readonly panel: HTMLElement | null;
  enter(depth: number, id: string, row: HTMLElement): void;
  back(): void;
  forget(id: string): void;
  close(restoreFocus: boolean): void;
}

const MenuContext = createContext<MenuState | null>(null);

/** The depth of the level an item renders in: 0 for the menu itself. */
const DepthContext = createContext(0);

const ITEM = '[role^="menuitem"]';
const LEVEL = '[role="menu"]';

function useMenu(component: string): MenuState {
  const menu = useContext(MenuContext);
  if (menu === null) {
    throw new Error(
      `${component} renders only inside Rigline's menu. A plugin that bundles @rigline/plugin-api/ui has its own copy, which the menu cannot see: leave it external.`,
    );
  }
  return menu;
}

function focusOnPointer(e: PointerEvent<HTMLElement>): void {
  if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
}

/** What makes an element an item: its role, focus following the pointer, and choosing. */
function useMenuItem(
  component: string,
  behaviour: {
    readonly checkable: boolean;
    readonly checked?: boolean;
    readonly disabled?: boolean;
    readonly choose: (row: HTMLElement) => void;
  },
) {
  useMenu(component);
  const { checkable, checked, disabled, choose } = behaviour;
  return {
    type: "button" as const,
    role: checkable ? ("menuitemcheckbox" as const) : ("menuitem" as const),
    tabIndex: -1,
    "aria-checked": checkable ? checked === true : undefined,
    "aria-disabled": disabled === true ? true : undefined,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (disabled !== true) choose(e.currentTarget);
    },
    onPointerMove: focusOnPointer,
  };
}

function Text(props: { readonly label: ReactNode; readonly description?: ReactNode }): ReactNode {
  const { label, description } = props;
  return (
    <span className="rigline-menu-text">
      <span className="rigline-menu-label">{label}</span>
      {description !== undefined && description !== null && (
        <span className="rigline-menu-description">{description}</span>
      )}
    </span>
  );
}

function Check(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.2 3.2L13 4.8" />
    </svg>
  );
}

/** An entry in Rigline's menu. */
export function MenuItem(props: MenuItemProps): ReactNode {
  const { label, description, checked, disabled, title, onSelect } = props;
  const menu = useMenu("MenuItem");
  const fault = useContext(FaultContext);
  const item = useMenuItem("MenuItem", {
    checkable: checked !== undefined,
    checked,
    disabled,
    choose: () => {
      let keepOpen = false;
      try {
        onSelect?.({
          preventDefault: () => {
            keepOpen = true;
          },
        });
      } catch (e) {
        fault(`its menu handler threw: ${message(e)}`);
        return;
      }
      if (!keepOpen) menu.close(true);
    },
  });
  return (
    <button {...item} className="rigline-menu-item" title={title}>
      <Text label={label} description={description} />
      {checked !== undefined && (
        <span className="rigline-menu-check" aria-hidden="true">
          {checked && <Check />}
        </span>
      )}
    </button>
  );
}

/** A row that opens its children in place of the menu, under a row that leads back. */
export function Submenu(props: SubmenuProps): ReactNode {
  const { label, description, disabled, title, children } = props;
  const menu = useMenu("Submenu");
  const depth = useContext(DepthContext);
  const id = useId();
  const open = menu.stack[depth] === id;
  const item = useMenuItem("Submenu", {
    checkable: false,
    disabled,
    choose: (row) => menu.enter(depth, id, row),
  });
  const { forget } = menu;
  useEffect(() => () => forget(id), [forget, id]);
  return (
    <>
      <button
        {...item}
        id={`${id}row`}
        className="rigline-menu-item"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Text label={label} description={description} />
        <span className="rigline-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open &&
        menu.panel !== null &&
        createPortal(
          <Level
            depth={depth + 1}
            shown={menu.stack.length === depth + 1}
            back={label}
            labelledBy={`${id}row`}
          >
            {children}
          </Level>,
          menu.panel,
        )}
    </>
  );
}

/** A line in the menu that is not an item. */
export function MenuNote(props: MenuNoteProps): ReactNode {
  useMenu("MenuNote");
  return <div className="rigline-menu-note">{props.children}</div>;
}

function BackRow(props: { readonly label: ReactNode }): ReactNode {
  const menu = useMenu("Submenu");
  const item = useMenuItem("Submenu", { checkable: false, choose: () => menu.back() });
  return (
    <button {...item} className="rigline-menu-item rigline-menu-back" data-rigline-back="">
      <span aria-hidden="true">‹</span>
      <span className="rigline-menu-label">{props.label}</span>
    </button>
  );
}

function Level(props: {
  readonly depth: number;
  readonly shown: boolean;
  readonly back?: ReactNode;
  readonly labelledBy?: string;
  readonly children?: ReactNode;
}): ReactNode {
  const { depth, shown, back, labelledBy, children } = props;
  return (
    <DepthContext.Provider value={depth}>
      <div
        className="rigline-menu-level"
        role="menu"
        tabIndex={-1}
        hidden={!shown}
        aria-labelledby={labelledBy}
      >
        {back !== undefined && <BackRow label={back} />}
        {children}
      </div>
    </DepthContext.Provider>
  );
}

/** One contribution, which takes only its own plugin down with it when it throws. */
class Boundary extends Component<{ readonly entry: MenuEntry }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.entry.onError(`its menu component threw: ${message(error)}`);
  }

  override render(): ReactNode {
    if (this.state.failed) return null;
    const Contributed = this.props.entry.component as () => ReactNode;
    return (
      <FaultContext.Provider value={this.props.entry.onError}>
        <Contributed />
      </FaultContext.Provider>
    );
  }
}

/** Above the anchor, and kept inside the panel on whichever side the anchor sits. */
function positionFrom(anchor: Element): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const bottom = window.innerHeight - rect.top + 4;
  return rect.left > window.innerWidth / 2
    ? { bottom, right: Math.max(8, window.innerWidth - rect.right) }
    : { bottom, left: Math.max(8, rect.left) };
}

function shownLevel(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>(`:scope > ${LEVEL}:not([hidden])`);
}

function itemsIn(level: HTMLElement): HTMLElement[] {
  return [...level.querySelectorAll<HTMLElement>(ITEM)];
}

/** A level's first item past its back row, or the back row, or the level itself. */
function focusFirst(level: HTMLElement): void {
  const items = itemsIn(level);
  (items.find((item) => !item.hasAttribute("data-rigline-back")) ?? items[0] ?? level).focus();
}

/** The menu: every plugin's contribution in registry order, a divider between plugins. */
export function MenuPanel(props: MenuPanelProps): ReactNode {
  const { anchor, entries, initialFocus, onClose } = props;
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [stack, setStack] = useState<readonly string[]>([]);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const current = useRef(stack);
  const opening = useRef(initialFocus);
  /** The row that opened each open submenu, to refocus on the way back. */
  const rows = useRef(new Map<string, HTMLElement>());
  /** Where focus goes once the shown level changes; null for its first item. */
  const refocus = useRef<HTMLElement | null>(null);

  const enter = useCallback((depth: number, id: string, row: HTMLElement) => {
    rows.current.set(id, row);
    refocus.current = null;
    setStack((s) => [...s.slice(0, depth), id]);
  }, []);

  const back = useCallback(() => {
    const top = current.current.at(-1);
    if (top === undefined) return;
    refocus.current = rows.current.get(top) ?? null;
    rows.current.delete(top);
    setStack((s) => s.slice(0, -1));
  }, []);

  const forget = useCallback((id: string) => {
    rows.current.delete(id);
    setStack((s) => {
      const i = s.indexOf(id);
      return i === -1 ? s : s.slice(0, i);
    });
  }, []);

  const menu = useMemo<MenuState>(
    () => ({ stack, panel, enter, back, forget, close: onClose }),
    [stack, panel, enter, back, forget, onClose],
  );

  useLayoutEffect(() => setPosition(positionFrom(anchor)), [anchor]);

  useLayoutEffect(() => {
    current.current = stack;
    if (panel === null) return;
    const target = refocus.current;
    const level = shownLevel(panel) ?? panel;
    refocus.current = null;
    if (target?.isConnected) target.focus();
    else if (opening.current === "menu") level.focus();
    else focusFirst(level);
    opening.current = "first";
  }, [panel, stack]);

  useEffect(() => {
    if (panel === null) return;
    const onPointerDown = (e: globalThis.PointerEvent): void => {
      const target = e.target;
      if (target instanceof Node && (panel.contains(target) || anchor.contains(target))) return;
      onClose(false);
    };
    /** True when the menu took the key. */
    const handle = (e: KeyboardEvent): boolean => {
      if (e.isComposing) return false;
      if (e.key === "Escape") {
        if (current.current.length > 0) back();
        else onClose(true);
        return true;
      }
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !panel.contains(active)) return false;
      if (e.key === "Tab") {
        onClose(true);
        return true;
      }
      // A plugin's own control keeps its keys: Home in a text field is not a menu key.
      if (!active.matches(ITEM) && !active.matches(LEVEL)) return false;
      const level = shownLevel(panel);
      if (level === null) return false;
      const items = itemsIn(level);
      const i = items.indexOf(active);
      const move = (to: HTMLElement | undefined): boolean => {
        to?.focus();
        return to !== undefined;
      };
      switch (e.key) {
        case "ArrowDown":
          return move(items[(i + 1) % items.length]);
        case "ArrowUp":
          return move(items[i <= 0 ? items.length - 1 : i - 1]);
        case "Home":
          return move(items[0]);
        case "End":
          return move(items.at(-1));
        case "ArrowRight":
          if (active.getAttribute("aria-haspopup") !== "menu") return false;
          active.click();
          return true;
        case "ArrowLeft":
          if (current.current.length === 0) return false;
          back();
          return true;
        default:
          return false;
      }
    };
    // On window, in capture, so the app's own document listeners never see a key the menu took.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!handle(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [panel, anchor, onClose, back]);

  return (
    <MenuContext.Provider value={menu}>
      <div ref={setPanel} className="rigline-menu" style={position}>
        <Level depth={0} shown={stack.length === 0}>
          {entries.length === 0 ? (
            <div className="rigline-menu-note">Nothing has been added to this menu</div>
          ) : (
            entries.map((entry, i) => (
              <Fragment key={entry.key}>
                {i > 0 && entries[i - 1]?.owner !== entry.owner && (
                  <hr className="rigline-menu-divider" />
                )}
                <Boundary entry={entry} />
              </Fragment>
            ))
          )}
        </Level>
      </div>
    </MenuContext.Provider>
  );
}
