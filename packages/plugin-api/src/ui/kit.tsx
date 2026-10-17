/**
 * The settings kit: what a settings tab is drawn with, Rigline's own included. Controlled components
 * holding no state of their own, so they render anywhere and a tab switch loses nothing; the one
 * context is the row's, which names the control inside it for a screen reader.
 */
import { createContext, type MouseEvent, type ReactNode, useContext, useId, useMemo } from "react";
import {
  currentModel,
  type DefaultChoice,
  type ModelState,
  modelLabel,
  supportsEffort,
} from "../models.ts";

export const KIT_CSS = `
.rigline-kit-row {
  display: grid;
  gap: 2px;
  padding: 10px 0;
  border-bottom: 1px solid var(--app-input-border, var(--vscode-widget-border, #7f7f7f33));
}
.rigline-kit-row:last-child {
  border-bottom: none;
}
.rigline-kit-label {
  font-weight: 600;
}
.rigline-kit-hint {
  color: var(--app-secondary-foreground, var(--vscode-descriptionForeground));
  font-size: 0.9em;
}
.rigline-kit-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 4px;
}
.rigline-kit-toggle {
  position: relative;
  flex-shrink: 0;
  width: 30px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--vscode-checkbox-border, var(--app-input-border, #7f7f7f66));
  border-radius: 9999px;
  background: var(--vscode-checkbox-background, transparent);
  cursor: pointer;
}
.rigline-kit-toggle[aria-checked="true"] {
  border-color: transparent;
  background: var(--vscode-button-background, #0e639c);
}
.rigline-kit-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--vscode-foreground, #cccccc);
}
.rigline-kit-toggle[aria-checked="true"] .rigline-kit-knob {
  left: 16px;
  background: var(--vscode-button-foreground, #ffffff);
}
.rigline-kit-choice {
  display: grid;
  gap: 6px;
}
.rigline-kit-option {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  cursor: pointer;
}
.rigline-kit-option input {
  margin: 2px 0 0;
  accent-color: var(--vscode-focusBorder, #007fd4);
}
.rigline-kit-option-text {
  display: grid;
  gap: 1px;
}
.rigline-kit-choice-inline {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0;
  border: 1px solid var(--vscode-dropdown-border, var(--app-input-border, #7f7f7f66));
  border-radius: 4px;
  overflow: hidden;
}
.rigline-kit-choice-inline .rigline-kit-option {
  position: relative;
  align-items: center;
  padding: 2px 10px;
}
.rigline-kit-choice-inline .rigline-kit-option + .rigline-kit-option {
  border-left: 1px solid var(--vscode-dropdown-border, var(--app-input-border, #7f7f7f66));
}
.rigline-kit-choice-inline input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.rigline-kit-choice-inline .rigline-kit-option:has(input:checked) {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #ffffff);
}
.rigline-kit-choice-inline .rigline-kit-option:has(input:focus-visible) {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -1px;
}
.rigline-kit-text,
.rigline-kit-select {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--vscode-input-border, var(--app-input-border, #7f7f7f66));
  border-radius: 2px;
  background: var(--vscode-input-background, transparent);
  color: var(--vscode-input-foreground, inherit);
  font: inherit;
}
.rigline-kit-select {
  border-color: var(--vscode-dropdown-border, var(--app-input-border, #7f7f7f66));
  background: var(--vscode-dropdown-background, transparent);
  color: var(--vscode-dropdown-foreground, inherit);
}
.rigline-kit-text:focus,
.rigline-kit-select:focus,
.rigline-kit-toggle:focus-visible,
.rigline-kit-button:focus-visible,
.rigline-kit-icon:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -1px;
}
.rigline-kit-button {
  padding: 2px 10px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 2px;
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ffffff);
  font: inherit;
  cursor: pointer;
}
.rigline-kit-button:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground, #45494e);
}
.rigline-kit-button:disabled,
.rigline-kit-icon:disabled {
  opacity: 0.4;
  cursor: default;
}
.rigline-kit-list {
  display: grid;
  gap: 2px;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rigline-kit-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 4px;
}
.rigline-kit-item:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.rigline-kit-item-body {
  flex: 1;
  min-width: 0;
}
.rigline-kit-icon {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.rigline-kit-icon:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.rigline-kit-model {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
`;

