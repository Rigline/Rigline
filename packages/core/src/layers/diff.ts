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
 * A plain-text report of a diff, one line per view, with the first few casualties named.
 *
 *     2.1.268 -> 2.1.270
 *      classes.classes    99.2% kept  -7  +19
 *        gone: navTab_hONcXw, ...
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
    }
  }
  return lines.join("\n");
}
