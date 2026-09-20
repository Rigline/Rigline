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
  publishedPackages,
  run,
  say,
} from "./lib/workspace.mjs";

const args = process.argv.slice(2);
const version = currentVersion();
const tagName = `v${version}`;
const packages = publishedPackages();

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

// Approval goes through pnpm: it takes the whole batch under one authentication and approves in
// dependency order, skipping any package whose workspace dependency did not make it rather than
// publishing against a dependency the registry never received.
say(`Approving ${version}. This needs your second factor.`);
say("");
try {
  run("pnpm", ["stage", "approve"]);
} catch {
  fail(
    "approval did not complete. If nothing is staged yet the release workflow may still be " +
      `running — check it, then run this again. \`npm stage list\` shows what is waiting.`,
  );
}

// Retagging goes through npm, not pnpm: `pnpm dist-tag` takes a typed one-time password and
// nothing else, and npm stopped accepting new TOTP enrolments in September 2025. `npm dist-tag`
// shares `otplease` with `npm publish`, whose first branch opens a browser.
say("");
const moved = [];
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
  run("npm", ["dist-tag", "add", `${name}@${version}`, "next"]);
  moved.push(name);
}
if (moved.length > 0)
  say(`  \`next\` moved to ${version} on ${moved.length} of ${packages.length}`);

if (!args.includes("--no-github-release")) {
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
say(`${version} is published.`);
