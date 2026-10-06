/**
 * The post hook: dynamically imported from the tail of the extension's webview/index.js, after
 * createRoot().render(). The injected caller catches, so a failure here cannot stop the app
 * booting, and a `.catch()` below does the same for anything that escapes module load.
 *
 * The kernel. It loads the tables and the registry the injector wrote beside this file, and for
 * each plugin, in registry order: applies the injector's patch verdict, checks the manifest's
 * declarations against the tables, skips plugins not for this surface, imports the entry in its
 * own try/catch, builds a ctx from the capability modules scoped to the declaration, and calls
 * setup() in its own try/catch. It knows no capability by name.
 */
import {
  type CheckVerdict,
  capabilityViolation,
  type ElementComponent,
  elementGaps,
  type IdentifierTables,
  type Layout,
  type OptionalContext,
  optionalGaps,
  type PluginContext,
  type RiglinePlugin,
  type SaveRecord,
  type Teardown,
  withRigline,
} from "@rigline/plugin-api/internal";
import { MODULES } from "./capabilities/index.ts";
import { type Bridge, bridge as findBridge, type PluginStatus } from "./kernel/bridge.ts";
import { createCheckService, HOST, kernelChecks } from "./kernel/checks.ts";
import { createContextService } from "./kernel/context.ts";
import { createLayoutEditor } from "./kernel/layout.ts";
import { guardLinks } from "./kernel/links.ts";
import { createMountService } from "./kernel/mounts.ts";
import { createRecorder } from "./kernel/record.ts";
import { createSessionService } from "./kernel/session.ts";
import { createShellService } from "./kernel/shell.ts";
import { detectSurface } from "./kernel/surface.ts";
import { createToolService } from "./kernel/tools.ts";
import { createTranscriptService } from "./kernel/transcript.ts";
import { CapabilityViolation, type Grant, type Kernel, type PluginRecord } from "./kernel/types.ts";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * `members` with every method disabling its plugin before a violation leaves it, so a plugin that
 * catches its own, or makes it in a callback of its own, is still disabled (D15).
 */
function disablingOnViolation<T extends object>(members: T, disable: (reason: string) => void): T {
  const record = members as Record<string, unknown>;
  for (const [key, member] of Object.entries(record)) {
    if (typeof member !== "function") continue;
    record[key] = (...args: unknown[]) => {
      try {
        return member(...args);
      } catch (e) {
        if (e instanceof CapabilityViolation) disable(e.message);
        throw e;
      }
    };
  }
  return members;
}

/** Read as absent rather than as a missing member: `await`, `JSON.stringify` and debuggers probe them. */
const PROBED = new Set(["then", "toJSON"]);

/**
 * `members` behind a Proxy under which reading one this release lacks disables the plugin, since a
 * later 1.x may add it and only this release can say so (D109). `in` still answers truthfully.
 */
function refusingUnknown<T extends object>(
  members: T,
  path: string,
  engine: string | null,
  disable: (reason: string) => void,
): T {
  return new Proxy(members, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || PROBED.has(key) || Reflect.has(target, key)) {
        return Reflect.get(target, key, receiver);
      }
      const reason =
        `${path}.${key} is not in this Rigline${engine === null ? "" : ` (${engine})`}; ` +
        "the plugin needs a later release";
      disable(reason);
      throw new CapabilityViolation(reason);
    },
  });
}

/**
 * `tables` with every selector the browser will not parse made unresolved, with the reason: one
 * from `~/.rigline/anchors.json` may not, and every query would throw with it (D44).
 */
function withParsedSelectors(tables: IdentifierTables): IdentifierTables {
  const probe = document.createDocumentFragment();
  const unparsed: Record<string, string> = {};
  for (const [name, selector] of Object.entries(tables.anchorSelectors ?? {})) {
    if (selector === null) continue;
    try {
      probe.querySelector(selector);
    } catch (e) {
      unparsed[name] =
        `anchor "${name}" has a selector that does not parse, ${selector}: ${message(e)}`;
    }
  }
  const names = Object.keys(unparsed);
  if (names.length === 0) return tables;
  const gone = Object.fromEntries(names.map((name) => [name, null]));
  return {
    ...tables,
    anchors: { ...tables.anchors, ...gone },
    anchorSelectors: { ...tables.anchorSelectors, ...gone },
    unresolvedAnchors: { ...tables.unresolvedAnchors, ...unparsed },
  };
}

