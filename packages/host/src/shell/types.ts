/**
 * What the kernel hands the shell. Types only: post.js loads `runtime/shell.js` and never bundles
 * it, so the shell shares React and `@rigline/plugin-api/ui` with the plugins it renders (D88).
 */
import type {
  ElementComponent,
  MenuComponent,
  ModelState,
  SettingsTabComponent,
  Store,
  Surface,
} from "@rigline/plugin-api/internal";
import type { SettingsSaver } from "@rigline/plugin-api/ui/internal";
import type { Diagnostics } from "../kernel/bridge.ts";
import type { CheckGroup } from "../kernel/checks.ts";
import type { LayoutEditor } from "../kernel/layout.ts";
import type { SettingsEditor } from "../kernel/settings.ts";
import type { ElementReading } from "../kernel/shell.ts";

export interface Contribution {
  /** Stable for the contribution's life: React's key. */
  readonly key: number;
  readonly owner: string;
  readonly component: MenuComponent;
  /** The owning plugin's error path: a render throw disables that plugin. */
  readonly onError: (reason: string) => void;
  /** Its settings saver, stamped with `owner`, which a `SaveSettings` inside it reads (D138). */
  readonly saver: SettingsSaver;
}

/** A tab in the settings screen: Rigline's, or a plugin's. */
export interface SettingsTab {
  /** Stable for the tab's life: React's key. */
  readonly key: number;
  /** Whose settings it edits, which stamps its draft. */
  readonly owner: string;
  readonly title: string;
  readonly component: SettingsTabComponent;
  /** The owning plugin's error path: a render throw disables that plugin. */
  readonly onError: (reason: string) => void;
  /** Its settings saver, for a `SaveSettings` inside it. */
  readonly saver: SettingsSaver;
}

/** An element with somewhere to render (D90). */
export interface PlacedElement {
  readonly key: number;
  readonly owner: string;
  readonly id: string;
  /** Its manifest title, which stands in for it while editing in place if it draws nothing. */
  readonly title: string;
  readonly component: ElementComponent;
  readonly onError: (reason: string) => void;
  /** Its settings saver, stamped with `owner`, which a `SaveSettings` inside it reads (D138). */
  readonly saver: SettingsSaver;
  /** The node it portals into: its own slot, or a zone it shares, in order. */
  readonly target: Element;
  /** React's key for the portal into `target`, the same for every element sharing it. */
  readonly targetKey: string;
}

/**
 * A place some element can go that this panel has: a side of a row, its node and its row's, `fresh`
 * for the next row, which a drop makes (D122, D127); or a slot at an anchor (D95).
 */
export type PanelPlace =
  | {
      readonly place: string;
      readonly zone: Element;
      readonly row: Element;
      readonly fresh: boolean;
    }
  | {
      readonly place: string;
      readonly selector: string;
      readonly at: "before" | "after" | "inside";
    };

export interface ShellOptions {
  /** The host-placed node the pill renders into. */
  readonly pill: Element;
  /** The container on `body` the root renders into, and the menu with it. */
  readonly layer: Element;
  /** Every menu contribution, in registry order. */
  readonly contributions: Store<readonly Contribution[]>;
  /** Every placed element, in registry order and then manifest order. */
  readonly elements: Store<readonly PlacedElement[]>;
  /** How many checks were failing at the last run. */
  readonly failing: Store<number>;
  /** The last run itself, which Diagnostics shows (D119). */
  readonly checks: Store<readonly CheckGroup[]>;
  /** The bridge's diagnostics, which Copy report reads. */
  readonly diagnostics: Diagnostics;
  readonly surface: Surface;
  /** The layout editor the Layout submenu drives (D93). */
  readonly editor: LayoutEditor;
  /** The settings screen's drafts, what is saved, and which tab is open. */
  readonly settings: SettingsEditor;
  /** Every settings tab: Rigline's first, then plugins' in registry order. */
  readonly tabs: Store<readonly SettingsTab[]>;
  /** What became of each bound element, keyed `plugin/element`. */
  readonly readings: ReadonlyMap<string, ElementReading>;
  /** Every place a bound element offers that this panel has. */
  readonly places: Store<readonly PanelPlace[]>;
  /** The composer's box, which editing in place sits above, or null where the panel has none. */
  readonly composer: () => Element | null;
  /** A fault in the shell itself, rather than in a contribution. */
  readonly onError: (reason: string) => void;
}

export type StartShell = (options: ShellOptions) => () => void;

/** Rigline's own elements' components, by id, for the kernel to bind (D97). */
export type RiglineElements = (editor: LayoutEditor) => Readonly<Record<string, ElementComponent>>;

/** Rigline's own settings tab, for the kernel to add through the same path as a plugin's. */
export type RiglineTab = (models: Store<ModelState>) => SettingsTabComponent;
