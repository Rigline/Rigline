/**
 * Saving a plugin's own settings from the panel (D138).
 *
 * A component rather than a function a plugin calls, because **nothing a plugin can call by itself
 * will ever write `config.yaml`**: a save travels as a `vscode:` link to the companion, and a click
 * that does not reach VS Code's own listener follows the href and leaves the panel on an error page
 * the host's guard exists to prevent (D93). So the click has to be a person's, on a real anchor, and
 * this renders that anchor around whatever the plugin draws — a star, a pill, a row. One real click
 * both does the thing and saves the settings that doing it produced.
 *
 * The section a save writes is **stamped by the host, not named by the plugin** (P9): the shell
 * provides the owning plugin's name beside the link builder, so an ordinary save names nothing.
 * `section` exists for the writer that is allowed to name one, and the host decides whether it may.
 */
import { createContext, type ReactNode, useContext } from "react";
import { FaultContext, message } from "./fault.ts";

export const SAVE_CSS = `
.rigline-ui-save {
  display: inline-flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
.rigline-ui-save-refused {
  cursor: default;
}
`;

/** A link for writing settings, or why there is none. */
export type SaveLink = { readonly href: string } | { readonly refused: string };

/**
 * What a settings save needs, which the shell provides around every contribution. Null where the
 * shell has not provided it, which is every copy of this module a plugin bundled for itself.
 */
export interface SettingsSaver {
  /** The contribution's owning plugin, which stamps the section a save without one writes. */
  readonly plugin: string;
  /** The link that writes `value`, or the reason this machine has none to offer. */
  readonly link: (value: Readonly<Record<string, unknown>>, section?: string) => SaveLink;
  /** Hears the link followed, so the panel can learn that the save landed. */
  readonly followed?: (value: Readonly<Record<string, unknown>>, section?: string) => void;
}

export const SettingsContext = createContext<SettingsSaver | null>(null);

/**
 * The saver Rigline's own contributions get: its layout is not a plugin's section, so they save no
 * settings. Rigline's own settings go through its settings tab's draft, not through this.
 */
export const NO_SAVER: SettingsSaver = {
  plugin: "rigline",
  link: () => ({ refused: "Rigline's own elements do not save plugin settings" }),
};

export interface SaveSettingsProps {
  /** What the person clicks: this plugin's own control, whatever it draws. */
  readonly children: ReactNode;
  /** The whole section to write, as the click would leave it. Absent keys are deleted. */
  readonly value: Readonly<Record<string, unknown>>;
  /** Another plugin's section. Omit it: the host stamps this plugin's own, and may refuse yours. */
  readonly section?: string;
  /** The tooltip while a save is possible. The refusal's reason replaces it when one is not. */
  readonly title?: string;
  /** Called as the link is followed, for whatever else the click does. */
  readonly onSave?: () => void;
}

/**
 * The anchor a settings save travels on, around the plugin's own control.
 *
 * Where no save is possible — no companion, no token, or a section past what a link carries — the
 * children render with the reason as their tooltip and no link, rather than a link that does
 * nothing: a save that silently fails is the one outcome this whole path is built to avoid.
 */
export function SaveSettings(props: SaveSettingsProps): ReactNode {
  const { children, value, section, title, onSave } = props;
  const saver = useContext(SettingsContext);
  const fault = useContext(FaultContext);
  const link: SaveLink = saver
    ? saver.link(value, section)
    : { refused: "Rigline did not provide a way to save; this panel may be running an older host" };
  if ("refused" in link) {
    return (
      <span className="rigline-ui-save rigline-ui-save-refused" title={link.refused}>
        {children}
      </span>
    );
  }
  return (
    // Neither prevented nor stopped: VS Code acts only on a click that reaches its own listener,
    // and the host's capture-phase guard cancels the navigation (D93).
    <a
      href={link.href}
      className="rigline-ui-save"
      title={title}
      onClick={() => {
        saver?.followed?.(value, section);
        try {
          onSave?.();
        } catch (e) {
          fault(`its settings save threw: ${message(e)}`);
        }
      }}
    >
      {children}
    </a>
  );
}
