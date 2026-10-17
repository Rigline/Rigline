/**
 * Rigline's settings screen: a tab for Rigline and one for each plugin that adds one, over the
 * drafts the settings editor holds, with one Save that writes every tab that differs from what is
 * saved. Drawn over the whole panel, which is often sidebar-wide, so the rail beside the tab becomes
 * a list leading into it where there is no room for both.
 */
import { sameValue } from "@rigline/plugin-api/internal";
import { useStore } from "@rigline/plugin-api/ui";
import {
  DraftContext,
  FaultContext,
  type SettingsDraft,
  SettingsContext,
} from "@rigline/plugin-api/ui/internal";
import {
  Component,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SettingsEditor } from "../kernel/settings.ts";
import { SAVE_NOTES } from "./layout.tsx";
import type { SettingsTab } from "./types.ts";

export const SCREEN_CSS = `
.rigline-settings {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  container: rigline-settings / inline-size;
  background: var(--app-root-background, var(--app-primary-background, var(--vscode-sideBar-background, #1e1e1e)));
  color: var(--app-primary-foreground, var(--vscode-foreground, #cccccc));
  font-family: var(--vscode-font-family, inherit);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.4;
}
.rigline-settings-head,
.rigline-settings-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
}
.rigline-settings-head {
  border-bottom: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
}
.rigline-settings-foot {
  border-top: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
}
.rigline-settings-title {
  flex: 1;
  margin: 0;
  font-size: 1.1em;
  font-weight: 600;
}
.rigline-settings-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.rigline-settings-rail {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 1px;
  width: 170px;
  padding: 8px;
  overflow-y: auto;
  border-right: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f66));
}
.rigline-settings-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rigline-settings-tab:hover {
  background: var(--app-list-hover-background, var(--vscode-list-hoverBackground));
}
.rigline-settings-tab[aria-selected="true"] {
  background: var(--app-list-active-background, var(--vscode-list-activeSelectionBackground));
  color: var(--app-list-active-foreground, var(--vscode-list-activeSelectionForeground));
}
.rigline-settings-tab:focus-visible,
.rigline-settings-button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -1px;
}
.rigline-settings-tab-title {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.rigline-settings-dirty {
  font-size: 0.8em;
}
.rigline-settings-panel {
  flex: 1;
  min-width: 0;
  padding: 4px 16px 16px;
  overflow-y: auto;
}
.rigline-settings-note {
  color: var(--app-secondary-foreground, var(--vscode-descriptionForeground));
  font-size: 0.9em;
}
.rigline-settings-panel > .rigline-settings-note {
  margin: 8px 0 0;
}
.rigline-settings-gap {
  flex: 1;
}
.rigline-settings-button {
  display: inline-flex;
  align-items: center;
  padding: 3px 12px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 2px;
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ffffff);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
.rigline-settings-button:hover {
  background: var(--vscode-button-secondaryHoverBackground, #45494e);
}
.rigline-settings-primary {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #ffffff);
}
.rigline-settings-primary:hover {
  background: var(--vscode-button-hoverBackground, #1177bb);
}
.rigline-settings-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.rigline-settings-icon {
  padding: 2px 8px;
  background: none;
}
.rigline-settings-back {
  display: none;
}
@container rigline-settings (max-width: 480px) {
  .rigline-settings-rail {
    flex: 1;
    width: auto;
    border-right: none;
  }
  .rigline-settings[data-entered] .rigline-settings-rail,
  .rigline-settings:not([data-entered]) .rigline-settings-panel {
    display: none;
  }
  .rigline-settings[data-entered] .rigline-settings-back {
    display: inline-flex;
  }
}
`;

