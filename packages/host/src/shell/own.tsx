/**
 * Rigline's own elements (D97): Edit in place and Reload saved layout as buttons a person places like
 * any plugin's element, each a small R and an icon, with the action's name as its tooltip.
 */
import { sameLayout } from "@rigline/plugin-api";
import { Pill, useStore } from "@rigline/plugin-api/ui";
import type { ReactNode } from "react";
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
`;

const MOVE = "M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2";
const RELOAD = "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3";

function Mark(props: { readonly icon: string }): ReactNode {
  return (
    <span className="rigline-own">
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

export const riglineElements: RiglineElements = (editor) => ({
  edit: function RiglineEdit() {
    const editing = useStore(editor.editing);
    return (
      <Pill title="Edit in place" onClick={() => editor.editing.set(!editing)}>
        <Mark icon={MOVE} />
      </Pill>
    );
  },
  reload: function RiglineReload() {
    const working = useStore(editor.working);
    const baseline = useStore(editor.baseline);
    const dirty = !sameLayout(working, baseline);
    return (
      <Pill
        title={dirty ? "Revert changes" : "Reload saved layout"}
        onClick={() => void editor.reload()}
      >
        <Mark icon={RELOAD} />
      </Pill>
    );
  },
});
