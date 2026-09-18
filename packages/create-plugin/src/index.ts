#!/usr/bin/env node
/**
 * `create-rigline-plugin`: scaffolds a workspace holding one plugin (decisions.md, D50).
 *
 * A pnpm workspace with `plugins/*` rather than a single-plugin repository, because the multi-plugin
 * shape is a superset: it scaffolds correctly for one plugin, and a second plugin is then a
 * directory copy rather than a restructure.
 *
 * The template is real files under `template/`, copied and substituted, rather than strings in this
 * module. It stays readable and reviewable that way, and the example plugin's own source is a file
 * an editor can check rather than a string literal with its backticks escaped. Two things that
 * takes care of, both of which have caught people out before: `.gitignore` is shipped as
 * `gitignore`, because npm renames a `.gitignore` inside a published tarball and the scaffolded
 * repository would arrive without one; and `generated.ts` is shipped as a placeholder, so the
 * scaffold typechecks before `rigline codegen` has ever run, which is the promise D40 makes and the
 * one moment it is easiest to break.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The manifest's own rule for a name, which is also npm's for an unscoped package. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,213}$/;

/** Substituted through every template file's contents, and through its path. */
export interface Substitutions {
  readonly NAME: string;
  readonly DESCRIPTION: string;
}

export interface ScaffoldOptions {
  /** The directory to create. Its basename is the plugin's name unless `name` says otherwise. */
  readonly target: string;
  readonly name?: string;
  readonly description?: string;
  /** Where the template lives. Defaults to the one shipped beside this module. */
  readonly templateDir?: string;
}

export interface ScaffoldResult {
  readonly dir: string;
  readonly name: string;
  /** Every file written, relative to `dir`, sorted. */
  readonly files: readonly string[];
}

export class ScaffoldError extends Error {}

/** The template shipped with this package. */
export function defaultTemplateDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "template");
}

/**
 * Writes the template into `target`, substituted.
 *
 * It refuses a directory that already has anything in it. A scaffold is not a merge, and a
 * half-overwritten workspace is worse than either a new one or the one that was there.
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const dir = resolve(options.target);
  const name = options.name ?? basename(dir);
  if (!NAME_PATTERN.test(name)) {
    throw new ScaffoldError(
      `"${name}" is not a usable plugin name. It must start with a letter or digit and hold only ` +
        "lowercase letters, digits, dot, dash and underscore.",
    );
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new ScaffoldError(`${dir} is not empty`);
  }

  const templateDir = options.templateDir ?? defaultTemplateDir();
  if (!existsSync(templateDir)) {
    throw new ScaffoldError(`the template is missing from this package: ${templateDir}`);
  }

  const substitutions: Substitutions = {
    NAME: name,
    DESCRIPTION: options.description ?? `A Rigline plugin called ${name}.`,
  };

  const files: string[] = [];
  for (const source of walk(templateDir)) {
    const relativePath = substitute(relative(templateDir, source), substitutions);
    // npm renames a `.gitignore` inside a published tarball, so the template ships it undotted and
    // it is put back here. Without this the scaffolded repository arrives with none at all.
    const written = relativePath === "gitignore" ? ".gitignore" : relativePath;
    const target = join(dir, written);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, substitute(readFileSync(source, "utf8"), substitutions));
    files.push(written.split("\\").join("/"));
  }

  files.sort();
  return { dir, name, files };
}

/** Every file under `root`, recursively, in a stable order. */
function walk(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

/** `__NAME__` and `__DESCRIPTION__`, in a path or in a file's contents. */
function substitute(text: string, substitutions: Substitutions): string {
  let out = text;
  for (const [key, value] of Object.entries(substitutions)) {
    out = out.split(`__${key}__`).join(value);
  }
  return out;
}

/** Everything this scaffold wants said afterwards, in the order it wants doing. */
export function nextSteps(result: ScaffoldResult): string {
  // The relative path, unless it is the worse of the two: a target several directories up produces
  // a run of `..` nobody wants to read, let alone type.
  const from = relative(process.cwd(), result.dir);
  const here = from === "" ? "." : from.startsWith("..") ? result.dir : from;
  return [
    `Created ${result.files.length} files in ${result.dir}`,
    "",
    "Next:",
    `  cd ${here}`,
    "  pnpm install",
    "  pnpm codegen      # harvest the installed extension, and commit the result",
    "  pnpm build",
    `  pnpm rigline add plugins/${result.name}`,
    "",
    "Then reload the webview: Developer: Reload Webviews.",
    "",
    `${join(here, "README.md")} has the rest, including the four rules worth reading first.`,
  ].join("\n");
}

/**
 * The command. One positional, the directory; `--name` where it should differ from the directory's
 * own, and `--description` for the sentence that lands in three files.
 */
export function main(argv: readonly string[]): number {
  const positionals: string[] = [];
  let name: string | undefined;
  let description: string | undefined;

  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at] as string;
    if (argument === "--name") name = argv[++at];
    else if (argument === "--description") description = argv[++at];
    else if (argument === "-h" || argument === "--help") {
      console.log(USAGE);
      return 0;
    } else if (argument.startsWith("-")) {
      console.error(`create-rigline-plugin: unknown option "${argument}"\n\n${USAGE}`);
      return 1;
    } else positionals.push(argument);
  }

  if (positionals.length !== 1) {
    console.error(`create-rigline-plugin: expected one directory\n\n${USAGE}`);
    return 1;
  }

  try {
    console.log(nextSteps(scaffold({ target: positionals[0] as string, name, description })));
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldError) {
      console.error(`create-rigline-plugin: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

const USAGE = `create-rigline-plugin

  pnpm create rigline-plugin <directory> [--name NAME] [--description TEXT]

Scaffolds a pnpm workspace holding one Rigline plugin. The directory's own name is the plugin's
unless --name says otherwise; a second plugin later is a copy of the first.`;

// Only when run as the command, so that a test may import `scaffold` without scaffolding anything.
// Compared as resolved paths rather than by suffix, which a directory named after the bin defeats.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
