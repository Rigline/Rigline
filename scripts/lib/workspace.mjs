/**
 * What the three release scripts all need: where the manifests are, which packages are published,
 * and how to read a section out of the changelog.
 *
 * The published set is derived rather than listed. A package is published unless it says
 * `private`, which is the same rule `pnpm publish -r` applies, so a sixth package cannot be added
 * to the workspace and left out of a release by nobody having remembered this file.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const CHANGELOG = join(ROOT, "CHANGELOG.md");
export const UNRELEASED = "## Unreleased";

/** GitHub renders `::error::` as an annotation on the run; a terminal just reads the line. */
export function fail(message) {
  const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "release — ";
  process.stderr.write(`${prefix}${message}\n`);
  process.exit(1);
}

export function say(message) {
  process.stdout.write(`${message}\n`);
}

/** Every manifest the workspace version lives in: the root, and one per package. */
export function manifestPaths() {
  const packages = join(ROOT, "packages");
  const members = readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packages, entry.name, "package.json"));
  return [join(ROOT, "package.json"), ...members];
}

export function currentVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

/** The names npm knows, in no particular order; `-r` decides the order a release goes in. */
export function publishedPackages() {
  return manifestPaths()
    .slice(1)
    .map((path) => JSON.parse(readFileSync(path, "utf8")))
    .filter((json) => json.private !== true)
    .map((json) => json.name);
}

/**
 * The body of one `## <heading>` section, or null when there is no such heading. Sliced between
 * headings rather than matched, because a changelog entry may contain anything a person can type
 * and a regex over the whole file would be a bounded-pattern problem with no upside.
 */
export function changelogSection(heading) {
  const changelog = readFileSync(CHANGELOG, "utf8");
  const start = changelog.indexOf(`\n## ${heading}`);
  if (start === -1) return null;
  const bodyStart = changelog.indexOf("\n", start + 1);
  const end = changelog.indexOf("\n## ", bodyStart);
  return changelog.slice(bodyStart, end === -1 ? undefined : end);
}

/** Run a command, inheriting stdio so a browser prompt or an OTP challenge reaches the person. */
export function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: ROOT, stdio: "inherit", shell: false, ...options });
}

/** Run a command for its output, and hand back the trimmed text. */
export function capture(command, args) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8", shell: false }).trim();
}

/**
 * `npm view <name> <field> --json`, with "no such package" told apart from "the registry did not
 * answer". Both exit non-zero, and conflating them is how an offline machine talks itself into
 * believing nothing has ever been published — which is the one belief that makes a prerelease look
 * like it belongs on `latest`.
 */
function view(name, field, absent) {
  try {
    return JSON.parse(capture("npm", ["view", name, field, "--json"]));
  } catch (error) {
    if (String(error.stderr ?? "").includes("E404")) return absent;
    throw new Error(`npm view ${name} ${field} failed: ${String(error.stderr ?? error).trim()}`);
  }
}

/** A package's dist-tags as the registry has them now; empty for a name it does not have. */
export function distTags(name) {
  return view(name, "dist-tags", {});
}

/** Every version the registry holds for a package, oldest first; empty for an unpublished one. */
export function publishedVersions(name) {
  const versions = view(name, "versions", []);
  return Array.isArray(versions) ? versions : [versions];
}
