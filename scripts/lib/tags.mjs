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
 * There are two refusals, and they want different sentences. One is a release on a superseded
 * major — `1.2.4` while `latest` is `2.0.0` — which belongs on a line tag such as `1.x`: this
 * pipeline does not set one, and of the two it does set, `latest` would be a downgrade for
 * everybody and `next` would strand the preview it carries. The other is a version that has simply
 * been released already, which is what a dry run against an unchanged tree is, and where a
 * suggested `1.x` names the line `latest` is on and reads as advice to do something strange.
 */
export function stageTag(version, { latest, next, hasStable }) {
  const isStable = semver.prerelease(version) === null;
  const above = (tag) => tag === null || semver.gt(version, tag);

  if (above(latest) && (isStable || !hasStable)) return { tag: "latest" };
  if (above(next)) return { tag: "next" };

  const held = `\`latest\` (${latest ?? "unset"}) or \`next\` (${next ?? "unset"})`;
  if (latest !== null && semver.major(version) < semver.major(latest)) {
    return {
      refusal:
        `${version} is on a superseded major: it is below ${held}, and a release there needs a ` +
        `line tag such as \`${semver.major(version)}.x\`, which this pipeline does not set.`,
    };
  }
  return {
    refusal:
      `${version} is not above ${held}, so there is nothing here to release: it has been ` +
      "published already, or the line has moved past it. Cut a new one with `pnpm release " +
      "<increment>`.",
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
