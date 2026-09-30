/**
 * The probe's verdict logic, pure: nothing here touches the DOM or `ctx`, so each verdict is argued
 * about in Node. The wiring is in index.ts.
 */

export type Verdict = "pass" | "fail" | "n/a";

/** The message of a thrown value, for a detail string. `Error` when it is one, `String()` otherwise. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A tap's payload, and once seen, its nested `request` object, are frozen. */
export function immutabilityVerdict(
  nestedSeen: boolean,
  topFrozen: boolean,
  nestedFrozen: boolean,
): { verdict: Verdict; detail: string } {
  if (!nestedSeen) return { verdict: "n/a", detail: "no request with a nested object yet" };
  if (topFrozen && nestedFrozen) return { verdict: "pass", detail: "top+nested" };
  const broken = !topFrozen && !nestedFrozen ? "top and nested" : !topFrozen ? "top" : "nested";
  return { verdict: "fail", detail: `${broken} not frozen` };
}

/**
 * The two-rewriter chain on `rename_tab` composes. `composed` latches true the first time the
 * second rewriter sees the first's mark; once true it stays true, because the claim being proved is
 * "we have been seen to compose", which a later message cannot un-observe.
 */
export function chainComposeVerdict(
  crossed: boolean,
  composed: boolean,
): { verdict: Verdict; detail: string } {
  if (composed) return { verdict: "pass", detail: "second rewriter saw the first's mark" };
  if (!crossed) return { verdict: "n/a", detail: "no rename_tab has crossed yet" };
  return { verdict: "fail", detail: "second rewriter did not see the first's mark" };
}

/** A read tap on `rename_tab` never saw the chain's own mark on the wire. Never quotes the title. */
export function leakVerdict(seen: boolean, leaked: boolean): { verdict: Verdict; detail: string } {
  if (!seen) return { verdict: "n/a", detail: "no rename_tab tapped yet" };
  if (leaked) return { verdict: "fail", detail: "a title carried the mark onto the wire" };
  return { verdict: "pass", detail: "clean" };
}
