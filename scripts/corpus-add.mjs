#!/usr/bin/env node
/**
 * Snapshot an installed Claude Code version into the corpus, record it, and when it is the newest
 * move `generated.ts` and so the harness to it (D148). Writes, never commits.
 *
 * Usage: pnpm corpus:add [version]
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  extensionVersion,
  installedExtensions,
  pristineHostPath,
  pristineWebviewPath,
  runEngine,
  WEBVIEW_CSS,
  wholenessProblem,
  withInjectionLock,
} from "@rigline/core";
import { pickInstalled, previousVersion, withVersion } from "./lib/corpus.mjs";
import { fail, ROOT, say } from "./lib/workspace.mjs";

const LABEL = "corpus:add";
const RECORD = join(ROOT, "packages", "core", "test", "corpus.json");
const GENERATED = join(ROOT, "generated.ts");

const args = process.argv.slice(2);
if (args.length > 1) fail(`expected at most one version: ${args.join(" ")}`, LABEL);

const record = JSON.parse(readFileSync(RECORD, "utf8"));
const installed = pickInstalled(installedExtensions(), args[0], extensionVersion);
if (installed === null) {
  fail(
    args[0] === undefined
      ? "no Claude Code extension is installed"
      : `${args[0]} is not installed; an older version comes from the Marketplace as a VSIX`,
    LABEL,
  );
}
const { dir: ext, version } = installed;
const target = join(record.dir, version);
if (record.versions.includes(version) || existsSync(target)) {
  fail(`the corpus already has ${version}`, LABEL);
}

// Under the injector's lock, so the companion cannot back up and patch the directory mid-copy.
const refused = withInjectionLock({ what: LABEL, onWait: say }, () => {
  const unfinished = wholenessProblem(ext);
  if (unfinished !== null) return `${ext} is not finished installing: ${unfinished.problem}`;

  const staging = join(record.dir, `.${version}.partial`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "webview"), { recursive: true });
  copyFileSync(pristineWebviewPath(ext), join(staging, "webview", "index.js"));
  copyFileSync(pristineHostPath(ext), join(staging, "extension.js"));
  copyFileSync(join(ext, WEBVIEW_CSS), join(staging, WEBVIEW_CSS));
  copyFileSync(join(ext, "package.json"), join(staging, "package.json"));

  // The webview only: a host patch is a same-size substitution with no marker to find.
  if (readFileSync(join(staging, "webview", "index.js")).includes("rigline")) {
    rmSync(staging, { recursive: true, force: true });
    return `${ext}'s webview bundle contains Rigline's loader, so it has no pristine copy`;
  }
  renameSync(staging, target);
  return null;
});
if (refused !== null) fail(refused, LABEL);

const versions = withVersion(record.versions, version);
writeFileSync(RECORD, `${JSON.stringify({ ...record, versions }, null, 2)}\n`);
say(`snapshotted ${version} into ${target}`);

const previous = previousVersion(record.versions, version);
if (previous !== null && existsSync(join(record.dir, previous))) {
  say("");
  await runEngine(["diff", join(record.dir, previous), target]);
}

const newest = versions.at(-1) === version;
let code = 0;
say("");
if (newest) {
  code = await runEngine(["codegen", target, "--out", GENERATED]);
} else {
  say(`${version} is not the newest in the corpus, so generated.ts and the harness stay put`);
}

say("");
say(
  `Left to do: pnpm typecheck, pnpm test, and commit corpus.json${newest ? " and generated.ts" : ""}`,
);
process.exit(code);
