/**
 * The version arithmetic behind `pnpm corpus:add` (D148): which installed directory to snapshot,
 * and where the new version sits in the record.
 */
import semver from "semver";

/** `versions` with `version` added, oldest first. */
export function withVersion(versions, version) {
  return [...versions, version].sort(semver.compare);
}

/** The newest version in `versions` older than `version`, or null. */
export function previousVersion(versions, version) {
  return (
    versions
      .filter((v) => semver.lt(v, version))
      .sort(semver.compare)
      .at(-1) ?? null
  );
}

/**
 * The installed directory to snapshot, with its version: the newest of `dirs` (oldest first), or
 * the one reporting `version`. `versionOf` throws on a directory VS Code is part-way through
 * deleting, which is passed over rather than stopping the choice.
 */
export function pickInstalled(dirs, version, versionOf) {
  const known = dirs.flatMap((dir) => {
    try {
      return [{ dir, version: versionOf(dir) }];
    } catch {
      return [];
    }
  });
  if (version === undefined) return known.at(-1) ?? null;
  return known.find((entry) => entry.version === version) ?? null;
}
