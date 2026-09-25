/**
 * The Layout submenu (D93): every element by where the working copy puts it, the moves each can
 * make, Save, and Reload. Every move keeps the menu open, and the panel behind it is the preview.
 */
import {
  encodeSavePayload,
  type Layout,
  layoutCommands,
  MAX_SAVE_PAYLOAD,
  OFF,
  SAVE_PAYLOAD_VERSION,
  type Store,
  sameLayout,
  type ViewElement,
} from "@rigline/plugin-api";
import {
  MenuItem,
  MenuNote,
  type MenuSelectEvent,
  Submenu,
  useStore,
} from "@rigline/plugin-api/ui";
import { MenuLink } from "@rigline/plugin-api/ui/internal";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import type { LayoutEditor, SaveState } from "../kernel/layout.ts";
import type { ElementReading } from "../kernel/shell.ts";
import type { PanelPlace } from "./types.ts";

/** The companion's id, which a Save link names as its authority. */
const COMPANION = "rigline.rigline";

export const SAVE_NOTES: Record<Exclude<SaveState, "idle">, string> = {
  saving: "Saving through the Rigline companion…",
  saved: "Saved.",
  unconfirmed:
    "Not confirmed. Rigline's notification says why; with none, the companion never got the save.",
};

/** A move, which keeps the menu open. */
const stay =
  (move: () => void) =>
  (e: MenuSelectEvent): void => {
    e.preventDefault();
    move();
  };

/** Save's link where a companion answers and the copy fits in one, else null for Copy commands. */
export function saveHref(editor: LayoutEditor, from: Layout, to: Layout): string | null {
  const { save } = editor;
  if (!save?.token || !save.companion) return null;
  const payload = encodeSavePayload({ v: SAVE_PAYLOAD_VERSION, token: save.token, from, to });
  if (payload.length > MAX_SAVE_PAYLOAD) return null;
  return `${save.scheme}://${COMPANION}/layout?p=${payload}`;
}

/** The submenu, bound to one editor, for the shell to add as its own menu entry. */
export function layoutMenu(
  editor: LayoutEditor,
  readings: ReadonlyMap<string, ElementReading>,
  places: Store<readonly PanelPlace[]>,
): () => ReactNode {
  return function LayoutMenu() {
    const view = useStore(editor.view);
    const working = useStore(editor.working);
    const baseline = useStore(editor.baseline);
    const newer = useStore(editor.newer);
    const saving = useStore(editor.saving);
    const editing = useStore(editor.editing);
    const placeable = useStore(places).length > 0;
    // The menu mounts this on every opening: the one moment a person is looking.
    useEffect(() => {
      void editor.check();
    }, []);
    const dirty = !sameLayout(working, baseline);
    return (
      <Submenu
        label="Layout"
        description={dirty ? "unsaved changes" : newer ? "a newer layout is saved" : undefined}
      >
        {placeable && (
          <MenuItem
            label="Edit in place"
            checked={editing}
            onSelect={() => editor.editing.set(!editing)}
          />
        )}
        {saving !== "idle" && <MenuNote>{SAVE_NOTES[saving]}</MenuNote>}
        {view.map((group) => (
          <Fragment key={group.place}>
            <MenuNote>{group.place}</MenuNote>
            {group.elements.map((element, i) => (
              <Moves
                key={element.name}
                editor={editor}
                element={element}
                place={group.place}
                before={group.elements[i - 1]}
                after={group.elements[i + 1]}
                reading={readings.get(element.name)}
              />
            ))}
          </Fragment>
        ))}
        <hr className="rigline-menu-divider" />
        {dirty && <Save editor={editor} from={baseline} to={working} />}
        <MenuItem
          label={dirty ? "Revert changes" : "Reload saved layout"}
          description={dirty ? undefined : "picks up a layout saved elsewhere"}
          onSelect={stay(() => void editor.reload())}
        />
      </Submenu>
    );
  };
}

interface Where {
  readonly editor: LayoutEditor;
  readonly element: ViewElement;
  readonly place: string;
  /** Its neighbours in the order its place shows, which a move names rather than a direction. */
  readonly before: ViewElement | undefined;
  readonly after: ViewElement | undefined;
}

function Moves(props: Where & { readonly reading: ElementReading | undefined }): ReactNode {
  const { element, reading } = props;
  const away = reading?.state === "elsewhere" || reading?.state === "unavailable";
  return (
    <Submenu
      label={element.title}
      description={away ? `${element.name} — not in this panel` : element.name}
    >
      <MoveItems {...props} />
    </Submenu>
  );
}

/** One element's moves, found afresh in the working copy, for a handle's pop-over (D95). */
export function movesOf(editor: LayoutEditor, name: string): () => ReactNode {
  return function ElementMoves() {
    const view = useStore(editor.view);
    for (const group of view) {
      const i = group.elements.findIndex((e) => e.name === name);
      const element = group.elements[i];
      if (element === undefined) continue;
      return (
        <>
          <MenuNote>
            {element.title} — {group.place}
          </MenuNote>
          <MoveItems
            editor={editor}
            element={element}
            place={group.place}
            before={group.elements[i - 1]}
            after={group.elements[i + 1]}
          />
        </>
      );
    }
    return <MenuNote>No longer in the layout</MenuNote>;
  };
}

function MoveItems(props: Where): ReactNode {
  const { editor, element, place, before, after } = props;
  const { name } = element;
  return (
    <>
      {place !== OFF && before !== undefined && (
        <MenuItem
          label={`Move before ${before.title}`}
          onSelect={stay(() => editor.shift(name, -1))}
        />
      )}
      {place !== OFF && after !== undefined && (
        <MenuItem
          label={`Move after ${after.title}`}
          onSelect={stay(() => editor.shift(name, 1))}
        />
      )}
      {element.also.map((to) => (
        <MenuItem key={to} label={`Move to ${to}`} onSelect={stay(() => editor.move(name, to))} />
      ))}
      {place !== OFF && (
        <MenuItem label="Switch off" onSelect={stay(() => editor.move(name, OFF))} />
      )}
      {element.listed && (
        <MenuItem
          label="Plugin default"
          description={element.defaultPlace}
          onSelect={stay(() => editor.move(name, null))}
        />
      )}
    </>
  );
}

/** A link to the companion where one answers, else the commands that make the same change. */
function Save(props: {
  readonly editor: LayoutEditor;
  readonly from: Layout;
  readonly to: Layout;
}): ReactNode {
  const { editor, from, to } = props;
  const [copied, setCopied] = useState<boolean | null>(null);
  const href = saveHref(editor, from, to);
  if (href !== null) {
    return (
      <MenuLink
        href={href}
        label="Save"
        description="to config.yaml, through the Rigline companion"
        onFollow={() => void editor.confirm(to)}
      />
    );
  }
  return (
    <MenuItem
      label="Copy commands"
      description={
        copied === null
          ? "that save this layout, to run in a terminal"
          : copied
            ? "copied: run them, then Reload saved layout"
            : "the copy failed"
      }
      onSelect={stay(() => setCopied(copyText(layoutCommands(from, to).join("\n"))))}
    />
  );
}

/**
 * Copies over a hidden textarea rather than the async Clipboard API, which needs a permission a
 * webview may not hold, and puts focus back so the menu's keys still work.
 */
export function copyText(text: string): boolean {
  const back = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  if (back instanceof HTMLElement) back.focus();
  return ok;
}
