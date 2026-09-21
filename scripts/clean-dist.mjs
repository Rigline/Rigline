#!/usr/bin/env node
/**
 * Empty a package's `dist` before `tsc` refills it, keeping any directory named on the command line.
 *
 * `tsc` never removes output, so a source file that is renamed or deleted leaves its build behind
 * and `files: ["dist"]` ships it. This was not theoretical: `dist/doctor/logs.js` sat in this
 * checkout for a week after the VS Code log parser was cut (D53), which is the one piece of code
 * this project deliberately removed for a privacy reason.
 *
 * It never reached npm, and *why* is the reason this script exists rather than a reason it does not.
 * CI builds a fresh checkout, so the published tarballs have only ever held what the sources say —
 * while a maintainer's `dist` accumulates. That difference is a problem on its own: tier 4 packs the
 * local tree, so without this it tests an artefact nobody will ever install, which is the premise
 * the whole tier rests on.
 *
 * Usage: node ../../scripts/clean-dist.mjs [--keep NAME]...
 */
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const keep = new Set(args.filter((_, i) => args[i - 1] === "--keep"));

// Relative to the package being built, because npm runs a script from its own directory.
const dist = join(process.cwd(), "dist");

let entries;
try {
  entries = readdirSync(dist);
} catch {
  // Nothing built yet, which is the ordinary state of a fresh clone rather than a problem.
  process.exit(0);
}

for (const entry of entries) {
  if (keep.has(entry)) continue;
  rmSync(join(dist, entry), { recursive: true, force: true });
}
