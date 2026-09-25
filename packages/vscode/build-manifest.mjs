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
  // The floor is what the API needs, which is very little: `extensions.onDidChange`, a status bar
  // item and an output channel are all old. Kept low on purpose — a compatibility shim that refuses
  // to load on the editor it is meant to shim would be a poor joke.
  engines: { vscode: "^1.75.0" },
  categories: ["Other"],
  // Declared because *not* declaring it is a decision too, and a worse one: VS Code disables an
  // extension that says nothing here in an untrusted workspace, listing it all the while, so the
  // symptom is an extension that is installed, enabled, compatible and silent. Claude Code says the
  // same thing about itself, which settles the question — there is nothing for the companion to do
  // in a workspace the extension it patches will not run in either.
  capabilities: {
    untrustedWorkspaces: {
      supported: false,
      description: "Rigline runs npm and patches the installed Claude Code extension.",
    },
  },
  // Not an activation on the Claude Code extension itself: the companion must run when that
  // extension is *replaced*, which is exactly when nothing of it is activating (D80). `onUri`, so a
  // Save link clicked before startup finishes still reaches the handler, and so `install` can tell
  // this companion answers one (D93).
  activationEvents: ["onStartupFinished", "onUri"],
  main: "./extension.cjs",
  // One file plus what vsce always takes. Said explicitly so the packager stops guessing, and so a
  // stray file in dist/ cannot find its way into a VSIX by being there.
  files: ["extension.cjs", "README.md", "LICENSE"],
  contributes: {
    commands: [{ command: "rigline.showPlugins", title: "Rigline: Show Plugins" }],
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
        // Machine scope, so Settings Sync leaves behind a path that means nothing elsewhere (D94).
        "rigline.enginePath": {
          type: "string",
          default: "",
          scope: "machine",
          markdownDescription:
            "For developing Rigline. An engine entry to run in place of the one Rigline installs, " +
            "and never updated: `packages/core/dist/engine/bin.js` in a checkout, whose " +
            "`rigline vscode-setup` prints the line to set. Leave blank to run the released engine.",
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
