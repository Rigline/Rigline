/**
 * The built bundle loads and activates.
 *
 * Every other test in this package drives the source modules, which means the *artefact* had no
 * coverage at all: the CommonJS output, the `main` path, the externalised `vscode` require, and
 * `activate` itself. That is m7's opening complaint — nothing had ever exercised the published
 * thing — repeated one layer along, and it cost a day of somebody's laptop.
 *
 * `vscode` is stubbed in a temporary directory rather than mocked in-process, because the thing
 * being tested is a `require` the bundler was asked to leave alone. A module mock would assert
 * that vitest can resolve a name; this asserts that Node can load the file VS Code will load.
 *
 * What it deliberately does *not* do is let activation run to completion. `activate` starts an
 * acquisition on purpose (it must not block the host), and that reaches npm and injects into this
 * machine's real extensions. So the editor stub reports no Claude Code, which is the one answer
 * that makes the sequence stop before it touches anything.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, "..", "dist", "extension.cjs");
const MANIFEST = join(HERE, "..", "dist", "package.json");

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A directory holding a copy of the bundle and a `vscode` Node can resolve.
 *
 * The copy is the point. `require("vscode")` resolves from the *requiring file's* directory, not
 * from the working directory, so a stub beside the repository's `dist/` would be found and a stub
 * beside the test would not — which is the same reason VS Code puts an extension in a directory of
 * its own rather than running it from wherever it was built.
 */
function stubbedHost(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-vsix-"));
  made.push(dir);
  mkdirSync(join(dir, "node_modules", "vscode"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules", "vscode", "index.js"),
    `const disposable = { dispose() {} };
     module.exports = {
       window: {
         createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
         createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", tooltip: "" }),
         showWarningMessage: async () => undefined,
         showInformationMessage: async () => undefined,
       },
       workspace: { getConfiguration: () => ({ get: () => undefined }) },
       // Undefined: no Claude Code, so the acquisition stops before it reaches a registry.
       extensions: { getExtension: () => undefined, onDidChange: () => disposable },
       commands: {
         registered: [],
         registerCommand(id) { module.exports.commands.registered.push(id); return disposable; },
         executeCommand: async () => undefined,
       },
       StatusBarAlignment: { Right: 2 },
       ThemeColor: class {},
     };`,
  );
  copyFileSync(BUNDLE, join(dir, "extension.cjs"));
  return dir;
}

/** The copied bundle, absolute: `node -e` does not resolve a relative require from the cwd. */
const copied = (dir: string) => join(dir, "extension.cjs");

const built = existsSync(BUNDLE) ? false : "packages/vscode is not built — run `pnpm build`";

describe("the packed extension", () => {
  it.skipIf(built)("loads under Node and exports what VS Code calls", () => {
    const dir = stubbedHost();
    const out = execFileSync(
      process.execPath,
      [
        "-e",
        `const m = require(${JSON.stringify(copied(dir))});
         process.stdout.write(Object.keys(m).sort().join(","));`,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(out).toBe("activate,deactivate");
  });

  it.skipIf(built)("activates without throwing, and registers what it must dispose", () => {
    const dir = stubbedHost();
    const out = execFileSync(
      process.execPath,
      [
        "-e",
        `const m = require(${JSON.stringify(copied(dir))});
         const ctx = { subscriptions: [], extension: { packageJSON: { version: "0.0.0-test" }, extensionUri: { fsPath: ${JSON.stringify(dir)} } } };
         m.activate(ctx);
         m.deactivate();
         process.stdout.write(String(ctx.subscriptions.length));
         process.exit(0);`,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    // The output channel, the status item, the watcher and the reload command: everything that
    // outlives activation and would otherwise leak a timer or a stale binding into the host.
    expect(Number(out)).toBe(4);
  });

  // A status item whose command does not exist is a click that does nothing and says nothing,
  // which is the whole of the offer's fallback path gone silently (D82).
  it.skipIf(built)("registers the command its status item points at", () => {
    const dir = stubbedHost();
    const out = execFileSync(
      process.execPath,
      [
        "-e",
        `const vscode = require("vscode");
         const m = require(${JSON.stringify(copied(dir))});
         m.activate({ subscriptions: [], extension: { packageJSON: { version: "0.0.0-test" }, extensionUri: { fsPath: ${JSON.stringify(dir)} } } });
         process.stdout.write(vscode.commands.registered.join(","));
         process.exit(0);`,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(out).toBe("rigline.reload");
  });

  it.skipIf(built)("declares a manifest VS Code will actually run", () => {
    const manifest = JSON.parse(
      execFileSync("node", ["-p", `JSON.stringify(require(${JSON.stringify(MANIFEST)}))`], {
        encoding: "utf8",
      }),
    );
    expect(manifest.main).toBe("./extension.cjs");
    expect(manifest.activationEvents).toContain("onStartupFinished");
    // Undeclared means disabled in an untrusted workspace, listed and silent, which is the least
    // debuggable failure this extension can have.
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(false);
  });
});