interface RowIds {
  readonly label: string;
  readonly hint: string | undefined;
}

/** The row a control sits in, which names it. */
const RowContext = createContext<RowIds | null>(null);

/** The row's label and hint as `aria-*`, or `label` where the control names itself. */
function useLabelling(label?: string): Record<string, string | undefined> {
  const row = useContext(RowContext);
  if (label !== undefined) return { "aria-label": label };
  return row === null ? {} : { "aria-labelledby": row.label, "aria-describedby": row.hint };
}

export interface SettingRowProps {
  readonly label: ReactNode;
  /** A line under the label: how to use it, or what changes how its value reads. */
  readonly hint?: ReactNode;
  /** The control, which the row's label names. */
  readonly children?: ReactNode;
}

/** One setting: a label, a hint, and the control. */
export function SettingRow(props: SettingRowProps): ReactNode {
  const { label, hint, children } = props;
  const id = useId();
  const ids = useMemo<RowIds>(
    () => ({ label: `${id}label`, hint: hint === undefined ? undefined : `${id}hint` }),
    [id, hint],
  );
  return (
    <div className="rigline-kit-row">
      <div className="rigline-kit-label" id={ids.label}>
        {label}
      </div>
      {ids.hint !== undefined && (
        <div className="rigline-kit-hint" id={ids.hint}>
          {hint}
        </div>
      )}
      <RowContext.Provider value={ids}>
        <div className="rigline-kit-control">{children}</div>
      </RowContext.Provider>
    </div>
  );
}

export interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  /** Its name where it is not the only control in a row. */
  readonly label?: string;
}

/** On or off. */
export function Toggle(props: ToggleProps): ReactNode {
  const { checked, onChange, disabled, label } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="rigline-kit-toggle"
      disabled={disabled}
      {...useLabelling(label)}
      onClick={() => onChange(!checked)}
    >
      <span className="rigline-kit-knob" />
    </button>
  );
}

export interface ChoiceOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
}

export interface ChoiceProps {
  readonly options: readonly ChoiceOption[];
  /** The option chosen, or null for none of them. */
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  /** Side by side, for short labels with no hints. */
  readonly inline?: boolean;
  readonly disabled?: boolean;
  /** Its name where it is not the only control in a row. */
  readonly label?: string;
}

