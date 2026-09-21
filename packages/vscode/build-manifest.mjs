/**
 * The extension manifest, written rather than maintained.
 *
 * A VS Code extension's identity lives in fields a pnpm workspace cannot carry: `name` must be
 * unqualified, and `rigline` is already this workspace's CLI. So the package here stays
 * `@rigline/vscode` and private, and what `vsce` packages is `dist/`, whose manifest this writes.
 *
 * Every field that exists in two places is derived from the one that owns it — the version from the
 * workspace manifest, the description from the same — because a second copy of a version is a
 * second thing that can be wrong, which is the argument ci.md already makes about releases.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const own = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

const manifest = {
  name: "rigline",
  displayName: "Rigline",
  description: own.description,
  version: own.version,
  publisher: "rigline",
  license: "MIT",
  repository: { type: "git", url: "git+https://github.com/Rigline/Rigline.git" },
  engines: { vscode: "^1.90.0" },
  categories: ["Other"],
  // Not an activation on the Claude Code extension itself: the companion must run when that
  // extension is *replaced*, which is exactly when nothing of it is activating (D80).
  activationEvents: ["onStartupFinished"],
  main: "./extension.cjs",
  // One file plus what vsce always takes. Said explicitly so the packager stops guessing, and so a
  // stray file in dist/ cannot find its way into a VSIX by being there.
  files: ["extension.cjs", "README.md", "LICENSE"],
  contributes: {
    configuration: {
      title: "Rigline",
      properties: {
        "rigline.nodePath": {
          type: "string",
          default: "",
          markdownDescription:
            "Absolute path to a Node executable for running npm and the Rigline engine. " +
            "Leave blank to search `PATH`. Needed where a GUI-launched VS Code does not inherit " +
            "a login shell's `PATH`, which is common on macOS.",
        },
      },
    },
  },
};

writeFileSync(join(dist, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const name of ["README.md", "LICENSE"]) {
  const from = existsSync(join(here, name)) ? join(here, name) : join(here, "..", "..", name);
  if (existsSync(from)) copyFileSync(from, join(dist, name));
}

console.log(`wrote the extension manifest for ${manifest.name} ${manifest.version}`);