/** How long one plugin's import may take before the next loads without it. */
const IMPORT_MS = 10_000;

/** Why an import lost its race with the timer, as opposed to failing. */
class ImportTimeout extends Error {}

/** `promise`, or an `ImportTimeout` once `ms` has passed without it settling. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImportTimeout()), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

interface RegistryModule {
  /** The engine version that baked this file (D75). Absent in a payload older than the stamp. */
  readonly engine?: string;
  readonly plugins?: readonly Omit<PluginRecord, "order">[];
  readonly patches?: Bridge["diagnostics"]["hostPatches"];
  /** The person's layout (D92). Absent in a payload older than it. */
  readonly layout?: Layout;
  /** What the panel's Save goes through (D93). Absent in a payload older than it. */
  readonly save?: SaveRecord | null;
}

let reads = 0;

/** The layout `registry.js` holds now, since a fresh query is a fresh read (D93). */
async function readSavedLayout(): Promise<Layout | null> {
  try {
    const registry = (await import(
      new URL(`./registry.js?read=${++reads}`, import.meta.url).href
    )) as RegistryModule;
    return registry.layout ?? {};
  } catch {
    return null;
  }
}

async function loadPlugin(plugin: PluginRecord, kernel: Kernel): Promise<PluginStatus> {
  const status: PluginStatus = { name: plugin.name, status: "loaded" };
  const refuse = (reason: string): PluginStatus =>
    Object.assign(status, { status: "refused", reason });

  // Decided in Node and carried here: nothing in a webview can see extension.js, so the injector
  // records what happened to each declared patch and this reads the verdict.
  if (plugin.patchRefusal) return refuse(plugin.patchRefusal);
  const violation = capabilityViolation(plugin.uses, kernel.tables);
  if (violation) return refuse(violation);
  // Read before the surface check, because a plugin inactive here is active in another webview and
  // the gap is a property of the extension, not of the surface.
  const missingOptional = [
    ...optionalGaps(plugin.uses, kernel.tables),
    ...elementGaps(plugin.elements, kernel.tables),
  ];
  if (missingOptional.length > 0) {
    status.missingOptional = missingOptional;
    console.warn(
      `[rigline] plugin "${plugin.name}" is loading without ${missingOptional.length} optional declaration(s): ${missingOptional.join("; ")}`,
    );
  }
  if (!plugin.surfaces.includes(kernel.surface)) {
    return Object.assign(status, {
      status: "inactive",
      reason: `not for the ${kernel.surface} surface`,
    });
  }

  let mod: { default?: RiglinePlugin };
  try {
    // Raced, since loading is sequential: a top-level await that never settles would otherwise
    // hold every later plugin, the buffer's seal and the shell.
    mod = (await within(import(new URL(plugin.entry, import.meta.url).href), IMPORT_MS)) as {
      default?: RiglinePlugin;
    };
  } catch (e) {
    const reason =
      e instanceof ImportTimeout
        ? `import did not finish within ${IMPORT_MS / 1000}s`
        : `import failed: ${message(e)}`;
    return Object.assign(status, { status: "error", reason });
  }
  const exported = mod.default;
  if (!exported || typeof exported.setup !== "function") {
    return Object.assign(status, { status: "error", reason: "default export has no setup()" });
  }

  const teardowns: Teardown[] = [];
  const runQuietly = (teardown: Teardown): void => {
    try {
      teardown();
    } catch {
      // Already disabling; a teardown failing too is not actionable.
    }
  };
  const disable = (reason: string): void => {
    if (status.status === "error") return;
    status.status = "error";
    status.reason = reason;
    for (const teardown of teardowns.splice(0)) runQuietly(teardown);
    console.error(`[rigline] plugin "${plugin.name}" disabled: ${reason}`);
  };
  const grant: Grant = {
    plugin,
    kernel,
    // Undone at once for a plugin already disabled, which a plugin that caught its own violation
    // and carried on still is.
    own(teardown) {
      if (status.status === "error") runQuietly(teardown);
      else teardowns.push(teardown);
      return teardown;
    },
    disable,
    guard(what, fn) {
      return (...args) => {
        try {
          fn(...args);
        } catch (e) {
          disable(`${what} threw: ${message(e)}`);
        }
      };
    },
  };

  // Two flat merges rather than one nested one: each capability owns disjoint members of its own
  // object, so neither assign can clobber another capability's slice.
  const optional = {} as OptionalContext;
  for (const module of MODULES) Object.assign(optional, module.grantOptional?.(grant));
  const engine = kernel.diagnostics.engine;
  const ctx = {
    surface: kernel.surface,
    optional: refusingUnknown(
      Object.freeze(disablingOnViolation(optional, disable)),
      "ctx.optional",
      engine,
      disable,
    ),
    // Undeclared, like `surface`, because it widens nothing: the plugin hands the host a function
    // and gets nothing back, so there is no identifier for a manifest to name and no gap a
    // declaration could ever report. Through `own` so a disabled plugin's lines go with it — a
    // plugin the host has torn down should not keep reporting on itself.
    check: (name: string, run: () => CheckVerdict) =>
      grant.own(kernel.checks.add(plugin.name, name, run)),
    // Declared by `elements` rather than by a key of `uses`, so no capability module owns it (D90).
    element: (id: string, component: ElementComponent) => {
      const ids = Object.keys(plugin.elements);
      const spec = Object.hasOwn(plugin.elements, id) ? plugin.elements[id] : undefined;
      if (!spec) {
        throw new CapabilityViolation(
          `element("${id}") needs "${id}" under elements in this plugin's rigline.json`,
        );
      }
      if (typeof component !== "function") {
        throw new Error("element() takes a component: a function returning what to render");
      }
      return grant.own(
        kernel.shell.element(
          plugin.name,
          plugin.order,
          ids.indexOf(id),
          id,
          spec,
          component,
          disable,
        ),
      );
    },
  } as PluginContext;
  for (const module of MODULES) Object.assign(ctx, module.grant(grant));
  const handed = refusingUnknown(
    Object.freeze(disablingOnViolation(ctx, disable)),
    "ctx",
    engine,
    disable,
  );

  try {
    const teardown: unknown = exported.setup(handed);
    if (typeof teardown === "function") grant.own(teardown as Teardown);
    else if (isThenable(teardown)) {
      disable("setup() returned a promise; it has to register everything before it returns");
      // Disabled already; its rejection would otherwise surface as unhandled, with no plugin named.
      Promise.resolve(teardown).catch(() => {});
    }
  } catch (e) {
    disable(`setup() threw: ${message(e)}`);
  }
  return status;
}

