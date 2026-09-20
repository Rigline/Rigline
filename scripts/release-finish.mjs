#!/usr/bin/env node
/**
 * The half of a release that needs a person: approve what CI staged, reconcile `next`, and put the
 * notes on a GitHub release (D61).
 *
 * All three belong after approval rather than in the workflow. npm's OIDC exchange authenticates
 * `publish` and `stage publish` and nothing else, and `otplease` — the wrapper every 2FA'd npm
 * write goes through — re-throws unless stdin and stdout are a TTY, so a runner has no second
 * factor to offer. A dist-tag cannot point at a version the registry does not have yet in any case.
 *
 * Every step is safe to repeat, because a half-finished release is the likeliest way to arrive
 * here twice: an authentication cancelled on the third package leaves `next` half-moved, and the
 * answer is to run this again rather than to reconstruct by hand what it got to.
 *
 * Usage: pnpm release:finish [--no-github-release]
 */
import semver from "semver";
import { nextShouldMove } from "./lib/tags.mjs";
import {
  capture,
  changelogSection,
  currentVersion,
  distTags,
  fail,
  npmAccountOrNull,
  publishedPackages,
  publishedVersions,
  run,
  say,
} from "./lib/workspace.mjs";

const args = process.argv.slice(2);
const version = currentVersion();
const tagName = `v${version}`;
const packages = publishedPackages();

// Before anything else, because every step below authenticates and a session that has lapsed is a
// person's to fix. It is also the cheapest place to find out: by the time this command runs, the
// tag is pushed and the workflow is green.
const account = npmAccountOrNull();
if (account === null) {
  fail(
    "`npm whoami` names no account, so nothing below can authenticate. `npm login` — which " +
      "prints one URL and then goes quiet while it polls — and run this again",
  );
}

if (capture("git", ["tag", "--list", tagName]) === "") {
  fail(`${tagName} does not exist here. Cut the release first with \`pnpm release <increment>\``);
}

// The version comes from the tree, and approval takes whatever is staged — so a checkout that has
// moved since the release makes those two different things. It is the maintenance case that makes
// this real: cut 1.2.4 on a `1.x` branch, switch back to main while CI runs, and `stage approve`
// would correctly publish 1.2.4 while everything below pointed tags at main's version instead.
if (capture("git", ["rev-list", "-n", "1", tagName]) !== capture("git", ["rev-parse", "HEAD"])) {
  fail(
    `HEAD is not the commit ${tagName} names, so ${version} is not the version this checkout is ` +
      `releasing. \`git checkout ${tagName}\` (or the branch you cut it from) and run this again.`,
  );
}

// Read `versions` here and `dist-tags` only after the approval, never both at once: approval is
// what sets `next` when the stage went up under it, so a single pre-approval snapshot sees the old
// value and spends four authenticated writes where it should spend none.
//
// Three answers, not two. Partial approval is real — `stage approve` skips a package whose
// workspace dependency did not make it — and a binary published-or-not check answers it wrongly
// and strands the stragglers for good, because the next release stages a different version.
const already = packages.filter((name) => publishedVersions(name).includes(version));

if (already.length === packages.length) {
  say(`All ${packages.length} packages are on the registry at ${version} already.`);
} else {
  if (already.length > 0) {
    say(`${already.join(", ")} already published. Approving again for the rest.`);
    say("");
  }
  say(`Approving ${version} as ${account}. This needs your second factor.`);
  say("");
  try {
    // Approval goes through pnpm: it takes the whole batch under one authentication and approves
    // in dependency order, skipping any package whose workspace dependency did not make it rather
    // than publishing against a dependency the registry never received.
    run("pnpm", ["stage", "approve"]);
  } catch {
    fail(
      "approval did not complete. If nothing is staged yet the release workflow may still be " +
        "running — check it, then run this again. `npm stage list` shows what is waiting, and " +
        "running this twice costs nothing",
    );
  }
}

// Retagging goes through npm, not pnpm: `pnpm dist-tag` takes a typed one-time password and
// nothing else, and npm stopped accepting new TOTP enrolments in September 2025. `npm dist-tag`
// shares `otplease` with `npm publish`, whose first branch opens a browser.
//
// One package at a time, each caught: a cancelled authentication partway through must not take the
// ones after it with it. `npm dist-tag add` is idempotent, so the recovery is this whole command
// again and there is no resume state for anybody to carry.
say("");
const moved = [];
const stuck = [];
for (const name of packages) {
  const { next } = distTags(name);
  // Equality first: `nextShouldMove` is a `semver.gt`, so it already says no for the version that
  // was staged under `next` — and "stays at X, which is ahead of X" is not what happened.
  if (next === version) {
    say(`  ${name}: \`next\` is already ${version}, set by the publish`);
    continue;
  }
  if (!nextShouldMove(version, next)) {
    say(`  ${name}: \`next\` stays at ${next}, which is ahead of ${version}`);
    continue;
  }
  try {
    run("npm", ["dist-tag", "add", `${name}@${version}`, "next"]);
    moved.push(name);
  } catch {
    stuck.push(name);
    say(`  ${name}: \`next\` not moved — npm dist-tag add ${name}@${version} next`);
  }
}
if (moved.length > 0)
  say(`  \`next\` moved to ${version} on ${moved.length} of ${packages.length}`);

if (!args.includes("--no-github-release") && !githubReleaseExists()) {
  const notes = changelogSection(version);
  try {
    run("gh", [
      "release",
      "create",
      tagName,
      "--title",
      tagName,
      "--notes",
      (notes ?? "").trim(),
      ...(semver.prerelease(version) === null ? [] : ["--prerelease"]),
    ]);
    say(`GitHub release ${tagName} created.`);
  } catch {
    // Not a failure worth exiting on: the packages are published, which is the part that matters.
    say(`Could not create the GitHub release for ${tagName} — \`gh release create ${tagName}\`.`);
  }
}

say("");
if (stuck.length === 0) {
  say(`${version} is published.`);
} else {
  say(`${version} is published, and \`next\` still points elsewhere on ${stuck.join(", ")}.`);
  say("Run `pnpm release:finish` again: it skips what is done and retries only those.");
  process.exitCode = 1;
}

/**
 * Asked rather than discovered from a failed create, so a second run does not report a release
 * that exists as one it could not make. False for an uninstalled `gh` too, which the create below
 * then reports the way it reports any other reason it could not run.
 */
function githubReleaseExists() {
  try {
    capture("gh", ["release", "view", tagName, "--json", "tagName"]);
    say(`GitHub release ${tagName} exists already.`);
    return true;
  } catch {
    return false;
  }
}
