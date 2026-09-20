#!/usr/bin/env node
/**
 * Cut and ship a version: roll the changelog, bump every manifest, commit, tag and push (D60).
 *
 * The pushed tag is what starts the release — the workflow triggers on it — so this is the whole of
 * the local half, and `pnpm release:finish` is the other one. Nothing here talks to the registry
 * except to show you which dist-tag the release will land under, and it carries on without that.
 *
 * Usage: pnpm release <patch|minor|major|prepatch|preminor|premajor|prerelease> [--preid <id>]
 *                     [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import semver from "semver";
import { registryStateOrNull, stageTag } from "./lib/tags.mjs";
import {
  CHANGELOG,
  capture,
  currentVersion,
  fail,
  manifestPaths,
  npmAccountOrNull,
  publishedPackages,
  run,
  say,
  UNRELEASED,
} from "./lib/workspace.mjs";

const INCREMENTS = ["patch", "minor", "major", "prepatch", "preminor", "premajor", "prerelease"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const preidAt = args.indexOf("--preid");
const preid = preidAt === -1 ? null : args[preidAt + 1];
const increment = args.find(
  (arg, i) => !arg.startsWith("--") && !(preidAt !== -1 && i === preidAt + 1),
);

if (!increment) fail(`say which increment: ${INCREMENTS.join(", ")}`);
if (!INCREMENTS.includes(increment)) {
  fail(`\`${increment}\` is not an increment. One of: ${INCREMENTS.join(", ")}`);
}

const current = currentVersion();
// Carry the current prerelease identifier forward by default, so `prerelease` on an alpha stays on
// alpha rather than producing the bare numeric prerelease semver gives with no identifier.
const identifier = String(preid ?? semver.prerelease(current)?.[0] ?? "alpha");
const version = semver.inc(current, increment, identifier);
if (!version) fail(`semver cannot take ${current} to a ${increment}`);
const tagName = `v${version}`;

// A release commit must contain the release and nothing else: the tag names this commit, and
// `--provenance` attests the tree it was built from. Reported for a dry run rather than refused,
// since a dry run writes nothing and answering "what would this cut?" on a dirty tree is most of
// what it is for.
const dirty = capture("git", ["status", "--porcelain"]) !== "";
if (dirty && !dryRun) {
  fail(
    "the working tree has changes. Commit or stash them; a release commit carries only the bump",
  );
}
if (capture("git", ["tag", "--list", tagName]) !== "") fail(`${tagName} already exists`);

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch === "HEAD" && !dryRun) {
  fail("HEAD is detached, so there is no branch to push. Check one out first");
}

const changelog = readFileSync(CHANGELOG, "utf8");
// The working tree has whatever endings git checked out, which on Windows is CRLF. Nothing here may
// assume LF: find the end of the heading's line rather than the newline it is assumed to end with,
// and compose with the endings the file already uses.
const eol = changelog.includes("\r\n") ? "\r\n" : "\n";
const start = changelog.indexOf(`${UNRELEASED}${eol}`);
if (start === -1) fail(`CHANGELOG.md has no \`${UNRELEASED}\` heading`);
const bodyStart = start + UNRELEASED.length + eol.length;
const nextHeading = changelog.indexOf(`${eol}## `, bodyStart);
const notes = changelog.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading);
if (notes.trim() === "") {
  fail(`\`${UNRELEASED}\` is empty — a release with nothing to say about it is a mistake`);
}

// Shown rather than decided here: the workflow derives it again from the registry at stage time.
// Offline, or on a registry that will not answer, this is the one thing that degrades.
const state = registryStateOrNull(publishedPackages());
const planned = state === null ? null : stageTag(version, state);
if (planned?.refusal) fail(planned.refusal);

// Asked only when the registry has just answered, so an offline cut degrades the way the tag
// derivation above it does rather than being refused for the weather. A lapsed session is
// otherwise found by `pnpm release:finish`, which is after the tag is pushed and the workflow is
// green — a whole cycle spent on something a person fixes in a minute.
const account = state === null ? null : npmAccountOrNull();

say(`  ${current}  ->  ${version}     (${increment}${preid ? `, preid ${identifier}` : ""})`);
say(`  tag          ${tagName} on ${branch}`);
say(`  manifests    ${manifestPaths().length}`);
say(
  planned
    ? `  dist-tag     stages under \`${planned.tag}\`, and \`next\` is reconciled after approval`
    : "  dist-tag     registry unreachable from here; the workflow derives it at stage time",
);
if (state !== null) {
  say(`  npm          ${account ?? "no session — approval will need `npm login`"}`);
}
say("");
say(notes.trim());
say("");

if (dryRun) {
  say(
    dirty
      ? "A dry run. Nothing written, nothing pushed — and the tree is dirty, so a real run refuses."
      : "A dry run. Nothing written, nothing pushed.",
  );
  process.exit(0);
}

if (state !== null && account === null) {
  fail(
    "npm has no session on this machine, and `pnpm release:finish` cannot approve without one. " +
      "`npm login` first — it prints one URL and then goes quiet while it polls",
  );
}

const body = notes.replace(/^(\r?\n)+/, eol);
const rolled = `${UNRELEASED}${eol}${eol}## ${version} — ${today()}${eol}${body}`;
writeFileSync(
  CHANGELOG,
  changelog.slice(0, start) +
    rolled +
    changelog.slice(nextHeading === -1 ? changelog.length : nextHeading),
  "utf8",
);

for (const path of manifestPaths()) {
  // Rewritten as text rather than re-serialised, so key order and formatting survive: the version
  // is the only thing this command has an opinion about. The pattern is bounded, anchored to a
  // line, and excludes the two characters that could carry it across a field boundary.
  const source = readFileSync(path, "utf8");
  const replaced = source.replace(
    /^(\s{0,8})"version": "[^"\\]{1,64}"/m,
    `$1"version": ${JSON.stringify(version)}`,
  );
  if (replaced === source) fail(`${path} has no \`version\` field this could rewrite`);
  writeFileSync(path, replaced, "utf8");
}

// The notes are the commit body as well as the changelog section, so `git log` carries what shipped
// without anybody opening a second file.
const message = `Release ${version}\n${notes.replace(/\r\n/g, "\n").replace(/^\n+/, "\n")}`;
run("git", ["add", "CHANGELOG.md", ...manifestPaths()]);
run("git", ["commit", "-m", message]);
run("git", ["tag", "-a", tagName, "-m", message]);

// The commit and the tag are made before the push and survive it failing, so re-running this
// command answers `v1.2.4 already exists` — which is true, and no help at all. Both ways out,
// printed where the failure is.
try {
  run("git", ["push", "--follow-tags", "origin", branch]);
} catch {
  fail(
    `the push failed, so ${tagName} and the release commit are here and not on the remote. ` +
      `Retry it:\n\n    git push --follow-tags origin ${branch}\n\n` +
      `or undo the release and cut it again:\n\n    git tag -d ${tagName}\n` +
      "    git reset --hard HEAD~1",
  );
}

say("");
say(`Pushed ${tagName}. The release workflow is staging it; when that run is green:`);
say("");
say("    pnpm release:finish");

/** Today where the person running this is, not where the runtime thinks UTC is. */
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
