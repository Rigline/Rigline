/**
 * What a contributed check answers with.
 *
 * A check is a question the panel asks, not an event a contributor emits: the host calls it and it
 * returns, synchronously, from state the contributor already keeps. Nothing is handed in, and a
 * plugin's check is capability-scoped by construction — whatever it reaches for, it reaches for
 * through the same `ctx` that was scoped when it was built.
 *
 * The three verdicts are the ones the probe has always reported, and `n/a` is a real state rather
 * than a soft failure: a check that cannot apply on this surface, or has had no opportunity yet,
 * says so instead of guessing.
 */

export type Verdict = "pass" | "fail" | "n/a";

export interface CheckVerdict {
  readonly verdict: Verdict;
  /** One line, for the panel. What the verdict is about, not that it is a verdict. */
  readonly detail?: string;
}
