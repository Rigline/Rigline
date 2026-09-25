/**
 * Editing in place (D95): a handle over each element on the panel, a tray for the elements with
 * nothing on screen, and a bar to save, revert or stop. A handle opens the element's moves, the
 * Layout submenu's own, so the keyboard edits as it does there. All of it is on the shell's layer
 * over the panel, and none of it is added to the app's DOM (D54).
 */
import { type Layout, layoutCommands, OFF, sameLayout, type ViewPlace } from "@rigline/plugin-api";
import { useStore } from "@rigline/plugin-api/ui";
import { type MenuEntry, MenuPanel } from "@rigline/plugin-api/ui/internal";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { LayoutEditor } from "../kernel/layout.ts";
import type { ElementReading } from "../kernel/shell.ts";
import { copyText, movesOf, SAVE_NOTES, saveHref } from "./layout.tsx";
import { type Box, readingOrder } from "./order.ts";

export const EDIT_CSS = `
.rigline-edit-handle {
  position: fixed;
  z-index: 2147483646;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 1px dashed var(--vscode-focusBorder, #007fd4);
  border-radius: 4px;
  background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 10%, transparent);
  cursor: pointer;
}
.rigline-edit-handle:hover,
.rigline-edit-handle:focus-visible,
.rigline-edit-handle[aria-expanded="true"] {
  border-style: solid;
  outline: none;
  background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 20%, transparent);
}
.rigline-edit-title {
  display: none;
  position: absolute;
  bottom: calc(100% + 3px);
  left: 0;
  padding: 1px 6px;
  border: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
  border-radius: 4px;
  background: var(--app-menu-background, var(--vscode-menu-background, #252526));
  color: var(--app-primary-foreground, var(--vscode-foreground, #cccccc));
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}
.rigline-edit-handle:hover .rigline-edit-title,
.rigline-edit-handle:focus-visible .rigline-edit-title {
  display: block;
}
.rigline-edit-bar {
  position: fixed;
  z-index: 2147483646;
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-inline-size: 0;
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
  border-radius: var(--corner-radius-large, 8px);
  background: var(--app-menu-background, var(--vscode-menu-background, #252526));
  color: var(--app-primary-foreground, var(--vscode-foreground, #cccccc));
  box-shadow: 0 4px 16px var(--vscode-widget-shadow, transparent);
  font-size: 12px;
  line-height: 1.4;
}
.rigline-edit-label {
  margin-right: 4px;
  font-weight: 600;
}
.rigline-edit-gap {
  flex: 1;
}
.rigline-edit-chip,
.rigline-edit-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  margin: 0;
  padding: 1px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
.rigline-edit-chip {
  border: 1px dashed var(--vscode-focusBorder, #007fd4);
  border-radius: 9999px;
}
.rigline-edit-chip:hover,
.rigline-edit-button:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.rigline-edit-chip:focus-visible,
.rigline-edit-button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: 1px;
}
.rigline-edit-why,
.rigline-edit-note {
  color: var(--app-secondary-foreground, var(--vscode-descriptionForeground));
}
.rigline-edit-why {
  font-size: 0.9em;
}
.rigline-edit-primary {
  background: var(--app-button-background, var(--vscode-button-background));
  color: var(--app-button-foreground, var(--vscode-button-foreground));
}
.rigline-edit-primary:hover {
  background: var(--app-button-hover-background, var(--vscode-button-hoverBackground));
}
`;

interface Handle {
  readonly name: string;
  readonly title: string;
  readonly box: Box;
}

interface Chip {
  readonly name: string;
  readonly title: string;
  readonly why: string;
}

interface Frame {
  readonly handles: readonly Handle[];
  readonly tray: readonly Chip[];
  readonly bar: CSSProperties;
}

type Kind = "handle" | "chip";

interface Opened {
  readonly name: string;
  readonly kind: Kind;
  readonly anchor: HTMLElement;
  readonly focus: "first" | "menu";
  readonly entries: readonly MenuEntry[];
}

/** How far a handle stands off what it covers, so its outline is not on the element's own edge. */
const MARGIN = 2;

const UNMEASURED: Frame = { handles: [], tray: [], bar: { visibility: "hidden" } };

