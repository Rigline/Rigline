#!/usr/bin/env node
/**
 * The prototype command: a thin surface over @prototype/core.
 *
 * Commands land here as core grows. Every command throws UserError for a problem a person must
 * fix and lets anything else propagate with its stack, so a bug is never dressed up as advice.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CORE_VERSION,
  diffScans,
  findExtension,
  formatDiff,
  generate,
  harvestAll,
  readBundles,
  scanOf,
  UserError,
} from "@prototype/core";

const USAGE = `prototype ${CORE_VERSION}

  prototype codegen [DIR] [--check] [--out FILE]
      Harvest the installed extension (or DIR) and write plugin-api's generated.ts.
      --check compares instead of writing and exits 1 when the file is out of date.

  prototype diff DIR_A DIR_B
      Compare the identifier layers of two extension directories.
`;

/** The repo's committed baseline, resolved from this file's location so the command works from any cwd. */
function defaultGeneratedPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "plugin-api", "src", "generated.ts");
}

function codegen(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    options: { check: { type: "boolean", default: false }, out: { type: "string" } },
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new UserError(`expected at most one directory: ${positionals}`);
  const ext = positionals[0] ?? findExtension();
  const out = values.out ?? defaultGeneratedPath();

  const generated = generate(harvestAll(readBundles(ext)));
  const label = relative(process.cwd(), out) || out;
  if (values.check) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current === generated.source) {
      console.log(`${label} is up to date for ${generated.tables.version}: ${generated.counts}`);
      return 0;
    }
    console.log(`${label} is out of date for ${generated.tables.version}. Run: prototype codegen`);
    return 1;
  }
  writeFileSync(out, generated.source);
  console.log(`source: ${ext}`);
  console.log(`${generated.tables.version}: ${generated.counts}`);
  for (const module of generated.unreachableModules) {
    console.log(`  unreachable stylesheet module: ${module}`);
  }
  console.log(`wrote: ${label}`);
  return 0;
}

function diff(args: string[]): number {
  if (args.length !== 2) throw new UserError("diff needs exactly two extension directories");
  const [a, b] = args as [string, string];
  const from = scanOf(harvestAll(readBundles(a)));
  const to = scanOf(harvestAll(readBundles(b)));
  console.log(formatDiff(from, to, diffScans(from, to)));
  return 0;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case "codegen":
      return codegen(rest);
    case "diff":
      return diff(rest);
    case undefined:
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    default:
      throw new UserError(`unknown command "${command}"\n\n${USAGE}`);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UserError) {
    console.error(`prototype: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
