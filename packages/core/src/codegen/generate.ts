/**
 * Rendering a harvest as code.
 *
 * Two outputs, from one object. `generated.ts` lives in `@prototype/plugin-api` and is committed: it
 * carries the identifier tables as data plus literal-union types, so `ctx.cls("gGYT1w", "modelPill")`
 * and `ctx.onMessage("rename_tab", ...)` are checked against the extension version the tables came
 * from, and a fresh clone type-checks with no extension installed. Its diff after an update is the
 * list of what the extension changed. `generated.js` is written beside the injected loader, per
 * extension directory, and is what the post hook checks declarations against at runtime: the
 * loader itself carries nothing version-specific, so one build of it serves every installed
 * version (decisions.md, P7).
 *
 * Every union is emitted one member per line, so a class or message added upstream shows up in a
 * diff as one added line rather than a reflowed block.
 */
import type { IdentifierTables } from "@prototype/plugin-api";
import { resolveAnchors } from "../anchors/resolve.ts";
import { collidingLocalNames, unreachableCssClasses } from "../layers/classes.ts";
import type { Harvest } from "../layers/index.ts";
import { allMessageTypes } from "../layers/protocol.ts";
import { HarvestError } from "../layers/types.ts";

/** Everything the two renderers need, derived once from a harvest. */
export interface Generated {
  readonly tables: IdentifierTables;
  /** Whole stylesheet modules the class map cannot reach, by module hash. */
  readonly unreachableModules: readonly string[];
  /** The contents of `generated.ts`. */
  readonly source: string;
  /** The contents of `generated.js`. */
  readonly runtime: string;
  /** One line of counts, for reports. */
  readonly counts: string;
}

/** Build the tables and both renderings from a harvest. */
export function generate(harvest: Harvest): Generated {
  const gaps = unreachableCssClasses(harvest.classes, harvest.css);
  const partial = gaps.filter((gap) => gap.partial);
  if (partial.length > 0) {
    // A whole module the stylesheet defines and the map lacks is markup this build does not
    // contain. A module the map has but only partly is the class harvest dropping pairs, which
    // would regenerate tables that refuse plugins over classes that exist.
    const named = partial.map((gap) => `${gap.module} (${gap.locals.join(", ")})`).join("; ");
    throw new HarvestError("classes", `partially harvested module: ${named}`);
  }
  const unreachableModules = gaps.map((gap) => gap.module);

  const anchors = resolveAnchors(harvest.classes);
  const tables: IdentifierTables = {
    version: harvest.version,
    moduleClasses: sortedClassMap(harvest.classes),
    messageTypes: [
      ...new Set([...allMessageTypes(harvest.protocol), ...harvest.replies.responses]),
    ].sort(),
    inboundResponses: [...harvest.replies.responses].sort(),
    outboundFields: sortedRecord(harvest.fields.fields),
    partialFieldTypes: [...harvest.fields.partial].sort(),
    anchors: anchors.classes,
    react: { hook: harvest.react.hook, version: harvest.react.version },
  };

  const classes = Object.values(tables.moduleClasses).reduce(
    (n, module) => n + Object.keys(module).length,
    0,
  );
  const fieldCount = Object.values(tables.outboundFields).reduce((n, f) => n + f.length, 0);
  const counts =
    `${Object.keys(tables.moduleClasses).length} modules, ${classes} classes, ` +
    `${harvest.protocol.outboundRequests.length}+${harvest.protocol.outboundNotifications.length} outbound / ` +
    `${harvest.protocol.inboundPushes.length}+${harvest.protocol.inboundRequests.length} inbound messages, ` +
    `${tables.inboundResponses.length} replies, ${fieldCount} payload fields, ` +
    `${anchors.missing.length === 0 ? "every anchor resolved" : `${anchors.missing.length} anchors missing`}`;

  return {
    tables,
    unreachableModules,
    source: renderSource(harvest, tables, unreachableModules, anchors.missing),
    runtime: renderRuntime(tables),
    counts,
  };
}

function sortedClassMap(map: Harvest["classes"]): IdentifierTables["moduleClasses"] {
  const out: Record<string, Record<string, string>> = {};
  for (const module of Object.keys(map).sort()) {
    const locals = map[module] ?? {};
    out[module] = Object.fromEntries(
      Object.keys(locals)
        .sort()
        .map((l) => [l, locals[l] ?? ""]),
    );
  }
  return out;
}

