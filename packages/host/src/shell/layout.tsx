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

/** The companion's id, which a Save link names as its authority. */
const COMPANION = "rigline.rigline";

const SAVE_NOTES: Record<Exclude<SaveState, "idle">, string> = {
  saving: "Saving through the Rigline companion…",
  saved: "Saved.",
  unconfirmed: "Could not confirm the save. Rigline's notification and output say why.",
};

/** A move, which keeps the menu open. */
const stay =
  (move: () => void) =>
  (e: MenuSelectEvent): void => {
    e.preventDefault();
    move();
  };

/** The submenu, bound to one editor, for the shell to add as its own menu entry. */
export function layoutMenu(
  editor: LayoutEditor,
  readings: ReadonlyMap<string, ElementReading>,
): () => ReactNode {
  return function LayoutMenu() {
    const view = useStore(editor.view);
    const working = useStore(editor.working);
    const baseline = useStore(editor.baseline);
    const newer = useStore(editor.newer);
    const saving = useStore(editor.saving);
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
                first={i === 0}
                last={i === group.elements.length - 1}
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

function Moves(props: {
  readonly editor: LayoutEditor;
  readonly element: ViewElement;
  readonly place: string;
  readonly first: boolean;
  readonly last: boolean;
  readonly reading: ElementReading | undefined;
}): ReactNode {
  const { editor, element, place, first, last, reading } = props;
  const { name } = element;
  const away = reading?.state === "elsewhere" || reading?.state === "unavailable";
  return (
    <Submenu label={element.title} description={away ? `${name} — not in this panel` : name}>
      {place !== OFF && !first && (
        <MenuItem label="Move up" onSelect={stay(() => editor.shift(name, -1))} />
      )}
      {place !== OFF && !last && (
        <MenuItem label="Move down" onSelect={stay(() => editor.shift(name, 1))} />
      )}
      {element.also.map((to) => (
        <MenuItem key={to} label={`Move to ${to}`} onSelect={stay(() => editor.move(name, to))} />
      ))}
      {place !== OFF && (
        <MenuItem label="Switch off" onSelect={stay(() => editor.move(name, OFF))} />
      )}
      {element.listed && (
        <MenuItem
          label="Back to where its plugin puts it"
          onSelect={stay(() => editor.move(name, null))}
        />
      )}
    </Submenu>
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
  const { save } = editor;
  if (save?.token && save.companion) {
    const payload = encodeSavePayload({ v: SAVE_PAYLOAD_VERSION, token: save.token, from, to });
    if (payload.length <= MAX_SAVE_PAYLOAD) {
      return (
        <MenuLink
          href={`${save.scheme}://${COMPANION}/layout?p=${payload}`}
          label="Save"
          description="to config.yaml, through the Rigline companion"
          onFollow={() => void editor.confirm(to)}
        />
      );
    }
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
function copyText(text: string): boolean {
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
