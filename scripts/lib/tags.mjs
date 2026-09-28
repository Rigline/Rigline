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
  // A preview: only once a stable line exists, and only ahead of it. `next` is unset outside an open
  // preview line (see `nextAction`), so `above(next)` alone is vacuously true, and a version merely
  // *not new* — a dry run, or `1.0.2` with `latest` on `1.1.0` — would stage under `next` instead of
  // being refused.
  if (hasStable && above(latest) && above(next)) return { tag: "next" };

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

/**
 * What to do with `next` once `version` is on the registry: `set` it, `remove` it, or `keep` it.
 *
 * `next` exists only while a preview line is open (D61). A prerelease over a stable line opens or
 * advances one, so it sets `next` where the publish has not already. A stable release closes the
 * line it supersedes, so it removes a `next` at or below it, and keeps one ahead of it: a preview
 * beyond a maintenance release. With no stable line, `latest` already names the newest version of
 * any kind and there is nothing to preview. Every other release costs no authentication, since each
 * `npm dist-tag` write asks for a second factor of its own.
 */
export function nextAction(version, currentNext, hasStable) {
  if (!hasStable) return "keep";
  const next = currentNext ?? null;
  if (semver.prerelease(version) === null) {
    return next !== null && !semver.gt(next, version) ? "remove" : "keep";
  }
  return next === null || semver.gt(version, next) ? "set" : "keep";
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
