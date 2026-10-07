/**
 * Rigline's own elements (D97): Edit in place and Reload saved layout as buttons a person places like
 * any plugin's element, each a small R and an icon, with the action's name as its tooltip.
 */
import { sameLayout } from "@rigline/plugin-api/internal";
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

/** Each pill's plain click is its own action and a modified one the other's (D124). */
export const riglineElements: RiglineElements = (editor) => {
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
  };
};
