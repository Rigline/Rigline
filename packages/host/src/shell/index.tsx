/**
 * The shell: Rigline's one React root. It draws the RIG pill and the menu behind it, and renders each
 * plugin's menu contribution inside an error boundary of its own (D88).
 *
 * Built with the runtime rather than into post.js, so it and the plugins share one React and one
 * `@rigline/plugin-api/ui`. The menu renders in the root's own container on `body`, never inside the
 * pill: the pill is a child of the composer footer, which re-measures on any mutation inside it (D54).
 */
import { useStore } from "@rigline/plugin-api/ui";
import {
  Component,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Contribution, ShellOptions } from "./types.ts";

const CSS = `
.rigline-pill {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 1px 6px;
  border: none;
  border-radius: 6px;
  font: 10px/1.4 monospace;
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
.rigline-menu {
  position: fixed;
  z-index: 2147483647;
  min-width: 220px;
  max-width: 480px;
  max-height: 60vh;
  overflow: auto;
  padding: 4px 0;
  border: 1px solid var(--vscode-menu-border, #454545);
  border-radius: 6px;
  background: var(--vscode-menu-background, #252526);
  color: var(--vscode-menu-foreground, #cccccc);
  box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.5));
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
}
.rigline-menu-empty {
  padding: 6px 12px;
  opacity: 0.6;
}
`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One contribution, which takes only its own plugin down with it when it throws. */
class Boundary extends Component<{ readonly item: Contribution }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.item.onError(`its menu component threw: ${message(error)}`);
  }

  override render(): ReactNode {
    if (this.state.failed) return null;
    const Contributed = this.props.item.component as () => ReactNode;
    return <Contributed />;
  }
}

/** Above the pill, and kept inside the panel on whichever side the pill sits. */
function menuPosition(pill: Element): CSSProperties {
  const rect = pill.getBoundingClientRect();
  const bottom = window.innerHeight - rect.top + 4;
  return rect.left > window.innerWidth / 2
    ? { bottom, right: Math.max(8, window.innerWidth - rect.right) }
    : { bottom, left: Math.max(8, rect.left) };
}

function Menu(props: {
  readonly pill: Element;
  readonly items: readonly Contribution[];
  readonly onClose: () => void;
}): ReactNode {
  const { pill, items, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => setPosition(menuPosition(pill)), [pill]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target;
      if (target instanceof Node && (ref.current?.contains(target) || pill.contains(target)))
        return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [pill, onClose]);

  return (
    <div ref={ref} className="rigline-menu" style={position}>
      {items.length === 0 ? (
        <div className="rigline-menu-empty">Nothing has been added to this menu</div>
      ) : (
        items.map((item) => <Boundary key={item.key} item={item} />)
      )}
    </div>
  );
}

function Shell(props: ShellOptions): ReactNode {
  const { pill, contributions, failing } = props;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const count = useStore(failing);
  const items = useStore(contributions);
  const summary = count > 0 ? `${count} failing` : "all checks pass";

  return (
    <>
      {createPortal(
        <button
          type="button"
          className={count > 0 ? "rigline-pill rigline-pill-failing" : "rigline-pill"}
          aria-expanded={open}
          title={`${summary} — click to ${open ? "close" : "open"} Rigline's menu`}
          onClick={() => setOpen(!open)}
        >
          {count > 0 ? `RIG ${count}` : "RIG"}
        </button>,
        pill,
      )}
      {open && <Menu pill={pill} items={items} onClose={close} />}
    </>
  );
}

export function startShell(options: ShellOptions): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-rigline-style", "rigline");
  style.textContent = CSS;
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