/** What an element draws, measured as a range, since its `form` is `display: contents`. */
function boxOf(name: string): Box | null {
  const form = document.querySelector(`form[data-rigline-element="${CSS.escape(name)}"]`);
  if (form === null) return null;
  const range = document.createRange();
  range.selectNodeContents(form);
  const r = range.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return {
    left: Math.round(r.left) - MARGIN,
    top: Math.round(r.top) - MARGIN,
    width: Math.round(r.width) + 2 * MARGIN,
    height: Math.round(r.height) + 2 * MARGIN,
  };
}

function whyAway(place: string, reading: ElementReading | undefined): string {
  if (place === OFF) return "off";
  return reading?.state === "placed" ? "not showing" : "not in this panel";
}

/** Above the composer box and as wide, or along the foot of a panel without one. */
function barAt(composer: Element | null): CSSProperties {
  if (composer === null) return { left: 8, right: 8, bottom: 8 };
  const r = composer.getBoundingClientRect();
  return {
    left: Math.round(r.left),
    width: Math.round(r.width),
    bottom: Math.round(window.innerHeight - r.top + 4),
  };
}

function measure(
  view: readonly ViewPlace[],
  readings: ReadonlyMap<string, ElementReading>,
  composer: Element | null,
): Frame {
  const handles: Handle[] = [];
  const tray: Chip[] = [];
  for (const group of view) {
    for (const { name, title } of group.elements) {
      const box = group.place === OFF ? null : boxOf(name);
      if (box !== null) handles.push({ name, title, box });
      else tray.push({ name, title, why: whyAway(group.place, readings.get(name)) });
    }
  }
  return { handles: readingOrder(handles), tray, bar: barAt(composer) };
}

export interface EditLayerProps {
  readonly editor: LayoutEditor;
  readonly readings: ReadonlyMap<string, ElementReading>;
  readonly composer: () => Element | null;
  /** Leaves the mode and puts focus back on the pill. */
  readonly onLeave: () => void;
  readonly onError: (reason: string) => void;
}

export function EditLayer(props: EditLayerProps): ReactNode {
  const { editor, readings, composer, onLeave, onError } = props;
  const [frame, setFrame] = useState<Frame>(UNMEASURED);
  const [active, setActive] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  /** Each element's handle or chip, whichever it has now. */
  const nodes = useRef(new Map<string, HTMLElement>());
  const entered = useRef(false);

  // Every frame, as the open menu follows the pill: a move, a fit stage or a resize each shifts
  // what a handle covers without saying so.
  useLayoutEffect(() => {
    let raf = 0;
    let last = "";
    const follow = (): void => {
      const next = measure(editor.view.get(), readings, composer());
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setFrame(next);
      }
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [editor, readings, composer]);

  const names = [...frame.handles.map((h) => h.name), ...frame.tray.map((c) => c.name)];
  const stop = active !== null && names.includes(active) ? active : (names[0] ?? null);

  useLayoutEffect(() => {
    if (entered.current || stop === null) return;
    entered.current = true;
    nodes.current.get(stop)?.focus();
  }, [stop]);

  // A move to or from off takes the pop-over's anchor away, so it closes onto what replaced it.
  useLayoutEffect(() => {
    if (opened === null) return;
    const now = frame.handles.some((h) => h.name === opened.name)
      ? "handle"
      : frame.tray.some((c) => c.name === opened.name)
        ? "chip"
        : null;
    if (now === opened.kind) return;
    setOpened(null);
    setActive(opened.name);
    nodes.current.get(opened.name)?.focus();
  }, [frame, opened]);

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpened(null);
      if (restoreFocus && opened !== null) nodes.current.get(opened.name)?.focus();
    },
    [opened],
  );

  // In capture on window, as the menu's keys are, and only while focus is on this layer, so an
  // open pop-over keeps its own.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const here = layer.current;
      const target = document.activeElement;
      if (e.isComposing || here === null || !(target instanceof HTMLElement)) return;
      if (!here.contains(target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onLeave();
        return;
      }
      const items = [...here.querySelectorAll<HTMLElement>("[data-rigline-item]")];
      const i = items.indexOf(target);
      if (i === -1) return;
      let next: HTMLElement | undefined;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = items[(i + 1) % items.length];
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = items[(i - 1 + items.length) % items.length];
          break;
        case "Home":
          next = items[0];
          break;
        case "End":
          next = items.at(-1);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      next?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onLeave]);

  function item(name: string, kind: Kind) {
    return {
      ref: (node: HTMLButtonElement | null) => {
        if (node === null) return;
        nodes.current.set(name, node);
        return () => {
          if (nodes.current.get(name) === node) nodes.current.delete(name);
        };
      },
      type: "button" as const,
      "data-rigline-item": name,
      tabIndex: name === stop ? 0 : -1,
      "aria-haspopup": "menu" as const,
      "aria-expanded": opened?.name === name,
      onFocus: () => setActive(name),
      onClick: (e: MouseEvent<HTMLButtonElement>) => {
        if (opened?.name === name) {
          setOpened(null);
          return;
        }
        setActive(name);
        setOpened({
          name,
          kind,
          anchor: e.currentTarget,
          // A click the keyboard made has no pointer detail, and opens onto the first move.
          focus: e.detail === 0 ? "first" : "menu",
          entries: [{ key: 0, owner: "rigline", component: movesOf(editor, name), onError }],
        });
      },
    };
  }

  return (
    <>
      <div ref={layer}>
        {frame.handles.map((h) => (
          <button
            key={h.name}
            {...item(h.name, "handle")}
            className="rigline-edit-handle"
            aria-label={h.title}
            style={{ left: h.box.left, top: h.box.top, width: h.box.width, height: h.box.height }}
          >
            <span className="rigline-edit-title" aria-hidden="true">
              {h.title}
            </span>
          </button>
        ))}
        <Bar editor={editor} style={frame.bar} onLeave={onLeave}>
          {frame.tray.map((c) => (
            <button key={c.name} {...item(c.name, "chip")} className="rigline-edit-chip">
              {c.title}
              <span className="rigline-edit-why">{c.why}</span>
            </button>
          ))}
        </Bar>
      </div>
      {opened !== null && (
        <MenuPanel
          anchor={opened.anchor}
          entries={opened.entries}
          initialFocus={opened.focus}
          onClose={close}
        />
      )}
    </>
  );
}

