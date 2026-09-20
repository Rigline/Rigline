#!/usr/bin/env node
/**
 * Everything the release workflow can establish without a credential, and the dist-tag it derives
 * from the answer (D60, D61):
 *
 *   - the changelog has a section for the version in the tree, and that section says something;
 *   - a tag-triggered run is on the tag that names that version;
 *   - the version is above at least one of the two dist-tags, so there is a tag to stage under.
 *
 * All reads, so this runs before anything is built and needs no permission. It writes `dist_tag`
 * to `$GITHUB_OUTPUT` for the staging step, and prints the same to a terminal.
 *
 * `--no-staging` says this run will not stage. The caller says so rather than this inferring it,
 * because every inference available here — a dispatch, a branch ref — is the same shape as the
 * thing being asked about and gets it wrong on a re-run. A run that stages nothing has no tag to
 * derive: the derivation is printed as information, including a refusal, and the emitted tag is
 * the placeholder `dry-run`, which the staging step refuses by name.
 *
 * Usage: node scripts/release-check.mjs [--staging | --no-staging]
 */
import { appendFileSync } from "node:fs";
import { registryState, stageTag } from "./lib/tags.mjs";
import {
  changelogSection,
  currentVersion,
  fail,
  publishedPackages,
  say,
} from "./lib/workspace.mjs";

/** The tag emitted when nothing will be staged: obviously fake, so a leak into a real stage shows. */
const PLACEHOLDER = "dry-run";

const staging = !process.argv.slice(2).includes("--no-staging");
const version = currentVersion();

const notes = changelogSection(version);
if (notes === null) {
  fail(
    `CHANGELOG.md has no section for ${version}. A release is cut with \`pnpm release <increment>\`, ` +
      "which rolls `## Unreleased` into one.",
  );
}
if (notes.trim() === "") fail(`CHANGELOG.md's section for ${version} is empty`);

// On a tag-triggered run the tag is the release's identity, so a tag naming a different version
// than the tree does is a tag pushed by hand at the wrong commit.
const ref = process.env.GITHUB_REF ?? "";
if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`) {
  fail(
    `${ref.slice("refs/tags/".length)} does not name ${version}, which is the version in the tree`,
  );
}

const packages = publishedPackages();
const { refusal, tag } = stageTag(version, registryState(packages));

if (!staging) {
  say(`${version} is described by CHANGELOG.md.`);
  // A run that stages nothing is usually run against a tree whose version is already published,
  // which is a refusal — and the right one. Reported rather than obeyed: what this run is for is
  // the build, the tests and the OIDC exchange, none of which the tag decides.
  say(refusal ? `The derivation refuses it: ${refusal}` : `It would stage under \`${tag}\`.`);
  say(`Nothing will be staged, so the tag is \`${PLACEHOLDER}\`.`);
  emit(PLACEHOLDER);
  process.exit(0);
}

if (refusal) fail(refusal);
say(`${version} is described by CHANGELOG.md, and stages under \`${tag}\`.`);
emit(tag);

function emit(value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `dist_tag=${value}\n`);
}
