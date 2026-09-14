/**
 * Rendering a harvest as code.
 *
 * Two outputs, from one object. `generated.ts` is the file an author commits in their own
 * repository, and that this repository commits at its workspace root: it augments
 * `@rigline/plugin-api`'s empty `RiglineIdentifiers` with the extension's own vocabulary, so
 * `ctx.cls("gGYT1w", "modelPill")` and `ctx.onMessage("rename_tab", ...)` are checked against the
 * version it was harvested from — and so a plugin that has never run codegen still compiles, every
 * union simply widening to `string` (decisions.md, D40). It carries no harvested *types* into the
 * published package, which is the whole point: a published snapshot could never carry the version
 * released tomorrow. Beside the augmentation it carries `SCAN`, the same harvest reduced to its
 * layer views, which is the baseline the update flow diffs the next version against (D29).
 *
 * It imports nothing, deliberately. The file sits at a workspace root, outside any package, and a
 * relative import out of one would be the first thing to break when an author moves it.
 *
 * `generated.js` is written beside the injected loader, per extension directory, and is what the
 * post hook checks declarations against at runtime: the loader itself carries nothing
 * version-specific, so one build of it serves every installed version (decisions.md, P7). That one
 * keeps the full tables as data, because the checks are made against data and not against types.
 *
 * Every union is emitted one member per line, so a class or message added upstream shows up in a
 * diff as one added line rather than a reflowed block.
 */
import type { IdentifierTables } from "@rigline/plugin-api";
import { type ResolvedAnchors, resolveAnchors } from "../anchors/resolve.ts";
import { type ClassMap, collidingLocalNames, unreachableCssClasses } from "../layers/classes.ts";
import { type Scan, scanToJson } from "../layers/diff.ts";
import { type Harvest, scanOf } from "../layers/index.ts";
import { allMessageTypes } from "../layers/protocol.ts";
import { HarvestError } from "../layers/types.ts";

/** Everything the two renderers need, derived once from a harvest. */
export interface Generated {
  readonly tables: IdentifierTables;
  /** The harvest reduced to its layer views: what `generated.ts` carries as `SCAN`. */
  readonly scan: Scan;
  /** Whole stylesheet modules the class map cannot reach, by module hash. */
  readonly unreachableModules: readonly string[];
  /** How this version answers the anchor table: what is missing, ambiguous, and uncheckable. */
  readonly anchors: ResolvedAnchors;
  /** The contents of `generated.ts`. */
  readonly source: string;
  /** The contents of `generated.js`. */
  readonly runtime: string;
  /** One line of counts, for reports. */
  readonly counts: string;
}

/** Build the tables and both renderings from a harvest. */
export function generate(harvest: Harvest): Generated {
  const gaps = unreachableCssClasses(harvest.classes.map, harvest.css);
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
    moduleClasses: sortedClassMap(harvest.classes.map),
    messageTypes: [
      ...new Set([...allMessageTypes(harvest.protocol), ...harvest.replies.responses]),
    ].sort(),
    inboundResponses: [...harvest.replies.responses].sort(),
    outboundFields: sortedRecord(harvest.fields.fields),
    partialFieldTypes: [...harvest.fields.partial].sort(),
    anchors: anchors.classes,
    anchorSelectors: anchors.selectors,
    unresolvedAnchors: anchors.reasons,
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
    `${anchorSummary(anchors)}`;

  const scan = scanOf(harvest);
  return {
    tables,
    scan,
    unreachableModules,
    anchors,
    source: renderSource(harvest, tables, scan, unreachableModules, anchors),
    runtime: renderRuntime(tables),
    counts,
  };
}

/**
 * The anchor half of the counts line. Ambiguity is named apart from absence because they are
 * repaired differently: a missing anchor waits for the extension or for a new pair, an ambiguous
 * one waits for a refinement somebody in this repo can write today.
 */
function anchorSummary(anchors: ResolvedAnchors): string {
  const parts: string[] = [];
  if (anchors.missing.length > 0) parts.push(`${anchors.missing.length} anchors missing`);
  if (anchors.ambiguous.length > 0) parts.push(`${anchors.ambiguous.length} anchors ambiguous`);
  if (anchors.unverified.length > 0) parts.push(`${anchors.unverified.length} anchors unverified`);
  return parts.length === 0 ? "every anchor resolved" : parts.join(", ");
}

