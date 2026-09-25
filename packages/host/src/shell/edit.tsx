/**
 * Editing in place (D95): a handle over each element on the panel, a tray for the elements with
 * nothing on screen, and a bar to save, revert or stop. A handle opens the element's moves, the
 * Layout submenu's own, so the keyboard edits as it does there, and drags to the places its element
 * offers, changing the copy only on the drop. All of it is on the shell's layer over the panel, and
 * none of it is added to the app's DOM (D54).
 */
import {
  type Layout,
  layoutCommands,
  OFF,
  type Store,
  sameLayout,
  type ViewPlace,
} from "@rigline/plugin-api";
import { useStore } from "@rigline/plugin-api/ui";
import { type MenuEntry, MenuPanel } from "@rigline/plugin-api/ui/internal";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { LayoutEditor } from "../kernel/layout.ts";
import type { ElementReading } from "../kernel/shell.ts";
import { copyText, movesOf, SAVE_NOTES, saveHref } from "./layout.tsx";
import { type Box, contains, insertionIndex, readingOrder, union } from "./order.ts";
import type { PanelPlace } from "./types.ts";

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
  cursor: grab;
  touch-action: none;
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
.rigline-edit-bar-target {
  outline: 1px dashed var(--vscode-focusBorder, #007fd4);
  outline-offset: 2px;
}
.rigline-edit-bar-over {
  outline-style: solid;
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
  cursor: grab;
  touch-action: none;
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
.rigline-edit-dragged {
  opacity: 0.4;
  cursor: grabbing;
}
.rigline-edit-handle.rigline-edit-dragged .rigline-edit-title {
  display: none;
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
.rigline-edit-target {
  position: fixed;
  z-index: 2147483645;
  box-sizing: border-box;
  border: 1px dashed var(--vscode-focusBorder, #007fd4);
  border-radius: 4px;
  pointer-events: none;
}
.rigline-edit-target-over {
  border-style: solid;
  background: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 10%, transparent);
}
.rigline-edit-marker {
  position: fixed;
  z-index: 2147483646;
  width: 2px;
  background: var(--vscode-focusBorder, #007fd4);
  pointer-events: none;
}
.rigline-edit-ghost {
  position: fixed;
  z-index: 2147483647;
  padding: 1px 6px;
  border: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
  border-radius: 4px;
  background: var(--app-menu-background, var(--vscode-menu-background, #252526));
  color: var(--app-primary-foreground, var(--vscode-foreground, #cccccc));
  box-shadow: 0 4px 16px var(--vscode-widget-shadow, transparent);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
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

/** A place the dragged element may be dropped. */
interface Target {
  /** As the file spells it. */
  readonly place: string;
  readonly rect: Box;
  /** The boxes of the elements it shows, in the order it shows them. */
  readonly boxes: readonly Box[];
  /** Each box's position among everything the place shows, boxed or not. */
  readonly indices: readonly number[];
  /** The marker while the place shows nothing. */
  readonly empty: Box;
}

interface Frame {
  readonly handles: readonly Handle[];
  readonly tray: readonly Chip[];
  readonly bar: CSSProperties;
  /** While dragging: the places the element offers that this panel has. */
  readonly targets: readonly Target[];
  /** While dragging an element that is not off: the bar, where a drop switches it off. */
  readonly off: Box | null;
}

/** Where a drop at the pointer would land. */
interface Landing {
  readonly place: string;
  readonly index: number;
  readonly marker: Box | null;
}

interface Drag {
  readonly name: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
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

/** How far a pressed handle moves before the press is a drag rather than a click. */
const DRAG_FROM = 4;

/** How far a slot's target reaches past the elements in it, so an empty slot has one. */
const BAND = 16;

const UNMEASURED: Frame = {
  handles: [],
  tray: [],
  bar: { visibility: "hidden" },
  targets: [],
  off: null,
};

function rectOf(node: Element): Box {
  const r = node.getBoundingClientRect();
  return {
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

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

/** A slot's target: its elements, and a band at the edge of what they are placed against. */
function slotTarget(
  place: Extract<PanelPlace, { readonly selector: string }>,
  boxes: readonly Box[],
  indices: readonly number[],
): Target | null {
  const anchor = document.querySelector(place.selector);
  if (anchor === null) return null;
  const step = (e: Element): Element | null =>
    place.at === "before" ? e.previousElementSibling : e.nextElementSibling;
  let edge = anchor;
  // Rigline's own mounts at the anchor, the RIG pill, sit between it and every element.
  if (place.at !== "inside") {
    for (let s = step(edge); s?.getAttribute("data-rigline-mount") === "rigline"; s = step(s)) {
      edge = s;
    }
  }
  const e = rectOf(edge);
  const band =
    place.at === "inside"
      ? e
      : place.at === "before"
        ? { left: e.left - BAND, top: e.top, width: BAND, height: e.height }
        : { left: e.left + e.width, top: e.top, width: BAND, height: e.height };
  const x =
    place.at === "before" ? e.left - 2 : place.at === "after" ? e.left + e.width : e.left + 4;
  return {
    place: place.place,
    rect: union(band, ...boxes),
    boxes,
    indices,
    empty: { left: x, top: e.top, width: 2, height: e.height },
  };
}

function targetsFor(
  name: string,
  view: readonly ViewPlace[],
  places: readonly PanelPlace[],
  boxes: ReadonlyMap<string, Box>,
): Target[] {
  const group = view.find((g) => g.elements.some((e) => e.name === name));
  const element = group?.elements.find((e) => e.name === name);
  if (group === undefined || element === undefined) return [];
  const offered = new Set(group.place === OFF ? element.also : [group.place, ...element.also]);
  const targets: Target[] = [];
  for (const p of places) {
    if (!offered.has(p.place)) continue;
    const boxed: Box[] = [];
    const indices: number[] = [];
    (view.find((g) => g.place === p.place)?.elements ?? []).forEach((e, i) => {
      const box = boxes.get(e.name);
      if (box === undefined) return;
      boxed.push(box);
      indices.push(i);
    });
    if ("zone" in p) {
      if (!p.zone.isConnected) continue;
      const rect = rectOf(p.zone);
      const empty = { left: rect.left + 2, top: rect.top + 4, width: 2, height: rect.height - 8 };
      targets.push({ place: p.place, rect, boxes: boxed, indices, empty });
    } else {
      const target = slotTarget(p, boxed, indices);
      if (target !== null) targets.push(target);
    }
  }
  return targets;
}

function measure(
  view: readonly ViewPlace[],
  readings: ReadonlyMap<string, ElementReading>,
  composer: Element | null,
  places: readonly PanelPlace[],
  bar: Element | null,
  dragging: string | null,
): Frame {
  const handles: Handle[] = [];
  const tray: Chip[] = [];
  const boxes = new Map<string, Box>();
  let draggingOff = false;
  for (const group of view) {
    for (const { name, title } of group.elements) {
      if (name === dragging) draggingOff = group.place === OFF;
      const box = group.place === OFF ? null : boxOf(name);
      if (box !== null) {
        handles.push({ name, title, box });
        boxes.set(name, box);
      } else {
        tray.push({ name, title, why: whyAway(group.place, readings.get(name)) });
      }
    }
  }
  return {
    handles: readingOrder(handles),
    tray,
    bar: barAt(composer),
    targets: dragging === null ? [] : targetsFor(dragging, view, places, boxes),
    off: dragging === null || draggingOff || bar === null ? null : rectOf(bar),
  };
}

/** The target under `x`, `y`, where in it a drop would land, and the marker that says so. */
function landing(frame: Frame, x: number, y: number): Landing | null {
  if (frame.off !== null && contains(frame.off, x, y)) {
    return { place: OFF, index: 0, marker: null };
  }
  const target = frame.targets.find((t) => contains(t.rect, x, y));
  if (target === undefined) return null;
  const k = insertionIndex(target.boxes, x, y);
  const before = target.boxes[k];
  const last = target.boxes.at(-1);
  const marker =
    before !== undefined
      ? { left: before.left - 1, top: before.top, width: 2, height: before.height }
      : last !== undefined
        ? { left: last.left + last.width - 1, top: last.top, width: 2, height: last.height }
        : target.empty;
  const index = target.indices[k] ?? (target.indices.at(-1) ?? -1) + 1;
  return { place: target.place, index, marker };
}

export interface EditLayerProps {
  readonly editor: LayoutEditor;
  readonly readings: ReadonlyMap<string, ElementReading>;
  readonly places: Store<readonly PanelPlace[]>;
  readonly composer: () => Element | null;
  /** Leaves the mode and puts focus back on the pill. */
  readonly onLeave: () => void;
  readonly onError: (reason: string) => void;
}

export function EditLayer(props: EditLayerProps): ReactNode {
  const { editor, readings, places, composer, onLeave, onError } = props;
  const [frame, setFrame] = useState<Frame>(UNMEASURED);
  const [active, setActive] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLFieldSetElement>(null);
  /** Each element's handle or chip, whichever it has now. */
  const nodes = useRef(new Map<string, HTMLElement>());
  const entered = useRef(false);
  /** Where the pointer went down on a handle or chip, until it is a drag or a click. */
  const press = useRef<{ readonly pointer: number; readonly x: number; readonly y: number } | null>(
    null,
  );
  /** The element being dragged, which the frame's measure finds targets for. */
  const dragging = useRef<string | null>(null);
  /** Set as a drag ends, so the click the browser then makes on the handle opens nothing. */
  const dragged = useRef(false);
  /** An element whose handle or chip takes focus once a frame shows it. */
  const refocus = useRef<string | null>(null);

  // Every frame, as the open menu follows the pill: a move, a fit stage or a resize each shifts
  // what a handle covers without saying so.
  useLayoutEffect(() => {
    let raf = 0;
    let last = "";
    const follow = (): void => {
      const next = measure(
        editor.view.get(),
        readings,
        composer(),
        places.get(),
        bar.current,
        dragging.current,
      );
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setFrame(next);
      }
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [editor, readings, places, composer]);

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

  useLayoutEffect(() => {
    const name = refocus.current;
    const node = name === null ? undefined : nodes.current.get(name);
    if (node === undefined) return;
    refocus.current = null;
    if (document.activeElement !== node) node.focus();
  });

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpened(null);
      if (restoreFocus && opened !== null) nodes.current.get(opened.name)?.focus();
    },
    [opened],
  );

  const endDrag = useCallback(() => {
    press.current = null;
    dragging.current = null;
    dragged.current = true;
    setDrag(null);
  }, []);

  // In capture on window, as the menu's keys are, and only while focus is on this layer, so an
  // open pop-over keeps its own.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && dragging.current !== null) {
        e.preventDefault();
        e.stopImmediatePropagation();
        endDrag();
        return;
      }
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
  }, [onLeave, endDrag]);

  const over = drag === null ? null : landing(frame, drag.x, drag.y);

  function item(name: string, title: string, kind: Kind) {
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
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        dragged.current = false;
        if (e.button !== 0) return;
        press.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
        const p = press.current;
        if (p === null || p.pointer !== e.pointerId) return;
        if (dragging.current === null) {
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_FROM) return;
          dragging.current = name;
          setOpened(null);
        }
        setDrag({ name, title, x: e.clientX, y: e.clientY });
      },
      onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
        if (dragging.current === null) {
          press.current = null;
          return;
        }
        const at = landing(frame, e.clientX, e.clientY);
        endDrag();
        if (at === null) return;
        refocus.current = name;
        editor.drop(name, at.place, at.index);
      },
      onPointerCancel: () => {
        if (dragging.current !== null) endDrag();
        press.current = null;
      },
      onClick: (e: MouseEvent<HTMLButtonElement>) => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
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
        {drag !== null &&
          frame.targets.map((t) => (
            <div
              key={t.place}
              className={
                over?.place === t.place
                  ? "rigline-edit-target rigline-edit-target-over"
                  : "rigline-edit-target"
              }
              data-rigline-place={t.place}
              style={{
                left: t.rect.left,
                top: t.rect.top,
                width: t.rect.width,
                height: t.rect.height,
              }}
            />
          ))}
        {frame.handles.map((h) => (
          <button
            key={h.name}
            {...item(h.name, h.title, "handle")}
            className={
              drag?.name === h.name
                ? "rigline-edit-handle rigline-edit-dragged"
                : "rigline-edit-handle"
            }
            aria-label={h.title}
            style={{ left: h.box.left, top: h.box.top, width: h.box.width, height: h.box.height }}
          >
            <span className="rigline-edit-title" aria-hidden="true">
              {h.title}
            </span>
          </button>
        ))}
        {over?.marker && (
          <div
            className="rigline-edit-marker"
            style={{ left: over.marker.left, top: over.marker.top, height: over.marker.height }}
          />
        )}
        {drag !== null && (
          <div className="rigline-edit-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
            {drag.title}
          </div>
        )}
        <Bar
          editor={editor}
          style={frame.bar}
          node={bar}
          target={drag === null || frame.off === null ? null : over?.place === OFF ? "over" : "on"}
          onLeave={onLeave}
        >
          {frame.tray.map((c) => (
            <button
              key={c.name}
              {...item(c.name, c.title, "chip")}
              className={
                drag?.name === c.name
                  ? "rigline-edit-chip rigline-edit-dragged"
                  : "rigline-edit-chip"
              }
            >
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
  readonly node: RefObject<HTMLFieldSetElement | null>;
  /** Whether a drag could switch its element off here, and whether it is over the bar now. */
  readonly target: "on" | "over" | null;
  readonly onLeave: () => void;
  readonly children?: ReactNode;
}): ReactNode {
  const { editor, style, node, target, onLeave, children } = props;
  const working = useStore(editor.working);
  const baseline = useStore(editor.baseline);
  const saving = useStore(editor.saving);
  const dirty = !sameLayout(working, baseline);
  const className =
    target === null
      ? "rigline-edit-bar"
      : target === "over"
        ? "rigline-edit-bar rigline-edit-bar-target rigline-edit-bar-over"
        : "rigline-edit-bar rigline-edit-bar-target";
  return (
    <fieldset ref={node} className={className} aria-label="Editing the layout" style={style}>
      <span className="rigline-edit-label">Layout</span>
      {children}
      {target !== null && <span className="rigline-edit-note">drop here to switch off</span>}
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
