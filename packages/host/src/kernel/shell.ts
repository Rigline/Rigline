/**
 * The shell's kernel half: the menu's contributions, the RIG pill's place, and loading the root
 * that draws both (D88). The root is `runtime/shell.js`, loaded rather than bundled here, so failing
 * to load it costs the menu and leaves every plugin running.
 */
import {
  ANCHORS,
  type AnchorSpec,
  type IdentifierTables,
  type MenuComponent,
  type Surface,
  store,
  type Teardown,
} from "@rigline/plugin-api";
import type { Contribution, StartShell } from "../shell/types.ts";
import type { CheckService } from "./checks.ts";
import type { MountService } from "./mounts.ts";

/** Whose mount the pill is, in `data-rigline-mount` and in the mount diagnostics. */
const OWNER = "rigline";

/** After every plugin's mount at the same anchor, so the pill sits nearest the spacer. */
const PILL_ORDER = Number.MAX_SAFE_INTEGER;

/** How often the failing count on the pill is refreshed, which is how often every check runs. */
const POLL_MS = 1000;

export interface ShellState {
  readonly started: boolean;
  readonly error: string | null;
  readonly pill: Element;
}

export interface ShellService {
  contribute(
    owner: string,
    order: number,
    component: MenuComponent,
    onError: (reason: string) => void,
  ): Teardown;
  /** Place the pill and load the root. Once, after every plugin's `setup` has run. */
  start(): Promise<void>;
  readonly state: ShellState;
}

export function createShellService(
  tables: IdentifierTables,
  surface: Surface,
  mounts: MountService,
  checks: CheckService,
  fail: (reason: string) => void,
): ShellService {
  const pill = document.createElement("span");
  const state = { started: false, error: null as string | null, pill };
  const entries: (Contribution & { readonly order: number })[] = [];
  const contributions = store<readonly Contribution[]>([]);
  const failing = store(0);
  let next = 0;

  function publish(): void {
    contributions.set([...entries].sort((a, b) => a.order - b.order || a.key - b.key));
  }

  /** Beside the footer spacer where there is one (D54), and in a corner of the panel where not. */
  function place(): void {
    const selector = tables.anchorSelectors?.footerSpacer ?? null;
    const spec: AnchorSpec = ANCHORS.footerSpacer;
    if (selector && (!spec.surfaces || spec.surfaces.includes(surface))) {
      const target = { anchor: "footerSpacer", selector, unique: spec.kind === "singleton" };
      mounts.watch(
        target,
        OWNER,
        (spacer) =>
          mounts.attach(spacer, "before", PILL_ORDER, OWNER, () => pill, fail, "the RIG pill") ??
          undefined,
        fail,
      );
      return;
    }
    pill.classList.add("rigline-pill-fixed");
    mounts.attach(document.body, "inside", PILL_ORDER, OWNER, () => pill, fail, "the RIG pill");
  }

  function poll(): void {
    failing.set(checks.run().reduce((total, group) => total + group.failing, 0));
  }

  return {
    contribute(owner, order, component, onError) {
      const entry = { key: next++, owner, order, component, onError };
      entries.push(entry);
      publish();
      return () => {
        const i = entries.indexOf(entry);
        if (i === -1) return;
        entries.splice(i, 1);
        publish();
      };
    },
    async start() {
      place();
      poll();
      setInterval(poll, POLL_MS);
      const layer = document.createElement("div");
      layer.setAttribute("data-rigline-layer", "");
      document.body.appendChild(layer);
      try {
        const shell = (await import(new URL("./runtime/shell.js", import.meta.url).href)) as {
          startShell?: StartShell;
        };
        if (typeof shell.startShell !== "function") {
          throw new Error("runtime/shell.js exports no startShell");
        }
        shell.startShell({ pill, layer, contributions, failing, onError: fail });
        state.started = true;
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
        fail(`the shell did not load: ${state.error}`);
      }
    },
    state,
  };
}