/** One of a few. */
export function Choice(props: ChoiceProps): ReactNode {
  const { options, value, onChange, inline, disabled, label } = props;
  const name = useId();
  return (
    <div
      role="radiogroup"
      className={
        inline === true ? "rigline-kit-choice rigline-kit-choice-inline" : "rigline-kit-choice"
      }
      {...useLabelling(label)}
    >
      {options.map((option) => (
        <label key={option.value} className="rigline-kit-option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span className="rigline-kit-option-text">
            <span>{option.label}</span>
            {option.hint !== undefined && <span className="rigline-kit-hint">{option.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export interface TextFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Its name where it is not the only control in a row. */
  readonly label?: string;
}

/** A line of text. */
export function TextField(props: TextFieldProps): ReactNode {
  const { value, onChange, placeholder, disabled, label } = props;
  return (
    <input
      type="text"
      className="rigline-kit-text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      {...useLabelling(label)}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

export interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly disabled?: boolean;
  readonly title?: string;
}

/** An action within a tab, such as adding to a list. Saving is the screen's, not a tab's. */
export function Button(props: ButtonProps): ReactNode {
  const { children, onClick, disabled, title } = props;
  return (
    <button
      type="button"
      className="rigline-kit-button"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface ListEditorProps<T> {
  readonly items: readonly T[];
  readonly onChange: (items: readonly T[]) => void;
  /** One item's row, which the tab draws. */
  readonly render: (item: T, index: number) => ReactNode;
  /** What one item is called, for its buttons' names: "Remove favourite". */
  readonly noun: string;
  /** Shown in place of the list while it is empty. */
  readonly empty?: ReactNode;
}

/** A list a person reorders and prunes. Adding is the tab's, drawn after it with the kit. */
export function ListEditor<T>(props: ListEditorProps<T>): ReactNode {
  const { items, onChange, render, noun, empty } = props;
  const labelling = useLabelling();
  if (items.length === 0) {
    return empty === undefined ? null : <div className="rigline-kit-hint">{empty}</div>;
  }
  const swap = (i: number, j: number): void => {
    const next = [...items];
    [next[i], next[j]] = [next[j] as T, next[i] as T];
    onChange(next);
  };
  return (
    <ul className="rigline-kit-list" {...labelling}>
      {items.map((item, i) => (
        <li key={i} className="rigline-kit-item">
          <div className="rigline-kit-item-body">{render(item, i)}</div>
          <button
            type="button"
            className="rigline-kit-icon"
            aria-label={`Move ${noun} up`}
            title={`Move ${noun} up`}
            disabled={i === 0}
            onClick={() => swap(i, i - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="rigline-kit-icon"
            aria-label={`Move ${noun} down`}
            title={`Move ${noun} down`}
            disabled={i === items.length - 1}
            onClick={() => swap(i, i + 1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="rigline-kit-icon"
            aria-label={`Remove ${noun}`}
            title={`Remove ${noun}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface ModelChooserProps {
  /** What this install offers, as `ctx.onModelState` hands it over. */
  readonly state: ModelState;
  /** The choice shown, or null for none. */
  readonly value: DefaultChoice | null;
  readonly onChange: (value: DefaultChoice | null) => void;
  /** The name of an option for no choice at all. Without it there is none to pick. */
  readonly none?: string;
}

/**
 * A model, then one of the efforts that model takes, from the person's own install's list. Stores
 * the alias and shows the version it resolves to now, so a choice follows its model's releases and
 * the change shows. A model that takes no effort is a choice of one.
 */
export function ModelChooser(props: ModelChooserProps): ReactNode {
  const { state, value, onChange, none } = props;
  const labelling = useLabelling();
  const target = value === null ? null : currentModel(state.models, value.model);

  function pick(alias: string): void {
    if (alias === "") {
      onChange(null);
      return;
    }
    const model = state.models.find((m) => m.value === alias) ?? null;
    const { effort, thinkingLevel, ultracode } = value ?? {};
    const takesEffort = model?.supportsEffort === true;
    onChange({
      model: alias,
      ...(effort !== undefined && supportsEffort(model, effort) ? { effort } : {}),
      ...(thinkingLevel !== undefined && !takesEffort ? { thinkingLevel } : {}),
      ...(ultracode === undefined ? {} : { ultracode }),
    });
  }

  return (
    <div className="rigline-kit-model">
      <select
        className="rigline-kit-select"
        value={target?.value ?? value?.model ?? ""}
        {...labelling}
        onChange={(e) => pick(e.currentTarget.value)}
      >
        {(value === null || none !== undefined) && (
          <option value="">{none ?? "Choose a model"}</option>
        )}
        {value !== null && target === null && (
          <option value={value.model}>{value.model} — not offered here</option>
        )}
        {state.models.map((model) => (
          <option key={model.value} value={model.value}>
            {modelLabel(model)}
          </option>
        ))}
      </select>
      {value !== null && target?.supportsEffort === true && (
        <Choice
          inline
          label="Effort"
          options={target.supportedEffortLevels.map((level) => ({ value: level, label: level }))}
          value={value.effort ?? null}
          onChange={(effort) => {
            const { thinkingLevel: _, ...rest } = value;
            onChange({ ...rest, effort });
          }}
        />
      )}
      {state.models.length === 0 && (
        <span className="rigline-kit-hint">The list arrives once Claude Code starts here.</span>
      )}
    </div>
  );
}