function Bar(props: {
  readonly editor: LayoutEditor;
  readonly style: CSSProperties;
  readonly onLeave: () => void;
  readonly children?: ReactNode;
}): ReactNode {
  const { editor, style, onLeave, children } = props;
  const working = useStore(editor.working);
  const baseline = useStore(editor.baseline);
  const saving = useStore(editor.saving);
  const dirty = !sameLayout(working, baseline);
  return (
    <fieldset className="rigline-edit-bar" aria-label="Editing the layout" style={style}>
      <span className="rigline-edit-label">Layout</span>
      {children}
      <span className="rigline-edit-gap" />
      {saving !== "idle" && <span className="rigline-edit-note">{SAVE_NOTES[saving]}</span>}
      {/* Keyed by the copy, so "Commands copied" goes once the copy changes again. */}
      {dirty && <Save key={JSON.stringify(working)} editor={editor} from={baseline} to={working} />}
      {dirty && (
        <button type="button" className="rigline-edit-button" onClick={() => void editor.reload()}>
          Revert changes
        </button>
      )}
      <button type="button" className="rigline-edit-button" onClick={onLeave}>
        Done
      </button>
    </fieldset>
  );
}

function Save(props: {
  readonly editor: LayoutEditor;
  readonly from: Layout;
  readonly to: Layout;
}): ReactNode {
  const { editor, from, to } = props;
  const [copied, setCopied] = useState<boolean | null>(null);
  const href = saveHref(editor, from, to);
  if (href !== null) {
    // Neither prevented nor stopped: VS Code acts only on a click that reaches its listener (D93).
    return (
      <a
        href={href}
        className="rigline-edit-button rigline-edit-primary"
        title="to config.yaml, through the Rigline companion"
        onClick={() => void editor.confirm(to)}
      >
        Save
      </a>
    );
  }
  return (
    <button
      type="button"
      className="rigline-edit-button rigline-edit-primary"
      title="the rigline layout commands that save this layout, to run in a terminal"
      onClick={() => setCopied(copyText(layoutCommands(from, to).join("\n")))}
    >
      {copied === null ? "Copy commands" : copied ? "Commands copied" : "The copy failed"}
    </button>
  );
}
