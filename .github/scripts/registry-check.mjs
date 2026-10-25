/**
 * Whether the published set is whole and installs, from public registry data alone (D146). Run on a
 * schedule by `registry.yml`, and by hand any time: `node .github/scripts/registry-check.mjs`.
 *
 * Exits 1 when something is wrong, and says what in the run summary. A version staged and never
 * approved is not wrong — not approving is how an unwanted stage is abandoned — and nothing here can
 * see a stage anyway.
 */
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { installSets, setProblems } from "../../scripts/lib/release-set.mjs";
import { publishedPackages, run } from "../../scripts/lib/workspace.mjs";

const REGISTRY = "https://registry.npmjs.org";

const out = process.env.GITHUB_STEP_SUMMARY;
const write = (text) => {
  if (out) appendFileSync(out, `${text}\n`);
  else process.stdout.write(`${text}\n`);
};

async function packument(name) {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`);
  if (!response.ok) throw new Error(`${name}: the registry answered ${response.status}`);
  return await response.json();
}

/**
 * `npm install --dry-run` builds the whole tree without downloading it, which is where `ETARGET`
 * comes from. Retried, because a version minutes old can be missing from what installers read.
 */
async function installs(specs) {
  for (let attempt = 1; ; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), "rigline-registry-"));
    try {
      const flags = ["--dry-run", "--ignore-scripts", "--no-audit", "--no-fund"];
      run("npm", ["install", "--prefix", dir, ...flags, ...specs], { cwd: dir });
      return true;
    } catch {
      if (attempt === 3) return false;
      await sleep(60_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

const packuments = await Promise.all(publishedPackages().map(packument));
const problems = setProblems(packuments);
for (const { tag, specs } of installSets(packuments)) {
  if (!(await installs(specs))) {
    problems.push(`the set at \`${tag}\` does not install: ${specs.join(" ")}`);
  }
}

if (problems.length === 0) {
  write("## The published set is whole");
  write("");
  for (const { tag, specs } of installSets(packuments)) write(`- \`${tag}\`: ${specs.join(", ")}`);
  process.exit(0);
}

write("## The published set is broken");
write("");
for (const problem of problems) write(`- ${problem}`);
write("");
write(
  "A release approved by hand on npmjs.com, part of the way, is the usual cause: `pnpm " +
    "release:finish` from the checkout it was cut in approves the rest in order. docs/releasing.md " +
    "has the rest.",
);
process.exit(1);