function sortedClassMap(map: ClassMap): IdentifierTables["moduleClasses"] {
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
  scan: Scan,
  unreachableModules: readonly string[],
  anchors: ResolvedAnchors,
): string {
  const modules = Object.keys(tables.moduleClasses);
  const colliding = collidingLocalNames(harvest.classes.map);
  const classesMember = modules
    .map(
      (m) =>
        `      ${JSON.stringify(m)}:${union(Object.keys(tables.moduleClasses[m] ?? {}), "        ")};`,
    )
    .join("\n");
  const fieldsMember = Object.keys(tables.outboundFields)
    .map((t) => `      ${JSON.stringify(t)}:${union(tables.outboundFields[t] ?? [], "        ")};`)
    .join("\n");
  const unanswered =
    harvest.replies.unanswered.length === 0
      ? "// Every request this webview sends has a reply by naming convention."
      : [
          "// Requests this webview sends that have no reply by naming convention:",
          ...harvest.replies.unanswered.map((r) => `//   ${r}`),
        ].join("\n");
  const partial =
    tables.partialFieldTypes.length === 0
      ? "// Every outbound type's field list is complete."
      : [
          "// These outbound types spread a variable into their payload, so they may carry fields",
          "// the harvest cannot see. Those are readable at runtime and not declarable:",
          ...tables.partialFieldTypes.map((t) => `//   ${t}`),
        ].join("\n");
  const missing =
    anchors.missing.length === 0
      ? "Every curated anchor resolves in this version."
      : `Anchors that do not resolve in this version: ${anchors.missing.join(", ")}.`;
  const ambiguous =
    anchors.ambiguous.length === 0
      ? "Every anchor naming one element resolves to a class this build applies in one place."
      : `Anchors naming one element whose class this build applies in several places, with no refinement to tell them apart: ${anchors.ambiguous
          .map((a) => `${a.name} (${a.sites} sites)`)
          .join(", ")}.`;
  const unreachable =
    unreachableModules.length === 0
      ? "Every stylesheet module is reachable from this build's markup."
      : `Stylesheet modules this build's markup does not contain, so no plugin can name them: ${unreachableModules.join(", ")}.`;

  return `// Generated by rigline codegen from extension ${tables.version}. Do not edit.
// Regenerate with: rigline codegen
//
// Commit this file. It is the record of the extension version these plugins were built and tested
// against: it narrows what \`ctx.cls\`, \`ctx.onMessage\` and \`ctx.rewrite\` will accept, and it is the
// baseline \`rigline update\` diffs the next version against. Delete it and everything still
// compiles, with every identifier widened back to \`string\`.
//
// ${missing}
// ${ambiguous}
// ${unreachable}
// ${colliding.length} local class names exist in more than one module, which is why classes are
// module-scoped here rather than flat: a flat map would resolve the wrong one silently.
//
${unanswered}
//
${partial}

export const EXTENSION_VERSION = ${JSON.stringify(tables.version)};

declare module "@rigline/plugin-api" {
  interface RiglineIdentifiers {
    /** The CSS modules in the webview bundle, by their six-character hash. */
    modules:${union(modules, "      ")};

    /** The local class names each module defines. */
    classes: {
${classesMember}
    };

    /** Every message type a plugin may tap: all four protocol directions plus the reachable replies. */
    messages:${union(tables.messageTypes, "      ")};

    /**
     * The payload fields of each outbound message, which is what a rewrite may replace. The
     * envelope wrappers have no entry: their fields are correlation state. A type whose send site
     * spreads a variable in may carry fields this cannot see; they are readable but not declarable.
     */
    outboundFields: {
${fieldsMember}
    };
  }
}

/**
 * The harvest reduced to its layer views: the baseline for "what moved since the version these
 * plugins were built against" (decisions.md, D29). Read by \`rigline update\`, never by a plugin.
 */
export const SCAN = ${JSON.stringify(scanToJson(scan), null, 2)};
`;
}

function renderRuntime(tables: IdentifierTables): string {
  return `// Written by rigline at install time from extension ${tables.version}. Do not edit.
export const TABLES = ${JSON.stringify(tables)};
`;
}
