/**
 * A pill: the app's model pill's look, on its own tokens, in monospace for the identifiers and counts
 * a pill usually carries, so an element looks at home in the footer or in `rigRow`.
 */
import { type AriaAttributes, type MouseEvent, type ReactNode, type Ref, useContext } from "react";
import { FaultContext, message } from "./fault.ts";

export const PILL_CSS = `
.rigline-ui-pill {
  display: inline-grid;
  align-items: center;
  justify-items: center;
  box-sizing: border-box;
  min-height: var(--app-pill-min-height, 18px);
  padding: 0 8px;
  border: none;
  border-radius: 9999px;
  background: var(--app-pill-background, color-mix(in srgb, currentColor 10%, transparent));
  color: var(--app-pill-foreground, inherit);
  font-family: var(--app-monospace-font-family, var(--vscode-editor-font-family, monospace));
  font-size: 0.85em;
  line-height: 1;
  white-space: nowrap;
}
.rigline-ui-pill-content,
.rigline-ui-pill-flash {
  grid-area: 1 / 1;
}
.rigline-ui-pill-content {
  display: inline-flex;
  align-items: center;
}
.rigline-ui-pill-flashing > .rigline-ui-pill-content {
  visibility: hidden;
}
button.rigline-ui-pill {
  cursor: pointer;
}
button.rigline-ui-pill:hover {
  background: var(--app-pill-hover-background, color-mix(in srgb, currentColor 18%, transparent));
}
.rigline-ui-pill-muted {
  color: color-mix(in srgb, var(--app-pill-foreground, currentColor) 50%, transparent);
}
.rigline-ui-pill-group {
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
  border-radius: 9999px;
  background: var(--app-pill-background, color-mix(in srgb, currentColor 10%, transparent));
}
.rigline-ui-pill-group > .rigline-ui-pill {
  border-radius: 0;
  background: none;
}
.rigline-ui-pill-group > .rigline-ui-pill + .rigline-ui-pill {
  border-left: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}
.rigline-ui-pill-group > button.rigline-ui-pill:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.rigline-ui-pill-current,
button.rigline-ui-pill-current:hover,
.rigline-ui-pill-group > .rigline-ui-pill-current,
.rigline-ui-pill-group > button.rigline-ui-pill-current:hover {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #ffffff);
}
`;

/** Also takes ARIA attributes, which reach the element. */
export interface PillProps extends AriaAttributes {
  readonly children?: ReactNode;
  /** The tooltip. */
  readonly title?: string;
  /** Fainter, for a pill holding its place until it has something to say. */
  readonly muted?: boolean;
  /** Highlighted as the one in effect among a row of alternatives, and `aria-current` with it. */
  readonly current?: boolean;
  /**
   * Shown over the children while set, as `useFlash` gives it. The pill is as wide as the wider of
   * the two, so a flash no wider than the children moves nothing.
   */
  readonly flash?: string | null;
  /** Makes the pill a button. A throw disables the plugin, as a render throw does. */
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** The span, or the button when there is `onClick`. */
  readonly ref?: Ref<HTMLElement>;
}

export function Pill(props: PillProps): ReactNode {
  const { children, title, muted, current, flash, onClick, ref, ...rest } = props;
  // ARIA alone, whatever the caller passes, so the element's surface is the type's (D109).
  const aria = {
    ...Object.fromEntries(Object.entries(rest).filter(([key]) => key.startsWith("aria-"))),
    ...(current === true ? { "aria-current": true } : {}),
  };
  const fault = useContext(FaultContext);
  const shown = flash ?? null;
  const className = [
    "rigline-ui-pill",
    muted === true ? "rigline-ui-pill-muted" : "",
    current === true ? "rigline-ui-pill-current" : "",
    shown === null ? "" : "rigline-ui-pill-flashing",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="rigline-ui-pill-content">{children}</span>
      {shown !== null && <span className="rigline-ui-pill-flash">{shown}</span>}
    </>
  );
  if (onClick === undefined) {
    return (
      <span {...aria} ref={ref} className={className} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button
      {...aria}
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      className={className}
      title={title}
      onClick={(event) => {
        try {
          onClick(event);
        } catch (e) {
          fault(`its pill's click handler threw: ${message(e)}`);
        }
      }}
    >
      {content}
    </button>
  );
}

export interface PillGroupProps {
  /** Pills, drawn as the segments of one. */
  readonly children?: ReactNode;
  /** What the group is, for a screen reader: "Model favourites". */
  readonly label?: string;
}

/** Pills as one pill split into segments, for one choice among several. */
export function PillGroup(props: PillGroupProps): ReactNode {
  return (
    <span role="group" aria-label={props.label} className="rigline-ui-pill-group">
      {props.children}
    </span>
  );
}
