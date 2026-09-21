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
}, 300_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("the published tarballs, installed and run", () => {
  it("injects and bakes the four first-party plugins, with no checkout anywhere", () => {
    const ext = writeFixtureExtension(join(work, "ext"));

    const cli = join(prefix, "node_modules", "rigline", "dist", "index.js");
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

  it("prints its usage without a bundler installed, which the packed tarball has not got", () => {
    // Rolldown is a devDependency, so it is not in this prefix at all. Before it was lazily
    // imported, `packages/cli/dist/build.js` pulled it in from the head of the module graph and
    // every command threw ERR_MODULE_NOT_FOUND before reading its own arguments.
    const cli = join(prefix, "node_modules", "rigline", "dist", "index.js");
    expect(existsSync(join(prefix, "node_modules", "rolldown"))).toBe(false);

    const out = execFileSync(process.execPath, [cli, "--help"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(out).toContain("rigline install");
  });
});
