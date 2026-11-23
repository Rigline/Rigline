/**
 * Rigline's own elements (D97): Edit in place and Reload saved layout as buttons a person places like
 * any plugin's element, each a small R and an icon, with the action's name as its tooltip; and the
 * editor-context chip, which a person ticks to send the editor's state with one message (D150).
 */
import { type Attachable, fileName, sameLayout } from "@rigline/plugin-api/internal";
import { Pill, useStore } from "@rigline/plugin-api/ui";
import type { MouseEvent, ReactNode } from "react";
import type { RiglineElements } from "./types.ts";

export const OWN_CSS = `
.rigline-own {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rigline-own-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: #2d7d46;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}
.rigline-own-newer .rigline-own-mark {
  background: var(--vscode-editorWarning-foreground, #cca700);
  color: #000;
}
.rigline-attach {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 26px;
  color: var(--app-secondary-foreground, var(--vscode-descriptionForeground));
  font-size: 0.85em;
  cursor: pointer;
}
.rigline-attach::before {
  content: "";
  flex-shrink: 0;
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--app-input-border, var(--vscode-widget-border, #7f7f7f33));
}
.rigline-attach input {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin: 0;
  accent-color: var(--vscode-checkbox-selectBackground, var(--vscode-focusBorder));
  cursor: pointer;
}
.rigline-attach-name {
  overflow: hidden;
  max-width: 200px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rigline-attach-ticked .rigline-attach-name {
  color: var(--vscode-foreground);
}
`;

const MOVE = "M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2";
const RELOAD = "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3";

function Mark(props: { readonly icon: string; readonly newer: boolean }): ReactNode {
  return (
    <span className={props.newer ? "rigline-own rigline-own-newer" : "rigline-own"}>
      <span className="rigline-own-mark" aria-hidden="true">
        R
      </span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={props.icon} />
      </svg>
    </span>
  );
}

/** Cmd on a Mac, where a Ctrl-click is a right click and never reaches `onClick` (D124). */
function modifier(): string {
  return navigator.platform.startsWith("Mac") ? "Cmd" : "Ctrl";
}

/** The chip's text: the file, and the lines where some are selected. */
function attachLabel(available: Attachable): string {
  const { lines } = available;
  const name = fileName(available.path);
  if (lines === null) return name;
  return lines.start === lines.end
    ? `${name}:${lines.start}`
    : `${name}:${lines.start}-${lines.end}`;
}

/** Claude Code's own chip's tooltip, word for word: the checkbox says whether it goes. */
function attachTitle(available: Attachable): string {
  const { lines } = available;
  const count = lines === null ? 0 : lines.end - lines.start + 1;
  const what =
    lines === null
      ? fileName(available.path)
      : `${count} ${count === 1 ? "line" : "lines"} selected`;
  return `Showing Claude your current file selection (${what})`;
}

/** Each pill's plain click is its own action and a modified one the other's (D124). */
export const riglineElements: RiglineElements = (editor, attach) => {
  function useActions() {
    const editing = useStore(editor.editing);
    const newer = useStore(editor.newer);
    const dirty = !sameLayout(useStore(editor.working), useStore(editor.baseline));
    return {
      newer,
      reloadTitle: dirty ? "Revert changes" : "Reload saved layout",
      /** The action's name, whether there is a newer layout to get (D126), and the modified click. */
      title: (name: string, other: string) =>
        [name, newer && "A newer layout is saved", `${modifier()}-click to ${other}`]
          .filter(Boolean)
          .join("\n"),
      edit: () => editor.editing.set(!editing),
      reload: () => void editor.reload(),
    };
  }
  const modified = (e: MouseEvent) => e.ctrlKey || e.metaKey;
  return {
    edit: function RiglineEdit() {
      const actions = useActions();
      return (
        <Pill
          title={actions.title("Edit in place", actions.reloadTitle.toLowerCase())}
          onClick={(e) => (modified(e) ? actions.reload : actions.edit)()}
        >
          <Mark icon={MOVE} newer={actions.newer} />
        </Pill>
      );
    },
    reload: function RiglineReload() {
      const actions = useActions();
      return (
        <Pill
          title={actions.title(actions.reloadTitle, "edit in place")}
          onClick={(e) => (modified(e) ? actions.edit : actions.reload)()}
        >
          <Mark icon={RELOAD} newer={actions.newer} />
        </Pill>
      );
    },
    // In Claude Code's chip's place, which the kernel hides while this is drawn (D150).
    editor: function RiglineEditorContext() {
      const { available, ticked } = useStore(attach.state);
      if (available === null) return null;
      return (
        <label
          className={ticked ? "rigline-attach rigline-attach-ticked" : "rigline-attach"}
          title={attachTitle(available)}
          // The composer keeps the focus, so ticking does not interrupt the prompt being typed.
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            type="checkbox"
            checked={ticked}
            onChange={(e) => attach.toggle(e.nativeEvent)}
            data-rigline-attach=""
          />
          <span className="rigline-attach-name">{attachLabel(available)}</span>
        </label>
      );
    },
  };
};
