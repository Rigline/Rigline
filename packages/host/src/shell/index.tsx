/**
 * The shell: Rigline's one React root. It draws the RIG pill and opens the menu behind it, which
 * `@rigline/plugin-api/ui` draws, and renders every element where it is placed, each contribution
 * inside a boundary of its own (D88, D90).
 *
 * Built with the runtime rather than into post.js, so it and the plugins share one React and one
 * `@rigline/plugin-api/ui`. The menu renders in the root's own container on `body`, never inside the
 * pill: the pill is a child of the composer footer, which re-measures on any mutation inside it (D54).
 */
import { useStore } from "@rigline/plugin-api/ui";
import { FaultContext, MENU_CSS, MenuPanel, PILL_CSS } from "@rigline/plugin-api/ui/internal";
import { Component, type ReactNode, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PlacedElement, ShellOptions } from "./types.ts";

const CSS = `
.rigline-pill {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 1px 6px;
  border: none;
  border-radius: 6px;
  font: 10px/1.4 var(--app-monospace-font-family, monospace);
  color: #fff;
  background: #2d7d46;
  cursor: pointer;
  vertical-align: middle;
  user-select: none;
}
.rigline-pill-failing {
  background: #a3352f;
}
.rigline-pill-fixed {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 2147483647;
}
.rigline-slot {
  display: inline-flex;
  align-items: center;
}
.rigline-element {
  display: contents;
}
.rigline-zone {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px;
  border-top: 0.5px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
  color: var(--app-secondary-foreground, var(--vscode-descriptionForeground));
}
.rigline-zone:not(:has(> :not(:empty))) {
  display: none;
}
`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One element, which takes only its own plugin down with it when it throws. */
class ElementBoundary extends Component<
  { readonly element: PlacedElement },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const { id, onError } = this.props.element;
    onError(`its element "${id}" threw: ${message(error)}`);
  }

  /** In a form of its own, so the element's controls never belong to the composer's (D90). */
  override render(): ReactNode {
    if (this.state.failed) return null;
    const { owner, id, component, onError } = this.props.element;
    const Contributed = component as () => ReactNode;
    return (
      <form className="rigline-element" data-rigline-element={`${owner}/${id}`}>
        <FaultContext.Provider value={onError}>
          <Contributed />
        </FaultContext.Provider>
      </form>
    );
  }
}

/** One portal per target, so the elements sharing a zone keep their order. */
function Elements(props: { readonly elements: readonly PlacedElement[] }): ReactNode {
  const byTarget = new Map<string, PlacedElement[]>();
  for (const element of props.elements) {
    const group = byTarget.get(element.targetKey);
    if (group) group.push(element);
    else byTarget.set(element.targetKey, [element]);
  }
  return [...byTarget].map(([key, group]) =>
    createPortal(
      group.map((element) => <ElementBoundary key={element.key} element={element} />),
      (group[0] as PlacedElement).target,
      key,
    ),
  );
}

function Shell(props: ShellOptions): ReactNode {
  const { pill, contributions, elements, failing } = props;
  const [open, setOpen] = useState<"first" | "menu" | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(null);
    if (restoreFocus) button.current?.focus();
  }, []);
  const count = useStore(failing);
  const items = useStore(contributions);
  const placed = useStore(elements);
  const summary = count > 0 ? `${count} failing` : "all checks pass";

  return (
    <>
      {createPortal(
        <button
          ref={button}
          type="button"
          className={count > 0 ? "rigline-pill rigline-pill-failing" : "rigline-pill"}
          aria-haspopup="menu"
          aria-expanded={open !== null}
          title={`${summary} — click to ${open ? "close" : "open"} Rigline's menu`}
          // A click the keyboard made has no pointer detail, and opens onto the first item.
          onClick={(e) => setOpen(open ? null : e.detail === 0 ? "first" : "menu")}
        >
          {count > 0 ? `RIG ${count}` : "RIG"}
        </button>,
        pill,
      )}
      {open && <MenuPanel anchor={pill} entries={items} initialFocus={open} onClose={close} />}
      <Elements elements={placed} />
    </>
  );
}

export function startShell(options: ShellOptions): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-rigline-style", "rigline");
  style.textContent = CSS + MENU_CSS + PILL_CSS;
  document.head.appendChild(style);
  const root = createRoot(options.layer, {
    // A contribution's boundary reports through its plugin's error path, which logs it attributed.
    onCaughtError: () => {},
    onUncaughtError: (error) => options.onError(message(error)),
  });
  root.render(<Shell {...options} />);
  return () => {
    root.unmount();
    style.remove();
  };
}
