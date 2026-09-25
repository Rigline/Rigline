/**
 * The stability diff: what moved between two harvests, by layer view.
 *
 * Every layer projects its harvest onto named identifier sets (`Layer.views`), and this compares
 * those sets pairwise. The views are the unit of reporting because "a module was retired" and "a
 * local name was renamed" are different news, and a reply-only regression diluted into a
 * message-type percentage would read as nothing having happened.
 *
 * The percentages are for reading, not for gating. Roughly one class name in sixteen goes missing
 * over a couple of months of releases, nearly all of them names nothing depends on, so a retention
 * threshold measures the wrong thing. What gates an install is whether something a plugin
 * declared has gone, which is a question for the declaration check, asked of the installed bundle
 * alone.
 */

/** One harvest reduced to its views: the shape a baseline is stored in and compared as. */
export interface Scan {
  readonly version: string;
  /** `layerId.viewName` -> the identifiers that view held. */
  readonly views: Readonly<Record<string, ReadonlySet<string>>>;
}

/** A serialisable `Scan`, as written to a baseline file. */
export interface ScanJson {
  readonly version: string;
  readonly views: Readonly<Record<string, readonly string[]>>;
}

export interface ViewDiff {
  /** `layerId.viewName`. */
  readonly view: string;
  /** In `from`, not in `to`. Sorted. */
  readonly gone: readonly string[];
  /** In `to`, not in `from`. Sorted. */
  readonly added: readonly string[];
  /** Fraction of `from` that survives, or null when `from` was empty rather than a percentage of nothing. */
  readonly kept: number | null;
}

/** Compare two scans view by view. Views present on only one side are reported against an empty set. */
export function diffScans(from: Scan, to: Scan): ViewDiff[] {
  const names = new Set([...Object.keys(from.views), ...Object.keys(to.views)]);
  return [...names].sort().map((view) => {
    const a = from.views[view] ?? new Set<string>();
    const b = to.views[view] ?? new Set<string>();
    const gone = [...a].filter((id) => !b.has(id)).sort();
    const added = [...b].filter((id) => !a.has(id)).sort();
    const kept = a.size === 0 ? null : (a.size - gone.length) / a.size;
    return { view, gone, added, kept };
  });
}

/** Whether anything at all moved. */
export function scansDiffer(diffs: readonly ViewDiff[]): boolean {
  return diffs.some((d) => d.gone.length > 0 || d.added.length > 0);
}

export function scanToJson(scan: Scan): ScanJson {
  const views: Record<string, string[]> = {};
  for (const [name, ids] of Object.entries(scan.views).sort(([x], [y]) => x.localeCompare(y))) {
    views[name] = [...ids].sort();
  }
  return { version: scan.version, views };
}

export function scanFromJson(json: ScanJson): Scan {
  const views: Record<string, ReadonlySet<string>> = {};
  for (const [name, ids] of Object.entries(json.views)) views[name] = new Set(ids);
  return { version: json.version, views };
}

/**
 * The one view whose identifiers carry their module in the string itself (decisions.md, D45): a
 * full hashed class is `<local>_<hash>`, and the hash is the module's identity and is stable across
 * builds (classes.ts, D6), so a name gone from a module and a name arrived in the *same* module is
 * the shape an actual rename leaves in the diff.
 *
 * No other view is grouped this way, and that is read off what the views hold rather than assumed:
 * a protocol message type, a payload field (`type.key`) or a reply name is a bare identifier with
 * no embedded grouping key, so "arrived in the same place" is not a question that can be asked of
 * them — there is no place, only a flat set. Sniffing the shape instead of naming the view was tried
 * and rejected: an identifier such as `__REACT_DEVTOOLS_GLOBAL_HOOK__` ends in
 * `_HOOK__`, six word characters after an underscore, and would parse as local
 * `__REACT_DEVTOOLS_GLOBAL` in a fictitious module `HOOK__` — the exact coincidental match
 * `classes.ts`'s own harvest comment warns about for `sessionId:"abc123_OOQiHg"`. Naming the view
 * keeps the suggestion honest instead of confident-looking (P8).
 */
const MODULE_SCOPED_VIEW = "classes.classes";

/**
 * A full hashed class, anchored at both ends and bounded to a six-character hash — never `.*` —
 * matching what `classes.ts` harvests. The local group is greedy for the reason `CSS_CLASS_RULE` in
 * that file is: a local name may itself contain an underscore or hyphen
 * (`mcpStatus_needs-auth_yumWmQ`), so the engine consumes as much as it can and backtracks only far
 * enough to leave a valid six-character tail, landing the hash on the *last* underscore group.
 */
const HASHED_CLASS = /^([A-Za-z_$][\w$-]*)_([A-Za-z0-9_-]{6})$/;

/** The module a full hashed class belongs to, or null when the identifier isn't shaped that way. */
function moduleOf(id: string): string | null {
  return HASHED_CLASS.exec(id)?.[2] ?? null;
}

