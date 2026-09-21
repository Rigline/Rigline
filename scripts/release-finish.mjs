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

/**
 * The tag has to be in this checkout's history — not at the tip of it.
 *
 * The version comes from the tree and approval takes whatever is staged, so a checkout on a
 * *different line* makes those two different things. That is the maintenance case this exists for:
 * cut 1.2.4 on a `1.x` branch, switch back to main while CI runs, and `stage approve` would
 * correctly publish 1.2.4 while everything below it pointed tags at main's version instead. A tag
 * cut on another line is not an ancestor of this HEAD, so that still refuses.
 *
 * Requiring HEAD to *be* the tagged commit also refused the ordinary case, which is the one that
 * actually happens: cut a release, carry on working while the run goes green, come back and approve.
 * Nothing here needs the tip — approval acts on a stage the workflow already built from the tagged
 * commit, `dist-tag` names a published version, and the GitHub release is created at `tagName`
 * rather than at HEAD. Only the notes are read from the tree, and a commit that changed them would
 * have to have changed this version's own section to matter.
 */
function tagIsInHistory(tag) {
  try {
    run("git", ["merge-base", "--is-ancestor", tag, "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!tagIsInHistory(tagName)) {
  fail(
    `${tagName} is not in this checkout's history, so ${version} is not the version this checkout ` +
      `is releasing. Switch to the branch you cut it from (or \`git checkout ${tagName}\`) and run ` +
      "this again.",
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
