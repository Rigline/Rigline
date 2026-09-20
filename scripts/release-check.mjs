#!/usr/bin/env node
/**
 * Refuse a release the tree does not describe: the version in the manifests must have a section in
 * the changelog, and that section must say something.
 *
 * A read, so it needs no credential and no permission, and it runs before the release workflow
 * builds anything (D60). The failure it exists for is `release:prep` never having been run — the
 * version bumped by hand, the changelog still holding the notes under `Unreleased`, and the release
 * going out with nothing recorded against it anywhere.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** GitHub renders `::error::` as an annotation on the run; a terminal just reads the line. */
function fail(message) {
  const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "release:check — ";
  process.stderr.write(`${prefix}${message}\n`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");

const heading = `\n## ${version} `;
const start = changelog.indexOf(heading);
if (start === -1) {
  fail(
    `CHANGELOG.md has no section for ${version}. Run \`pnpm release:prep ${version}\` on a branch ` +
      "where the notes are still under `## Unreleased`, and commit the result.",
  );
}

const bodyStart = changelog.indexOf("\n", start + 1);
const nextHeading = changelog.indexOf("\n## ", bodyStart);
const body = changelog.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading);
if (body.trim() === "") fail(`CHANGELOG.md's section for ${version} is empty`);

process.stdout.write(`CHANGELOG.md describes ${version}.\n`);
