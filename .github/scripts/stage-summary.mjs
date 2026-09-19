/**
 * Turn `pnpm-publish-summary.json` into the Actions run summary.
 *
 * This exists because nothing notifies anybody that a stage is waiting. The registry does issue a
 * stage id — `npm stage list` will show it — but pnpm's publish output does not carry one, so there
 * is nothing here to print even though the id exists. The useful summary is therefore what went up
 * and the command that takes it the rest of the way, both of which work without an id.
 *
 * Runs with `if: always()`, so it must say something sensible when the staging step never got as
 * far as writing a summary file.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const SUMMARY_FILE = "pnpm-publish-summary.json";
const mode = process.argv[2] === "dry-run" ? "dry-run" : "staged";

const out = process.env.GITHUB_STEP_SUMMARY;
const write = (text) => {
  if (out) appendFileSync(out, `${text}\n`);
  else process.stdout.write(`${text}\n`);
};

if (!existsSync(SUMMARY_FILE)) {
  write("## Nothing was staged");
  write("");
  write(
    "No `pnpm-publish-summary.json` was written, so the run did not reach the staging step, or " +
      "every package's version is already on the registry.",
  );
  process.exit(0);
}

/** @type {{ publishedPackages?: Array<{name: string, version: string, size: number, unpackedSize: number, entryCount: number, integrity: string}> }} */
const summary = JSON.parse(readFileSync(SUMMARY_FILE, "utf8"));
const packages = summary.publishedPackages ?? [];

if (packages.length === 0) {
  write("## Nothing was staged");
  write("");
  write("Every package's version is already on the registry. Bump a version to release it.");
  process.exit(0);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

write(mode === "dry-run" ? "## Packed, and staged nothing" : "## Staged, and awaiting approval");
write("");
write("| package | version | tarball | unpacked | files |");
write("| --- | --- | --: | --: | --: |");
for (const p of packages) {
  write(
    `| \`${p.name}\` | \`${p.version}\` | ${kb(p.size)} | ${kb(p.unpackedSize)} | ${p.entryCount} |`,
  );
}
write("");

if (mode === "dry-run") {
  write("A dry run. Nothing reached the registry.");
  process.exit(0);
}

write("**Nobody can install these yet.** To finish the release, on a machine with your npm 2FA:");
write("");
write("```");
write("pnpm stage approve");
write("```");
write("");
write(
  "It lists what is queued, takes the whole batch under one one-time password, and approves in " +
    "dependency order — skipping any package whose workspace dependency did not make it, rather " +
    "than publishing against a dependency the registry never received.",
);
write("");
write("A staged version you would rather not ship needs no action. Do not approve it; it expires.");
write("");
write("<details><summary>Integrity, as the registry received it</summary>");
write("");
write("```");
for (const p of packages) write(`${p.name}@${p.version}  ${p.integrity}`);
write("```");
write("");
write("</details>");