function sortedRecord(
  record: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, [...(record[key] ?? [])].sort()]),
  );
}

/** A string-literal union, one member per line, or `never` for an empty set. */
function union(values: readonly string[], indent: string): string {
  if (values.length === 0) return "never";
  return values.map((v) => `\n${indent}| ${JSON.stringify(v)}`).join("");
}

function renderSource(
  harvest: Harvest,
  tables: IdentifierTables,
  unreachableModules: readonly string[],
  missingAnchors: readonly string[],
): string {
  const modules = Object.keys(tables.moduleClasses);
  const colliding = collidingLocalNames(harvest.classes);
  const moduleClassesInterface = modules
    .map(
      (m) => `  ${JSON.stringify(m)}:${union(Object.keys(tables.moduleClasses[m] ?? {}), "    ")};`,
    )
    .join("\n");
  const outboundFieldsInterface = Object.keys(tables.outboundFields)
    .map((t) => `  ${JSON.stringify(t)}:${union(tables.outboundFields[t] ?? [], "    ")};`)
    .join("\n");
  const unanswered =
    harvest.replies.unanswered.length === 0
      ? " * (every request this webview sends has a reply)"
      : harvest.replies.unanswered.map((r) => ` *   ${r}`).join("\n");
  const missing =
    missingAnchors.length === 0
      ? " * Every curated anchor resolves in this version."
      : ` * Anchors that do not resolve in this version: ${missingAnchors.join(", ")}.`;

  return `// Generated by prototype codegen from extension ${tables.version}. Do not edit.
// Regenerate with: prototype codegen
import type { IdentifierTables } from "./tables.ts";

export const EXTENSION_VERSION = ${JSON.stringify(tables.version)};

/** The CSS modules in the webview bundle, by their six-character hash. */
export type ModuleId =${union(modules, "  ")};

/**
 * The local class names each module defines. Module-scoped rather than flat because ${colliding.length}
 * local names exist in more than one module, and a flat map would resolve the wrong one silently.
 */
export interface ModuleClasses {
${moduleClassesInterface}
}

/** Requests the webview sends and expects a correlated reply to. */
export type OutboundRequest =${union(harvest.protocol.outboundRequests, "  ")};

/** Notifications the webview sends without expecting a reply. Includes the two envelope wrappers. */
export type OutboundNotification =${union(harvest.protocol.outboundNotifications, "  ")};

/** Pushes the extension host sends the webview unprompted. */
export type InboundPush =${union(harvest.protocol.inboundPushes, "  ")};

/** Requests the extension host makes of the webview. */
export type InboundRequest =${union(harvest.protocol.inboundRequests, "  ")};

/**
 * Replies to requests this webview sends, harvested from the host bundle and derived from the
 * request side, so a reply nothing here can trigger is not declarable. Requests with no reply by
 * naming convention:
${unanswered}
 */
export type InboundResponse =${union(tables.inboundResponses, "  ")};

/** Every message type a plugin may tap. */
export type MessageType =
  | OutboundRequest
  | OutboundNotification
  | InboundPush
  | InboundRequest
  | InboundResponse;

/**
 * The payload fields of each outbound message, which is what a rewrite may replace. The envelope
 * wrappers have no entry: their fields are correlation state. A type listed in PARTIAL_FIELD_TYPES
 * spreads a variable into its payload, so fields may exist that this cannot see; they are readable
 * but not declarable.
 */
export interface OutboundFields {
${outboundFieldsInterface}
}

/** Outbound types whose send site hides some fields behind a spread. */
export const PARTIAL_FIELD_TYPES: readonly string[] = ${JSON.stringify(tables.partialFieldTypes)};

/**
 * Stylesheet modules this build's markup does not contain, so no plugin can name them. Whole
 * modules only: a partially reachable module fails codegen, because it means the harvest is
 * dropping pairs.
 */
export const UNREACHABLE_CSS_MODULES: readonly string[] = ${JSON.stringify(unreachableModules)};

/**
 * The tables as data: what the host checks a manifest's declarations against. The same object is
 * written beside the injected loader as generated.js, per extension directory.
${missing}
 */
export const TABLES: IdentifierTables = ${JSON.stringify(tables, null, 2)};
`;
}

function renderRuntime(tables: IdentifierTables): string {
  return `// Written by prototype at install time from extension ${tables.version}. Do not edit.
export const TABLES = ${JSON.stringify(tables)};
`;
}
