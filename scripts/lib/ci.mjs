/**
 * What a release does with `ci.yml`'s verdict on the commit it would tag (D149): carry on only on
 * green, wait for a run still going, and refuse everything else.
 */

/** GitHub's statuses for a run that has not finished; anything else `runVerdict` returns is an end. */
const PENDING = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

export function ciGate(verdict, sha) {
  if (verdict === "success") return { action: "proceed" };
  if (PENDING.has(verdict)) return { action: "wait" };
  const short = sha.slice(0, 8);
  const reasons = {
    "no run":
      `CI has not run on ${short}, the commit this would tag, so it has not been pushed. ` +
      "Push it, let CI finish, and run this again",
    "gh unavailable":
      `the GitHub CLI could not say whether CI passed on ${short}. ` +
      "Install `gh` and run `gh auth login`: the release needs CI's verdict",
    failure:
      `CI failed on ${short}, the commit this would tag. A version cut on a red tree is spent, ` +
      "and this one is not yet — read that run, fix it, push, and cut from the green commit",
  };
  return {
    action: "refuse",
    reason:
      reasons[verdict] ??
      `CI ended ${verdict} on ${short}, the commit this would tag. Run it again until it is green`,
  };
}