async function main(): Promise<void> {
  const bridge = findBridge();
  if (!bridge) {
    console.error("[rigline] the pre hook did not run; no plugins can be loaded");
    return;
  }
  const { diagnostics, bus, react, meter } = bridge;
  diagnostics.postAt = Math.round(performance.now());
  diagnostics.rootChildrenAtPost = document.querySelector("#root")?.childElementCount ?? -1;

  // Before anything else, because every declaration check reads it. A failure here is fatal to
  // plugin loading by design: with empty tables the checks would refuse every plugin and name an
  // identifier that has not actually gone, which is worse than loading nothing and saying why.
  let tables: IdentifierTables;
  try {
    const mod = (await import(new URL("./generated.js", import.meta.url).href)) as {
      TABLES: IdentifierTables;
    };
    tables = withParsedSelectors(mod.TABLES);
    diagnostics.identifiersFor = tables.version;
  } catch (e) {
    diagnostics.errors.push(`generated: ${message(e)}`);
    console.error("[rigline] could not load ./generated.js; no plugins will be loaded", e);
    bus.sealBuffer();
    return;
  }

  guardLinks();

  let entries: readonly PluginRecord[] = [];
  let layout: Layout = {};
  let save: SaveRecord | null = null;
  try {
    const registry = (await import(
      new URL("./registry.js", import.meta.url).href
    )) as RegistryModule;
    entries = (registry.plugins ?? []).map((p, order) => ({ ...p, order }));
    layout = registry.layout ?? {};
    save = registry.save ?? null;
    diagnostics.hostPatches = [...(registry.patches ?? [])];
    // Carried onto diagnostics rather than left in the module, so a plugin reads it the way it
    // reads every other host-provided value and never imports the host to get it (D18, D63, D75).
    diagnostics.engine = typeof registry.engine === "string" ? registry.engine : null;
  } catch (e) {
    diagnostics.errors.push(`registry: ${message(e)}`);
  }

  const mounts = createMountService(message, react, diagnostics.mounts, meter);
  const editor = createLayoutEditor({
    baked: layout,
    plugins: withRigline(entries.map((p) => ({ name: p.name, elements: p.elements }))),
    save,
    readSaved: readSavedLayout,
  });
  const checks = createCheckService();
  const surface = detectSurface();
  const kernel: Kernel = {
    tables,
    surface,
    bus,
    react,
    diagnostics,
    mounts,
    session: createSessionService(bus),
    tools: createToolService(bus),
    context: createContextService(bus, tables.messageTypes),
    transcript: createTranscriptService(
      bus,
      react,
      mounts,
      diagnostics.transcript,
      tables.anchorSelectors?.transcriptRow ?? null,
      message,
      meter,
    ),
    checks,
    shell: createShellService(tables, surface, editor, mounts, checks, diagnostics, (reason) => {
      diagnostics.errors.push(`shell: ${reason}`);
      console.error(`[rigline] shell: ${reason}`);
    }),
    plugins: entries,
  };

  // Before the loop, so the host is the first contributor and a capability that has already failed
  // reads above the plugins it took down with it. A module's checks throwing while being *built* is
  // a fault in the host rather than in a check, so it goes to `diagnostics.errors` like any other.
  checks.addAll(HOST, kernelChecks(kernel));
  for (const module of MODULES) {
    try {
      const contributed = module.checks?.(kernel);
      if (contributed) checks.addAll(HOST, contributed);
    } catch (e) {
      diagnostics.errors.push(`checks(${module.contract.key}): ${message(e)}`);
    }
  }
  bridge.checks = checks;

  // Started before plugins load, so a panel that dies during a plugin's setup still leaves a record
  // of having got that far. The recorder never throws and never blocks: if storage is unavailable it
  // reports that and does nothing (D53).
  createRecorder(diagnostics, kernel.surface);

  // Sealed as VS Code seals its own after one call, so a plugin posts through `ctx` (D79). Never
  // before the app has acquired, or a plugin could get there first and the app's call would throw.
  if (diagnostics.acquireCalled) {
    globalThis.acquireVsCodeApi = () => {
      throw new Error("An instance of the VS Code API has already been acquired");
    };
  }

  try {
    for (const plugin of entries) {
      const status = await loadPlugin(plugin, kernel);
      diagnostics.plugins.push(status);
      if (status.status !== "loaded" && status.status !== "inactive") {
        console.error(`[rigline] plugin "${plugin.name}" ${status.status}: ${status.reason}`);
      }
    }
  } finally {
    // Every plugin has had its chance to register, so the replay buffer stops growing. In a
    // finally because a buffer growing for the life of the window is worse than whatever failed.
    bus.sealBuffer();
  }
  // After the seal, so the pill's first count is not taken while checks still cannot be true.
  await kernel.shell.start(entries.length);
}

main().catch((e) => console.error("[rigline] post-hook", e));
