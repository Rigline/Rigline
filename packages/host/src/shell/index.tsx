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
import { Component, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { EDIT_CSS, EditLayer } from "./edit.tsx";
import { layoutMenu } from "./layout.tsx";
import { OWN_CSS } from "./own.tsx";
import type { Contribution, PlacedElement, ShellOptions } from "./types.ts";

const CSS = `
.rigline-pill {
  --app-pill-foreground: #fff;
  --app-pill-background: #2d7d46;
  --app-pill-hover-background: #2d7d46;
  user-select: none;
}
.rigline-pill-failing {
  --app-pill-background: #a3352f;
  --app-pill-hover-background: #a3352f;
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
.rigline-zone[data-rigline-editing] {
  display: flex;
  outline: 1px dashed var(--vscode-focusBorder, #007fd4);
  outline-offset: -3px;
}
.rigline-zone[data-rigline-editing]:not(:has(> :not(:empty)))::before {
  content: attr(data-rigline-title);
  font-size: 0.85em;
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

function Shell(props: ShellOptions & { readonly own: Contribution }): ReactNode {
  const { pill, contributions, elements, failing, editor, own } = props;
  const [open, setOpen] = useState<"first" | "menu" | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(null);
    if (restoreFocus) button.current?.focus();
  }, []);
  const leave = useCallback(() => {
    editor.editing.set(false);
    button.current?.focus();
  }, [editor]);
  const count = useStore(failing);
  const contributed = useStore(contributions);
  const laidOut = useStore(editor.view).length > 0;
  const editing = useStore(editor.editing);
  // Rigline's own entry after every plugin's, which the menu divides from them by owner.
  const items = useMemo(
    () => (laidOut ? [...contributed, own] : contributed),
    [contributed, own, laidOut],
  );
  const placed = useStore(elements);
  const summary = count > 0 ? `${count} failing` : "all checks pass";

  return (
    <>
      {createPortal(
        <button
          ref={button}
          type="button"
          className={
            count > 0
              ? "rigline-ui-pill rigline-pill rigline-pill-failing"
              : "rigline-ui-pill rigline-pill"
          }
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
      {editing && (
        <EditLayer
          editor={editor}
          readings={props.readings}
          places={props.places}
          composer={props.composer}
          onLeave={leave}
          onError={props.onError}
        />
      )}
    </>
  );
}

export function startShell(options: ShellOptions): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-rigline-style", "rigline");
  style.textContent = CSS + MENU_CSS + PILL_CSS + EDIT_CSS + OWN_CSS;
  document.head.appendChild(style);
  const root = createRoot(options.layer, {
    // A contribution's boundary reports through its plugin's error path, which logs it attributed.
    onCaughtError: () => {},
    onUncaughtError: (error) => options.onError(message(error)),
  });
  const own: Contribution = {
    key: -1,
    owner: "rigline",
    component: layoutMenu(options.editor, options.readings, options.places),
    onError: options.onError,
  };
  root.render(<Shell {...options} own={own} />);
  return () => {
    root.unmount();
    style.remove();
  };
}

export { riglineElements } from "./own.tsx";
