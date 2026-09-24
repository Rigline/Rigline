/**
 * A pill: the app's model pill's look, on its own tokens, in monospace for the identifiers and counts
 * a pill usually carries, so an element looks at home in the footer or in `rigRow`.
 */
import { type ReactNode, useContext } from "react";
import { FaultContext, message } from "./fault.ts";

export const PILL_CSS = `
.rigline-ui-pill {
  display: inline-flex;
  align-items: center;
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
button.rigline-ui-pill {
  cursor: pointer;
}
button.rigline-ui-pill:hover {
  background: var(--app-pill-hover-background, color-mix(in srgb, currentColor 18%, transparent));
}
.rigline-ui-pill-muted {
  color: color-mix(in srgb, var(--app-pill-foreground, currentColor) 50%, transparent);
}
`;

export interface PillProps {
  readonly children?: ReactNode;
  /** The tooltip. */
  readonly title?: string;
  /** Fainter, for a pill holding its place until it has something to say. */
  readonly muted?: boolean;
  /** Makes the pill a button. A throw disables the plugin, as a render throw does. */
  readonly onClick?: () => void;
}

export function Pill(props: PillProps): ReactNode {
  const { children, title, muted, onClick } = props;
  const fault = useContext(FaultContext);
  const className = muted === true ? "rigline-ui-pill rigline-ui-pill-muted" : "rigline-ui-pill";
  if (onClick === undefined) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={() => {
        try {
          onClick();
        } catch (e) {
          fault(`its pill's click handler threw: ${message(e)}`);
        }
      }}
    >
      {children}
    </button>
  );
}
