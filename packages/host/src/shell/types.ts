/**
 * What the kernel hands the shell. Types only: post.js loads `runtime/shell.js` and never bundles
 * it, so the shell shares React and `@rigline/plugin-api/ui` with the plugins it renders (D88).
 */
import type { ElementComponent, MenuComponent, Store } from "@rigline/plugin-api";

export interface Contribution {
  /** Stable for the contribution's life: React's key. */
  readonly key: number;
  readonly owner: string;
  readonly component: MenuComponent;
  /** The owning plugin's error path: a render throw disables that plugin. */
  readonly onError: (reason: string) => void;
}

/** An element with somewhere to render (D90). */
export interface PlacedElement {
  readonly key: number;
  readonly owner: string;
  readonly id: string;
  readonly component: ElementComponent;
  readonly onError: (reason: string) => void;
  /** The node it portals into: its own slot, or a zone it shares, in order. */
  readonly target: Element;
  /** React's key for the portal into `target`, the same for every element sharing it. */
  readonly targetKey: string;
}

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
  /** A fault in the shell itself, rather than in a contribution. */
  readonly onError: (reason: string) => void;
}

export type StartShell = (options: ShellOptions) => () => void;
