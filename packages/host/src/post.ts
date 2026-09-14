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
  capabilityViolation,
  type IdentifierTables,
  type OptionalContext,
  optionalGaps,
  type PluginContext,
  type RiglinePlugin,
  type Teardown,
} from "@rigline/plugin-api";
import { MODULES } from "./capabilities/index.ts";
import { type Bridge, bridge as findBridge, type PluginStatus } from "./kernel/bridge.ts";
import { createMountService } from "./kernel/mounts.ts";
import { createSessionService } from "./kernel/session.ts";
import { detectSurface } from "./kernel/surface.ts";
import { createToolService } from "./kernel/tools.ts";
import { createTranscriptService } from "./kernel/transcript.ts";
import type { Grant, Kernel, PluginRecord } from "./kernel/types.ts";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface RegistryModule {
  readonly plugins?: readonly Omit<PluginRecord, "order">[];
  readonly patches?: Bridge["diagnostics"]["hostPatches"];
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
  const missingOptional = optionalGaps(plugin.uses, kernel.tables);
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
    mod = (await import(new URL(plugin.entry, import.meta.url).href)) as {
      default?: RiglinePlugin;
    };
  } catch (e) {
    return Object.assign(status, { status: "error", reason: `import failed: ${message(e)}` });
  }
  const exported = mod.default;
  if (!exported || typeof exported.setup !== "function") {
    return Object.assign(status, { status: "error", reason: "default export has no setup()" });
  }

  const teardowns: Teardown[] = [];
  const disable = (reason: string): void => {
    if (status.status === "error") return;
    status.status = "error";
    status.reason = reason;
    for (const teardown of teardowns.splice(0)) {
      try {
        teardown();
      } catch {
        // Already disabling; a teardown failing too is not actionable.
      }
    }
    console.error(`[rigline] plugin "${plugin.name}" disabled: ${reason}`);
  };
  const grant: Grant = {
    plugin,
    kernel,
    own(teardown) {
      teardowns.push(teardown);
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
  const ctx = { surface: kernel.surface, optional: Object.freeze(optional) } as PluginContext;
  for (const module of MODULES) Object.assign(ctx, module.grant(grant));
  Object.freeze(ctx);

  try {
    const teardown = exported.setup(ctx);
    if (typeof teardown === "function") teardowns.push(teardown);
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
  const { diagnostics, bus, react } = bridge;
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
    tables = mod.TABLES;
    diagnostics.identifiersFor = tables.version;
  } catch (e) {
    diagnostics.errors.push(`generated: ${message(e)}`);
    console.error("[rigline] could not load ./generated.js; no plugins will be loaded", e);
    bus.sealBuffer();
    return;
  }

  let entries: readonly PluginRecord[] = [];
  try {
    const registry = (await import(
      new URL("./registry.js", import.meta.url).href
    )) as RegistryModule;
    entries = (registry.plugins ?? []).map((p, order) => ({ ...p, order }));
    diagnostics.hostPatches = [...(registry.patches ?? [])];
  } catch (e) {
    diagnostics.errors.push(`registry: ${message(e)}`);
  }

  const mounts = createMountService(message);
  const kernel: Kernel = {
    tables,
    surface: detectSurface(),
    bus,
    react,
    diagnostics,
    mounts,
    session: createSessionService(bus),
    tools: createToolService(bus),
    transcript: createTranscriptService(
      bus,
      react,
      mounts,
      diagnostics.transcript,
      tables.anchors.transcriptRow ?? null,
      message,
    ),
  };

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
}

main().catch((e) => console.error("[rigline] post-hook", e));
