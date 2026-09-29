/**
 * Tier 4 for the scaffolder: its tarball, installed by pnpm and run by name (docs/verification.md).
 *
 * `pnpm create` reaches the bin through a link, so a bin that decides whether it is the command by
 * comparing paths does nothing there and exits 0. Running it by path, as every other test does,
 * cannot see that; only the shim can.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));

let work: string;

/**
 * pnpm however it was installed. On Windows through `cmd`, which finds a `.cmd` shim or an `.exe`
 * where spawning `pnpm` finds only an `.exe`, as `packages/cli/test/packed.test.ts` runs `rigline`.
 */
function run(args: readonly string[], cwd: string): string {
  const options = { cwd, encoding: "utf8", stdio: "pipe" } as const;
  try {
    return process.platform === "win32"
      ? execFileSync(process.env.COMSPEC ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], options)
      : execFileSync("pnpm", args, options);
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `pnpm ${args.join(" ")} failed in ${cwd}\n${e.stdout ?? ""}\n${e.stderr ?? e.message ?? ""}`,
    );
  }
}

function newest(dir: string): number {
  let at = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) at = Math.max(at, statSync(join(entry.parentPath, entry.name)).mtimeMs);
  }
  return at;
}

beforeAll(() => {
  const dist = join(PACKAGE, "dist");
  if (!existsSync(join(dist, "bin.js")) || newest(join(PACKAGE, "src")) > newest(dist)) {
    throw new Error(
      "create-rigline-plugin's build is missing or older than its source: run `pnpm build`",
    );
  }

  work = mkdtempSync(join(tmpdir(), "rigline-create-"));
  const out = run(["pack", "--pack-destination", work], PACKAGE);
  const tarball = out.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  if (!existsSync(tarball)) throw new Error(`pnpm pack wrote no tarball: ${out}`);

  const project = join(work, "project");
  mkdirSync(project);
  run(
    ["add", tarball, "--offline", "--ignore-scripts", "--store-dir", join(work, "store")],
    project,
  );
}, 120_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("create-rigline-plugin, installed by pnpm", () => {
  it("scaffolds when run by name through pnpm's link", () => {
    const project = join(work, "project");
    const out = run(["exec", "create-rigline-plugin", "demo"], project);

    expect(out).toContain("Created");
    expect(existsSync(join(project, "demo", "plugins", "demo", "rigline.json"))).toBe(true);
    // Dotfiles are where packing loses things: npm renames `.gitignore`, and keeps these.
    for (const dotted of [".gitignore", ".gitattributes", ".github/workflows/release.yml"]) {
      expect(existsSync(join(project, "demo", dotted)), dotted).toBe(true);
    }
  });
});
