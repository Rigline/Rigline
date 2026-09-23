/**
 * The shell: Rigline's one React root. It draws the RIG pill and opens the menu behind it, which
 * `@rigline/plugin-api/ui` draws, each plugin's contribution inside a boundary of its own (D88).
 *
 * Built with the runtime rather than into post.js, so it and the plugins share one React and one
 * `@rigline/plugin-api/ui`. The menu renders in the root's own container on `body`, never inside the
 * pill: the pill is a child of the composer footer, which re-measures on any mutation inside it (D54).
 */
import { useStore } from "@rigline/plugin-api/ui";
import { MENU_CSS, MenuPanel } from "@rigline/plugin-api/ui/internal";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ShellOptions } from "./types.ts";

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
`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Shell(props: ShellOptions): ReactNode {
  const { pill, contributions, failing } = props;
  const [open, setOpen] = useState<"first" | "menu" | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(null);
    if (restoreFocus) button.current?.focus();
  }, []);
  const count = useStore(failing);
  const items = useStore(contributions);
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
    </>
  );
}

export function startShell(options: ShellOptions): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-rigline-style", "rigline");
  style.textContent = CSS + MENU_CSS;
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