/** One tab, which takes only its own plugin down with it when it throws. */
class TabBoundary extends Component<
  { readonly tab: SettingsTab; readonly draft: SettingsDraft },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.tab.onError(
      `its settings tab threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  override render(): ReactNode {
    if (this.state.failed) return null;
    const { tab, draft } = this.props;
    const Contributed = tab.component as () => ReactNode;
    return (
      <SettingsContext.Provider value={tab.saver}>
        <FaultContext.Provider value={tab.onError}>
          <DraftContext.Provider value={draft}>
            <Contributed />
          </DraftContext.Provider>
        </FaultContext.Provider>
      </SettingsContext.Provider>
    );
  }
}

/** `owner`'s draft as its tab reads and writes it, stamped with `owner` by being made here. */
function draftOf(settings: SettingsEditor, owner: string): SettingsDraft {
  return {
    owner,
    get: () => settings.value(owner),
    set(next) {
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        throw new TypeError("setDraft takes an object: the whole of this tab's settings");
      }
      settings.set(owner, next);
    },
    subscribe(onChange) {
      const drafts = settings.drafts.subscribe(onChange);
      const saved = settings.saved.subscribe(onChange);
      return () => {
        drafts();
        saved();
      };
    },
  };
}

/** Save: the link where one can be made, else the reason there is none. */
function Save(props: { readonly settings: SettingsEditor }): ReactNode {
  const { settings } = props;
  const drafts = useStore(settings.drafts);
  if (drafts.size === 0) {
    return (
      <button type="button" className="rigline-settings-button rigline-settings-primary" disabled>
        Save
      </button>
    );
  }
  const link = settings.link();
  if ("refused" in link) {
    return (
      <button
        type="button"
        className="rigline-settings-button rigline-settings-primary"
        disabled
        title={link.refused}
      >
        Save
      </button>
    );
  }
  const sent = new Map([...drafts].map(([owner, draft]) => [owner, draft.to]));
  return (
    // Neither prevented nor stopped: VS Code acts only on a click that reaches its listener (D93).
    <a
      href={link.href}
      className="rigline-settings-button rigline-settings-primary"
      title="to config.yaml, through the Rigline companion"
      onClick={() => void settings.confirm(sent)}
    >
      Save
    </a>
  );
}

export function SettingsScreen(props: {
  readonly settings: SettingsEditor;
  readonly tabs: readonly SettingsTab[];
  readonly onClose: () => void;
}): ReactNode {
  const { settings, tabs, onClose } = props;
  const open = useStore(settings.open);
  const drafts = useStore(settings.drafts);
  // Read for the re-render: what is saved decides the notes below.
  useStore(settings.saved);
  const saving = useStore(settings.saving);
  // Opened at no tab in particular, a narrow screen starts on the list.
  const [entered, setEntered] = useState(open !== "");
  const id = useId();
  const screen = useRef<HTMLDivElement>(null);
  const current = tabs.find((t) => t.owner === open) ?? tabs[0];
  const draft = useMemo(
    () => (current === undefined ? null : draftOf(settings, current.owner)),
    [settings, current],
  );

  // Back to whatever had focus, on the way out.
  useEffect(() => {
    const before = document.activeElement;
    screen.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  // In capture, as the menu's keys are, so the app's own Escape handlers never see it.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function choose(owner: string): void {
    settings.open.set(owner);
    setEntered(true);
  }

  /** A vertical tablist: the arrows, Home and End move along it and choose as they go. */
  function onRailKey(e: KeyboardEvent<HTMLDivElement>): void {
    const i = tabs.findIndex((t) => t === current);
    const to =
      e.key === "ArrowDown"
        ? tabs[(i + 1) % tabs.length]
        : e.key === "ArrowUp"
          ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === "Home"
            ? tabs[0]
            : e.key === "End"
              ? tabs.at(-1)
              : undefined;
    if (to === undefined) return;
    e.preventDefault();
    settings.open.set(to.owner);
    e.currentTarget
      .querySelector<HTMLElement>(`[data-rigline-tab="${CSS.escape(to.owner)}"]`)
      ?.focus();
  }

  const dirty = drafts.size > 0;
  const link = dirty ? settings.link() : null;
  const pending = current === undefined ? undefined : drafts.get(current.owner);
  // The file moved under this tab's draft since it began: saving writes over that.
  const moved =
    pending !== undefined &&
    current !== undefined &&
    !sameValue(pending.from, settings.savedOf(current.owner));
  const unsaveable = current === undefined ? null : settings.unsaveable(current.owner);

  return (
    <div
      ref={screen}
      className="rigline-settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}title`}
      data-entered={entered ? "" : undefined}
    >
      <div className="rigline-settings-head">
        <button
          type="button"
          className="rigline-settings-button rigline-settings-icon rigline-settings-back"
          onClick={() => setEntered(false)}
        >
          ‹ All settings
        </button>
        <h2 className="rigline-settings-title" id={`${id}title`}>
          Rigline settings
        </h2>
        <button
          type="button"
          className="rigline-settings-button rigline-settings-icon"
          aria-label="Close"
          title="Close; unsaved changes are kept"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="rigline-settings-body">
        <div
          className="rigline-settings-rail"
          role="tablist"
          aria-orientation="vertical"
          onKeyDown={onRailKey}
        >
          {tabs.map((tab) => {
            const selected = tab === current;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`${id}tab${tab.key}`}
                className="rigline-settings-tab"
                data-rigline-tab={tab.owner}
                aria-selected={selected}
                aria-controls={`${id}panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(tab.owner)}
              >
                <span className="rigline-settings-tab-title">{tab.title}</span>
                {drafts.has(tab.owner) && (
                  <span
                    className="rigline-settings-dirty"
                    role="img"
                    aria-label="unsaved changes"
                    title="unsaved changes"
                  >
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {current !== undefined && draft !== null && (
          <div
            className="rigline-settings-panel"
            role="tabpanel"
            id={`${id}panel`}
            aria-labelledby={`${id}tab${current.key}`}
            data-rigline-panel={current.owner}
          >
            {unsaveable !== null && <p className="rigline-settings-note">{unsaveable}</p>}
            {moved && (
              <p className="rigline-settings-note">
                Saved elsewhere since you began; Save writes over it, Revert picks it up.
              </p>
            )}
            <TabBoundary key={current.key} tab={current} draft={draft} />
          </div>
        )}
      </div>
      <div className="rigline-settings-foot">
        {saving !== "idle" && <span className="rigline-settings-note">{SAVE_NOTES[saving]}</span>}
        {link !== null && "refused" in link && saving === "idle" && (
          <span className="rigline-settings-note">{link.refused}</span>
        )}
        <span className="rigline-settings-gap" />
        {dirty && (
          <button
            type="button"
            className="rigline-settings-button"
            onClick={() => void settings.revert()}
          >
            Revert changes
          </button>
        )}
        <Save settings={settings} />
      </div>
    </div>
  );
}
