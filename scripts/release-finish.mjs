#!/usr/bin/env node
/**
 * The half of a release that needs a person: approve what CI staged, reconcile `next`, and put the
 * notes on a GitHub release (D61, D146).
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
import { setTimeout as sleep } from "node:timers/promises";
import semver from "semver";
import { approvalOrder, stageReadiness } from "./lib/release-set.mjs";
import { nextAction } from "./lib/tags.mjs";
import {
  capture,
  changelogSection,
  currentVersion,
  distTags,
  fail,
  npmAccountOrNull,
  publishedManifests,
  publishedPackages,
  publishedVersions,
  run,
  runVerdict,
  say,
} from "./lib/workspace.mjs";

const POLL_MS = 30_000;

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
 * cut 1.2.4 on a `1.x` branch, switch back to main while CI runs, and approval would correctly
 * publish 1.2.4 while everything below it pointed tags at main's version instead. A tag cut on
 * another line is not an ancestor of this HEAD, so that still refuses.
 *
 * Nothing here needs the tip — approval acts on a stage the workflow already built from the tagged
 * commit, `dist-tag` names a published version, and the GitHub release is created at `tagName`
 * rather than at HEAD — so carrying on working while the run goes green is fine.
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

/** npm's page for approving by hand: the fallback for when the browser step here cannot complete. */
function stagedPackagesUrl(user) {
  return `https://www.npmjs.com/settings/${user ?? "<your-npm-user>"}/staged-packages`;
}

/**
 * Everything staged on the account, or null when npm would not say. Through npm rather than pnpm:
 * a stage belongs to the registry, not to the client that made it.
 */
function stagedItems() {
  try {
    const staged = JSON.parse(capture("npm", ["stage", "list", "--json"]));
    return Array.isArray(staged) ? staged : null;
  } catch {
    return null;
  }
}

/**
 * Wait until every package still to publish has a stage that npm has finished checking, saying
 * what changes as it changes. No timeout: Ctrl-C and a second run pick up where this was.
 */
async function waitForStages(names) {
  const sha = capture("git", ["rev-parse", `${tagName}^{commit}`]);
  const shown = new Map();
  let unreadable = false;
  for (;;) {
    const stages = stagedItems();
    if (stages === null) {
      if (!unreadable) say("  `npm stage list` did not answer; asking again");
      unreadable = true;
      await sleep(POLL_MS);
      continue;
    }
    unreadable = false;
    const { rows, verdict } = stageReadiness(stages, names, version);
    for (const row of rows) {
      if (shown.get(row.name) === row.status) continue;
      shown.set(row.name, row.status);
      say(`  ${clock()}  ${row.name}  ${row.status}`);
    }
    if (verdict === "ready") return rows;
    if (verdict === "stuck") {
      const odd = rows.filter(
        (row) => row.id !== null && !["staged", "validating"].includes(row.status),
      );
      fail(
        `npm has not passed ${odd.map((row) => `${row.name} (${row.status})`).join(", ")}, so ` +
          `nothing was approved. \`npm stage view ${odd[0].id}\` says why`,
      );
    }
    // A failed run stages nothing, and nothing else would end the wait.
    if (rows.some((row) => row.id === null) && runVerdict("release.yml", sha) === "failure") {
      fail(
        `the release run for ${tagName} failed, so what it did not stage never will be. Read that ` +
          "run; the version is spent, and the fix is the next one (docs/releasing.md, *If something " +
          "goes wrong*)",
      );
    }
    await sleep(POLL_MS);
  }
}

function clock() {
  return new Date().toTimeString().slice(0, 5);
}

/** Every package at the version, asked a few times, since a version just approved can lag a read. */
async function missingFromRegistry() {
  let missing = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    missing = packages.filter((name) => !publishedVersions(name).includes(version));
    if (missing.length === 0) return missing;
    await sleep(10_000);
  }
  return missing;
}

