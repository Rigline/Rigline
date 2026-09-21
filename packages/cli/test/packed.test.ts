/**
 * Tier 4: the tarballs, installed (docs/verification.md, D36).
 *
 * Every other tier drives this workspace, where a relative path from `packages/cli/dist` happens
 * to reach `packages/host/dist` and `plugins/`. Installed from npm those paths reach nothing, and
 * `rigline install` threw `payload is missing pre.js` for two releases while every test was green —
 * because no test had ever exercised the published artefact. This is that test, and it is the part
 * of milestone 7 that stops the failure recurring rather than the part that fixes it.
 *
 * So it packs what a release would publish, installs those tarballs into a temporary prefix with
 * nothing else on the machine, and runs `install` out of that prefix against a fixture extension
 * directory (never a real one, D39). What it asserts is only what a user would notice: the loader
 * went in, the payload is beside the bundle, and the four first-party plugins are baked into it.
 *
 * `pnpm pack` and not `npm pack`: npm leaves `workspace:*` in the packed manifest, which installs
 * as a dependency npm cannot resolve. pnpm substitutes the exact version, which is also what makes
 * the three tarballs resolve each other with no registry (D46).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundledDir } from "../../core/src/assets.ts";
import { writeFixtureExtension } from "../../core/test/fixtures.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** In dependency order, which is also the order npm is handed them. */
const PACKAGES = ["plugin-api", "core", "cli"] as const;

/** The payload directory `install` writes under an extension's `webview/`. */
const PAYLOAD = ["webview", "rigline"] as const;

let work: string;
let prefix: string;
/** Where npm put the packages: the global node_modules, wherever this platform keeps it. */
let modules: string;

/** Run a command, failing the test with everything it said rather than with an exit code. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}\n${e.stdout ?? ""}\n${e.stderr ?? e.message ?? ""}`,
    );
  }
}

/** The same, for a command whose non-zero exit is a verdict rather than a failure to run. */
function attempt(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): { readonly stdout: string } {
  try {
    return { stdout: run(command, args, cwd, env) };
  } catch (error) {
    const text = (error as Error).message;
    // A command that never started is still a failure: nothing it should have printed is there.
    if (!text.includes("injected") && !text.includes("refreshed")) throw error;
    return { stdout: text };
  }
}

beforeAll(() => {
  // Asked first and through the resolver, so an unbuilt or stale workspace fails with the build
  // command rather than with an npm error about a tarball that has no `dist` in it.
  bundledDir();

  work = mkdtempSync(join(tmpdir(), "rigline-packed-"));
  prefix = join(work, "prefix");
  mkdirSync(prefix, { recursive: true });

  const tarballs = PACKAGES.map((name) => {
    const out = run("pnpm", ["pack", "--pack-destination", work], join(ROOT, "packages", name));
    // pnpm prints the path it wrote as the last non-empty line.
    const path = out.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
    if (!existsSync(path)) throw new Error(`pnpm pack wrote no tarball for ${name}: ${out}`);
    return path;
  });

  // `--ignore-scripts` because nothing here has an install script and the surface is declined
  // rather than defended (D47); `--offline` because with rolldown gone nothing needs the registry,
  // and a run that silently reached for one would be a test of the network.
  run(
    "npm",
    [
      "install",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      ...tarballs,
    ],
    work,
  );
  modules = join(prefix, "node_modules");
}, 300_000);

/**
 * The `rigline` command npm wrote from our `bin`, and how to run it.
 *
 * A local install rather than `--global`, and the difference is only where the shims land: both go
 * through npm's `bin-links`, so the three declarations that have to hold for a command to exist are
 * the same either way. `--global` costs about seven seconds of fixed overhead on Windows for 0.5s
 * of work, which buys a test of npm's own prefix layout — npm's business, not ours.
 *
 * On Windows npm writes three shims of which the extensionless one is a POSIX script, so the `.cmd`
 * is the one to run, and running it needs a shell because `child_process.spawn` of a `.cmd` without
 * one throws `EINVAL` since the 2024 CVE fix. Hence the platform branch, which is about how to
 * start a process rather than about what is being tested.
 */
function riglineCommand(): { readonly path: string; readonly run: (args: string[]) => string } {
  const windows = process.platform === "win32";
  const bin = join(modules, ".bin");
  const path = join(bin, windows ? "rigline.cmd" : "rigline");
  return {
    path,
    run: (args) =>
      windows
        ? execFileSync(process.env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", path, ...args], {
            encoding: "utf8",
            stdio: "pipe",
          })
        : execFileSync(path, args, { encoding: "utf8", stdio: "pipe" }),
  };
}

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("the published tarballs, installed and run", () => {
  it("injects and bakes the four first-party plugins, with no checkout anywhere", () => {
    const ext = writeFixtureExtension(join(work, "ext"));

    const cli = join(modules, "rigline", "dist", "index.js");
    expect(existsSync(cli)).toBe(true);

    // Its own home, so the run cannot read or write the developer's config, plugins or baseline.
    //
    // The exit code is deliberately not asserted, and this is the one place that reads as a gap and
    // is not. A synthetic bundle carries none of the curated anchors, so every plugin's declaration
    // check fails against it and `install` exits 1 to say a person is needed — which is D27 working:
    // a refused plugin is still copied, still baked, and never blocks the injection. What this tier
    // is asking is whether the published artefact can do its job at all, and every line below is
    // work that only happened because it could.
    const { stdout } = attempt(process.execPath, [cli, "install", "--ext", ext], work, {
      RIGLINE_HOME: join(work, "home"),
    });
    const out = stdout;

    const payload = join(ext, ...PAYLOAD);
    for (const file of ["pre.js", "post.js", "generated.js", "registry.js"]) {
      expect(existsSync(join(payload, file))).toBe(true);
    }

    const registry = readFileSync(join(payload, "registry.js"), "utf8");
    for (const name of ["session-id", "time-marks", "worktree-prefix", "probe"]) {
      expect(registry).toContain(`"name":"${name}"`);
      // The plugin's own files, copied at its manifest's `entry`, which is what the baked entry
      // points at: a registry naming a module that is not there loads nothing and says nothing.
      expect(existsSync(join(payload, "plugins", name, "dist", "index.js"))).toBe(true);
    }
    expect(out).toContain("injected");

    // The bundled set is the last root, so nothing shadows it and nothing is reported as shadowed:
    // a published install finding each name once is the arrangement this whole phase is about.
    expect(out).not.toContain("is shadowed by");
  });

  it("is runnable by name, which is the first thing a person touches", () => {
    // An install that writes no `rigline` command is the failure this covers, and nothing else here
    // would see it: every other assertion runs `dist/index.js` by path, which works whether or not
    // the package is installable by name. Three declarations have to hold together for a shim to
    // appear — `bin` in the manifest, the entry inside `files`, and the shebang surviving
    // `removeComments` in the build config — and only this asks all three at once.
    const rigline = riglineCommand();
    expect(existsSync(rigline.path)).toBe(true);
    expect(rigline.run(["--help"])).toContain("rigline install");
  });

  it("prints its usage without a bundler installed, which the packed tarball has not got", () => {
    // Rolldown is a devDependency, so it is not in this prefix at all. Before it was lazily
    // imported, `packages/cli/dist/build.js` pulled it in from the head of the module graph and
    // every command threw ERR_MODULE_NOT_FOUND before reading its own arguments.
    const cli = join(modules, "rigline", "dist", "index.js");
    expect(existsSync(join(modules, "rolldown"))).toBe(false);

    const out = execFileSync(process.execPath, [cli, "--help"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(out).toContain("rigline install");
  });
});
