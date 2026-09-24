/**
 * A pill: the small monospace label the composer's rows are made of, drawn on the app's tokens so an
 * element looks at home in the footer or in `rigRow`.
 */
import { type ReactNode, useContext } from "react";
import { FaultContext, message } from "./fault.ts";

export const PILL_CSS = `
.rigline-ui-pill {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  border: none;
  background: none;
  color: inherit;
  font: 10px/1.6 var(--app-monospace-font-family, var(--vscode-editor-font-family, monospace));
  letter-spacing: 0.02em;
  white-space: nowrap;
  opacity: 0.65;
}
button.rigline-ui-pill {
  cursor: pointer;
}
.rigline-ui-pill-muted {
  opacity: 0.35;
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