// Read `versions` here and `dist-tags` only after the approval, never both at once: approval is
// what sets `next` when the stage went up under it, so a single pre-approval snapshot sees the old
// value and spends four authenticated writes where it should spend none.
const already = packages.filter((name) => publishedVersions(name).includes(version));

if (already.length === packages.length) {
  say(`All ${packages.length} packages are on the registry at ${version} already.`);
} else {
  const order = approvalOrder(publishedManifests()).filter((name) => !already.includes(name));
  if (already.length > 0) say(`${already.join(", ")} already published at ${version}.`);
  say(`Waiting for ${version} to be staged and checked, then approving in this order:`);
  say(`  ${order.join(", ")}`);
  say("");
  const rows = await waitForStages(order);

  // One at a time, in order, all through npm: its `stage approve` opens the browser for a security
  // key and asks for a typed code otherwise, where pnpm's only asks for the code. Stopping at the
  // first refusal leaves published only packages whose dependencies are (D146).
  say("");
  say(`Approving as ${account}. Each package asks for your second factor.`);
  const approved = [];
  for (const row of rows) {
    say("");
    say(`${row.name}@${version}`);
    try {
      run("npm", ["stage", "approve", row.id]);
      approved.push(row.name);
    } catch {
      fail(
        `${row.name} was not approved` +
          (approved.length > 0 ? `, after ${approved.join(", ")}. ` : ". ") +
          "Nothing that needs it was approved either. `npm stage view " +
          `${row.id}\` says what npm thinks of the stage. Run this again to carry on from it, or ` +
          `approve the rest at ${stagedPackagesUrl(account)} in the order above and then run this ` +
          "again for the retag and the GitHub release",
      );
    }
  }
}

const missing = await missingFromRegistry();
if (missing.length > 0) {
  fail(
    `the registry does not show ${version} for ${missing.join(", ")}, so the release is not whole. ` +
      "Run this again; `npm stage list` shows what is still waiting",
  );
}

// Retagging goes through npm, not pnpm: `pnpm dist-tag` takes a typed one-time password and
// nothing else, and npm stopped accepting new TOTP enrolments in September 2025. `npm dist-tag`
// shares `otplease` with `npm publish`, whose first branch opens a browser.
//
// One package at a time, each caught: a cancelled authentication partway through must not take the
// ones after it with it. A second run finds each package it finished already right and skips it,
// so the recovery is this whole command again and there is no resume state for anybody to carry.
say("");
// Whether any package has ever had a stable release, which is what decides `next` has a job at all.
// Read from `versions` rather than from the tags: a line is stable once a stable version exists,
// whatever the pointers happen to say, and this must not depend on the tag it is about to set.
const hasStable = packages.some((name) =>
  publishedVersions(name).some((v) => semver.prerelease(v) === null),
);
if (!hasStable) {
  say("  `next` is not maintained while no stable release exists — `latest` is already the newest");
}
const moved = [];
const stuck = [];
for (const name of hasStable ? packages : []) {
  const { next } = distTags(name);
  const action = nextAction(version, next, hasStable);
  if (action === "keep") {
    if (next === version) say(`  ${name}: \`next\` is already ${version}, set by the publish`);
    else if (next) say(`  ${name}: \`next\` stays at ${next}, a preview ahead of ${version}`);
    continue;
  }
  const argv =
    action === "set"
      ? ["dist-tag", "add", `${name}@${version}`, "next"]
      : ["dist-tag", "rm", name, "next"];
  try {
    run("npm", argv);
    moved.push(name);
  } catch {
    stuck.push(name);
    say(
      `  ${name}: \`next\` not ${action === "set" ? "moved" : "removed"} — npm ${argv.join(" ")}`,
    );
  }
}
if (moved.length > 0) {
  const done =
    semver.prerelease(version) === null
      ? "removed, closing the preview line,"
      : `moved to ${version}`;
  say(`  \`next\` ${done} on ${moved.length} of ${packages.length}`);
}

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
  say(`${version} is published, and \`next\` is not yet right on ${stuck.join(", ")}.`);
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
