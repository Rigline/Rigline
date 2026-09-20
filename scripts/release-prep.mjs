#!/usr/bin/env node
/**
 * Cut a version: roll the changelog's `## Unreleased` section into a version section, and write
 * that version into every manifest in the workspace.
 *
 * Both halves in one command because they belong in one commit (D60). A version staged from a tree
 * whose changelog does not describe it is one the release workflow refuses, and a version bumped
 * anywhere but a commit is one `--provenance` attests against a tree that disagrees with the
 * tarball.
 *
 * It writes files and stops. Committing is the caller's, so the diff gets read before it lands.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const UNRELEASED = "## Unreleased";

/** Every manifest the workspace version lives in: the root, and one per package. */
function manifestPaths() {
  const packages = join(ROOT, "packages");
  const members = readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packages, entry.name, "package.json"));
  return [join(ROOT, "package.json"), ...members];
}

function fail(message) {
  process.stderr.write(`release:prep — ${message}\n`);
  process.exit(1);
}

/** Today where the person running this is, not where the runtime thinks UTC is. */
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const version = process.argv[2];
if (!version) fail("give the version to cut, e.g. `pnpm release:prep 1.0.0-alpha.3`");
if (!semver.valid(version)) fail(`\`${version}\` is not a version semver can read`);

const manifests = manifestPaths();
const current = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
if (!semver.gt(version, current)) {
  // `semver.gt`, never a string compare: `1.0.0-alpha.10` sorts below `1.0.0-alpha.2` as a string,
  // so the release that would move a version backwards is exactly the one nobody would check.
  fail(`${version} is not above the current ${current}`);
}

const changelog = readFileSync(CHANGELOG, "utf8");
const start = changelog.indexOf(`${UNRELEASED}\n`);
if (start === -1) fail(`CHANGELOG.md has no \`${UNRELEASED}\` heading`);
if (changelog.includes(`\n## ${version} `))
  fail(`CHANGELOG.md already has a section for ${version}`);

const bodyStart = start + UNRELEASED.length + 1;
const nextHeading = changelog.indexOf("\n## ", bodyStart);
const body = changelog.slice(bodyStart, nextHeading === -1 ? undefined : nextHeading);
if (body.trim() === "") {
  fail(`\`${UNRELEASED}\` is empty — a release with nothing to say about it is a mistake`);
}

const rolled = `${UNRELEASED}\n\n## ${version} — ${today()}\n${body.replace(/^\n+/, "\n")}`;
writeFileSync(
  CHANGELOG,
  changelog.slice(0, start) +
    rolled +
    changelog.slice(nextHeading === -1 ? changelog.length : nextHeading),
  "utf8",
);

for (const path of manifests) {
  // Rewritten as text rather than re-serialised, so key order and formatting survive: the version
  // is the only thing this command has an opinion about. The pattern is bounded and excludes the
  // two characters that could carry it across a field boundary.
  const source = readFileSync(path, "utf8");
  const replaced = source.replace(
    /^(\s{0,8})"version": "[^"\\]{1,64}"/m,
    `$1"version": ${JSON.stringify(version)}`,
  );
  if (replaced === source) fail(`${path} has no \`version\` field this could rewrite`);
  writeFileSync(path, replaced, "utf8");
}

process.stdout.write(
  `Cut ${version} across ${manifests.length} manifests, and rolled the changelog.\n` +
    "Read the diff, then commit both together.\n",
);