/** Group identifiers by module, dropping any that don't parse as `<local>_<hash>`. */
function byModule(ids: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const module = moduleOf(id);
    if (module === null) continue;
    const group = groups.get(module);
    if (group) group.push(id);
    else groups.set(module, [id]);
  }
  return groups;
}

/**
 * A same-module pairing between what left and what arrived (decisions.md, D45).
 *
 * `rename` fires when the module lost and gained exactly one name each — the one case where naming
 * a specific pair is more than a guess. `group` fires when it changed by more than one name on
 * either side: naming *a* pair there would be confident-looking and wrong as often as right, which
 * is the same failure D45 refuses for an automatic remap, so the group is named instead of a choice
 * among its members (P8: absent beats wrong, and a count is not wrong the way a bad pairing is). A
 * module that only lost names, or only gained them, produces no suggestion at all — that is a
 * retirement or an addition, not a rename, and this function names successors, not inventions.
 */
export type SuccessorSuggestion =
  | {
      readonly module: string;
      readonly kind: "rename";
      readonly gone: string;
      readonly added: string;
    }
  | {
      readonly module: string;
      readonly kind: "group";
      readonly goneCount: number;
      readonly addedCount: number;
    };

/**
 * Pair `diff.gone` with `diff.added`, module-scoped, for `MODULE_SCOPED_VIEW`. Every other view
 * returns nothing — on purpose, not for lack of a pattern that happens to match (see above).
 *
 * The only signal used is "same module": no similarity score, no prefix match, no edit distance.
 * Either a module is unambiguous (exactly one gone, one added) and worth naming, or it isn't and
 * the honest report is a count, not a guess dressed as a measurement.
 */
export function successorSuggestions(diff: ViewDiff): readonly SuccessorSuggestion[] {
  if (diff.view !== MODULE_SCOPED_VIEW) return [];

  const gone = byModule(diff.gone);
  const added = byModule(diff.added);
  const suggestions: SuccessorSuggestion[] = [];

  for (const [module, goneNames] of gone) {
    const addedNames = added.get(module);
    if (addedNames === undefined) continue;
    const goneName = goneNames[0];
    const addedName = addedNames[0];
    if (
      goneNames.length === 1 &&
      addedNames.length === 1 &&
      goneName !== undefined &&
      addedName !== undefined
    ) {
      suggestions.push({ module, kind: "rename", gone: goneName, added: addedName });
    } else {
      suggestions.push({
        module,
        kind: "group",
        goneCount: goneNames.length,
        addedCount: addedNames.length,
      });
    }
  }

  return suggestions.sort((a, b) => a.module.localeCompare(b.module));
}

/**
 * A suggestion as a labelled line. The label changes with the kind, because the two say different
 * things: one names a successor, the other only says where to look for one.
 */
function formatSuggestion(s: SuccessorSuggestion): string {
  return s.kind === "rename"
    ? `successor: ${s.gone} -> ${s.added}`
    : `candidates: module ${s.module} lost ${s.goneCount} and gained ${s.addedCount}`;
}

/**
 * A plain-text report of a diff, one line per view, with the first few casualties named and, where
 * a same-module successor can be named (see `successorSuggestions`), a line per suggestion under
 * the `gone:` line it belongs to.
 *
 *     2.1.268 -> 2.1.270
 *      classes.classes    99.2% kept  -7  +19
 *        gone: navTab_hONcXw, ...
 *        successor: navTabOld_hONcXw -> navTabNew_hONcXw
 *
 * Suggestions share `nameLimit` rather than a parameter of their own: a module producing more
 * candidate pairs than `nameLimit` already names would be an unusually large release, and a second
 * knob nobody would tune independently is not worth the surface.
 */
export function formatDiff(
  from: Scan,
  to: Scan,
  diffs: readonly ViewDiff[],
  nameLimit = 15,
): string {
  const lines = [`${from.version} -> ${to.version}`];
  for (const d of diffs) {
    const pct = d.kept === null ? "n/a" : `${(d.kept * 100).toFixed(1)}%`;
    lines.push(
      ` ${d.view.padEnd(20)} ${pct.padStart(6)} kept  -${d.gone.length}  +${d.added.length}`,
    );
    if (d.gone.length > 0) {
      const shown = d.gone.slice(0, nameLimit).join(", ");
      const more = d.gone.length > nameLimit ? `, and ${d.gone.length - nameLimit} more` : "";
      lines.push(`   gone: ${shown}${more}`);
      const suggestions = successorSuggestions(d);
      for (const suggestion of suggestions.slice(0, nameLimit)) {
        lines.push(`   ${formatSuggestion(suggestion)}`);
      }
      if (suggestions.length > nameLimit) {
        lines.push(`   and ${suggestions.length - nameLimit} more module(s) with both`);
      }
    }
  }
  return lines.join("\n");
}
