/**
 * Deriving both dist-tags from the version and what the registry already holds (D61).
 *
 * Two sentences define them and everything here falls out: `next` points at the newest version, and
 * `latest` points at the newest version a naive `npm install` should get — the newest stable one, or
 * the newest of any kind while no stable one exists.
 */
import semver from "semver";
import { distTags, publishedVersions } from "./workspace.mjs";

/**
 * What the four packages jointly hold. They move in lockstep, so these are one answer rather than
 * four; where a drift has left them disagreeing, the highest wins, which can only make the decision
 * below more cautious — never a downgrade.
 */
export function registryState(packages) {
  let latest = null;
  let next = null;
  let hasStable = false;
  for (const name of packages) {
    const tags = distTags(name);
    if (tags.latest && (latest === null || semver.gt(tags.latest, latest))) latest = tags.latest;
    if (tags.next && (next === null || semver.gt(tags.next, next))) next = tags.next;
    if (publishedVersions(name).some((v) => semver.prerelease(v) === null)) hasStable = true;
  }
  return { latest, next, hasStable };
}

/**
 * The tag to stage under, or a refusal explaining why neither is right.
 *
 * The refusal is a release on a superseded major — `1.2.4` while `latest` is `2.0.0`. It belongs on
 * a line tag such as `1.x`, which this pipeline does not do; staging it to `latest` would be a
 * downgrade for everybody and staging it to `next` would strand the preview that tag is carrying.
 */
export function stageTag(version, { latest, next, hasStable }) {
  const isStable = semver.prerelease(version) === null;
  const above = (tag) => tag === null || semver.gt(version, tag);

  if (above(latest) && (isStable || !hasStable)) return { tag: "latest" };
  if (above(next)) return { tag: "next" };

  return {
    refusal:
      `${version} is not above \`latest\` (${latest}) or \`next\` (${next}), so neither tag ` +
      "describes it. A release on a superseded major needs a line tag such as " +
      `\`${semver.major(version)}.x\`, which this pipeline does not set.`,
  };
}

/** Whether `next` should be pointed at the released version once it is on the registry. */
export function nextShouldMove(version, currentNext) {
  return currentNext === undefined || currentNext === null || semver.gt(version, currentNext);
}

/**
 * `registryState`, or null when the registry cannot be reached.
 *
 * For the local command, where the derived tag is shown rather than used: a release should not be
 * blocked by a network the workflow will have anyway, and every tag decision that matters is made
 * again in CI from the same two functions.
 */
export function registryStateOrNull(packages) {
  try {
    return registryState(packages);
  } catch {
    return null;
  }
}
