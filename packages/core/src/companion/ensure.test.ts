/**
 * Both looks (D143, D144), over VS Code's files laid out in a scratch directory. The CLI is a fake
 * that does what VS Code's does to them: it extracts the companion into the shared extensions
 * directory and lists it in the profile's `extensions.json`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../errors.ts";
import {
  ensureCompanion,
  isAcquiredEngine,
  lookAtCompanion,
  makeProfilesCurrent,
} from "./ensure.ts";
import { type CarriedCompanion, companionFingerprint } from "./fingerprint.ts";
import { COMPANION_ID, type EditorDirs, installArgv } from "./profiles.ts";
import type { FoundEditor } from "./setup.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CLAUDE = "anthropic.claude-code";
const CODE = '"use strict";\nexports.activate = () => {};\n';
const MANIFEST = { name: "rigline", publisher: "rigline" };
const carried: CarriedCompanion = {
  version: "2.0.0",
  fingerprint: companionFingerprint(CODE, { ...MANIFEST, version: "2.0.0" }),
  vsix: "rigline.vsix",
};

const EDITOR: FoundEditor = {
  cli: "code",
  label: "VS Code",
  product: "Code",
  dataFolder: ".vscode",
  path: "code.cmd",
};

/** A profile's companion: the carried build, another build at a version, or none. */
type Held = "carried" | { readonly version: string; readonly code?: string } | null;

interface Spec {
  readonly claudeCode?: boolean;
  readonly companion?: Held;
  readonly sharesDefault?: boolean;
}

interface Machine extends EditorDirs {
  /** Where a profile's `extensions.json` is. */
  list(name: string): string;
  /** The companion lock, beside VS Code's files rather than in anybody's home. */
  readonly lock: string;
}

/** VS Code's files for `specs`, the default profile under its own name and the rest by location. */
function machine(specs: Record<string, Spec>, storage = true): Machine {
  const root = mkdtempSync(join(tmpdir(), "rigline-ensure-"));
  made.push(root);
  const userData = join(root, "user");
  const extensionsDir = join(root, "ext");
  mkdirSync(join(userData, "User", "globalStorage"), { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });
  const named = Object.entries(specs).filter(([name]) => name !== "Default");
  const list = (name: string): string =>
    name === "Default"
      ? join(extensionsDir, "extensions.json")
      : join(userData, "User", "profiles", `p-${name}`, "extensions.json");
  if (storage) {
    writeFileSync(
      join(userData, "User", "globalStorage", "storage.json"),
      JSON.stringify({
        userDataProfiles: named.map(([name, spec]) => ({
          name,
          location: `p-${name}`,
          ...(spec.sharesDefault ? { useDefaultFlags: { extensions: true } } : {}),
        })),
      }),
    );
  }
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.sharesDefault) continue;
    const entries: object[] = [];
    if (spec.claudeCode) entries.push({ identifier: { id: CLAUDE }, version: "2.1.301" });
    if (spec.companion) entries.push(companionEntry(extensionsDir, spec.companion));
    mkdirSync(join(list(name), ".."), { recursive: true });
    writeFileSync(list(name), JSON.stringify(entries));
  }
  return { userData, extensionsDir, list, lock: join(root, "companion.lock") };
}

/** Extracts a companion, as VS Code does, and answers its `extensions.json` entry. */
function companionEntry(extensionsDir: string, held: NonNullable<Held>): object {
  const version = held === "carried" ? carried.version : held.version;
  const code = held === "carried" ? CODE : (held.code ?? `${CODE};`);
  const relativeLocation = `${COMPANION_ID}-${version}`;
  const dir = join(extensionsDir, relativeLocation);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.cjs"), code);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ ...MANIFEST, version }));
  return { identifier: { id: COMPANION_ID }, version, relativeLocation };
}

/**
 * The CLI: records each call, and installs the carried companion into the profile named unless told
 * the install exits with `code`, or lands nowhere, as another editor answering to `code` does.
 */
function cli(at: Machine, outcome: Record<string, "lands" | "nowhere" | number> = {}) {
  const calls: (readonly string[])[] = [];
  let looked = 0;
  return {
    calls,
    looked: () => looked,
    findCli: () => {
      looked++;
      return [EDITOR];
    },
    run: async (_cli: unknown, argv: readonly string[]) => {
      calls.push(argv);
      const at_ = argv.indexOf("--profile");
      const name = at_ === -1 ? "Default" : (argv[at_ + 1] as string);
      const result = outcome[name] ?? "lands";
      if (typeof result === "number") return { code: result, output: `Profile '${name}' broke.` };
      if (result === "lands") {
        const path = at.list(name);
        const kept = (
          JSON.parse(readFileSync(path, "utf8")) as { identifier: { id: string } }[]
        ).filter((entry) => entry.identifier.id !== COMPANION_ID);
        writeFileSync(path, JSON.stringify([...kept, companionEntry(at.extensionsDir, "carried")]));
      }
      return { code: 0, output: "" };
    },
  };
}

function options(at: Machine, fake: ReturnType<typeof cli>, own = true) {
  return { dirs: at, carried, own, findCli: fake.findCli, run: fake.run, lock: { path: at.lock } };
}

function looking(at: Machine, fake: ReturnType<typeof cli>, restored = () => false) {
  return {
    dirs: at,
    cli: { command: "code", prefix: [] },
    carried,
    run: fake.run,
    restored,
    lock: { path: at.lock },
  };
}

describe("ensureCompanion", () => {
  it("starts nothing where every profile with Claude Code has the carried build", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: "carried" },
      Work: { claudeCode: true, companion: "carried" },
      Plain: {},
    });
    const fake = cli(at);
    expect(await ensureCompanion(options(at, fake))).toEqual({
      lines: [],
      needs: [],
      installed: [],
    });
    expect(fake.looked()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("installs where a profile has none, and replaces another build with --force", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: { version: "1.1.0" } },
      Work: { claudeCode: true },
      Same: { claudeCode: true, companion: { version: "2.0.0", code: `${CODE}//other` } },
      Plain: { companion: { version: "1.1.0" } },
    });
    const fake = cli(at);
    const ensured = await ensureCompanion(options(at, fake));

    expect(fake.calls).toEqual([
      installArgv(carried.vsix, null, true),
      installArgv(carried.vsix, "Work", false),
      installArgv(carried.vsix, "Same", true),
    ]);
    expect(ensured.installed).toEqual(["Default", "Work", "Same"]);
    expect(ensured.needs).toEqual([]);
    expect(ensured.lines).toEqual([
      `replaced profile "Default"'s companion, 1.1.0, with this engine's, 2.0.0`,
      `installed the companion, 2.0.0, into profile "Work", which had none`,
      `replaced profile "Same"'s companion, 2.0.0 of another build, with this engine's, 2.0.0`,
    ]);
  });

  // The same bytes from another major refuse this engine at every start (D144).
  it("replaces the same build from another major", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: { version: "1.2.0", code: CODE } },
    });
    const fake = cli(at);
    const ensured = await ensureCompanion(options(at, fake));
    expect(fake.calls).toEqual([installArgv(carried.vsix, null, true)]);
    expect(ensured.installed).toEqual(["Default"]);
    expect(existsSync(at.lock)).toBe(false);
  });

  it("leaves a profile sharing the default's extensions to the default", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: "carried" },
      Shared: { sharesDefault: true },
    });
    const fake = cli(at);
    await ensureCompanion(options(at, fake));
    expect(fake.calls).toEqual([]);
  });

  // An author's workspace engine is not the one the companion runs (D143).
  it("counts any companion as current for another engine, and installs only where there is none", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: { version: "1.1.0" } },
      Work: { claudeCode: true },
    });
    const fake = cli(at);
    const ensured = await ensureCompanion(options(at, fake, false));
    expect(fake.calls).toEqual([installArgv(carried.vsix, "Work", false)]);
    expect(ensured.installed).toEqual(["Work"]);
  });

  it("injects and names the profile an install failed in, while another is current", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: "carried" },
      Work: { claudeCode: true },
    });
    const ensured = await ensureCompanion(options(at, cli(at, { Work: 1 })));
    expect(ensured.installed).toEqual([]);
    expect(ensured.needs).toEqual([
      `the companion could not be installed into profile "Work": Profile 'Work' broke. ` +
        `Extensions: Install from VSIX… in that profile, with ${carried.vsix}, does it by hand`,
    ]);
  });

  it("reads the profile again rather than trusting an exit of 0", async () => {
    const at = machine({
      Default: { claudeCode: true },
      Work: { claudeCode: true, companion: "carried" },
    });
    const ensured = await ensureCompanion(options(at, cli(at, { Default: "nowhere" })));
    expect(ensured.needs[0]).toMatch(
      /^code\.cmd said it installed the companion into profile "Default", and that profile does not list it, so that `code` is another editor\./,
    );
  });

  it("refuses when no profile ends up current, naming each", async () => {
    const at = machine({ Default: { claudeCode: true }, Work: { claudeCode: true } });
    const attempt = ensureCompanion(options(at, cli(at, { Default: "nowhere", Work: 2 })));
    await expect(attempt).rejects.toThrow(UserError);
    await expect(attempt).rejects.toThrow(
      /^the companion could not be put into any profile that needs it, so nothing was injected:\n {2}code\.cmd said .*\n {2}the companion could not be installed into profile "Work"/,
    );
  });

  it("refuses with the fix where no CLI is on PATH, and runs nothing", async () => {
    const at = machine({ Default: { claudeCode: true }, Work: { claudeCode: true } });
    const ran: unknown[] = [];
    const attempt = (platform: NodeJS.Platform) =>
      ensureCompanion({
        dirs: at,
        carried,
        own: true,
        findCli: () => [],
        run: async (...args) => {
          ran.push(args);
          return { code: 0, output: "" };
        },
        platform,
      });
    await expect(attempt("darwin")).rejects.toThrow(
      /^profiles "Default" and "Work" need the companion this engine carries, and no VS Code command-line tool was found on PATH .*Shell Command: Install 'code' command in PATH/,
    );
    await expect(attempt("win32")).rejects.toThrow(/installer adds it to PATH/);
    expect(ran).toEqual([]);
  });

  it("refuses where this engine carries no companion to install", async () => {
    const at = machine({ Default: { claudeCode: true } });
    const fake = cli(at);
    await expect(ensureCompanion({ ...options(at, fake), carried: null })).rejects.toThrow(
      /built without one, so nothing was injected/,
    );
    expect(fake.calls).toEqual([]);
  });

  it("looks at the default profile where no profile lists Claude Code, and says so beside the install", async () => {
    const at = machine({ Default: {}, Work: {} });
    const fake = cli(at);
    const ensured = await ensureCompanion(options(at, fake));
    expect(fake.calls).toEqual([installArgv(carried.vsix, null, false)]);
    expect(ensured.lines[0]).toBe(
      "no VS Code profile lists Claude Code, so this looked at the default profile alone",
    );
  });

  it("reads the default profile from the extensions directory where there is no storage.json", async () => {
    const at = machine({ Default: { claudeCode: true, companion: "carried" } }, false);
    const fake = cli(at);
    expect(await ensureCompanion(options(at, fake))).toEqual({
      lines: [],
      needs: [],
      installed: [],
    });
  });

  it("says every time that the profiles could not be read", async () => {
    const at = machine({ Default: { claudeCode: true, companion: "carried" } });
    writeFileSync(join(at.userData, "User", "globalStorage", "storage.json"), "{ not json");
    const ensured = await ensureCompanion(options(at, cli(at)));
    expect(ensured.installed).toEqual([]);
    expect(ensured.lines).toEqual([
      expect.stringMatching(
        /^VS Code's profiles could not be read, so this looked at the default profile alone: /,
      ),
    ]);
  });
});

describe("lookAtCompanion", () => {
  it("says what install would do, and does none of it", () => {
    const at = machine({
      Default: { claudeCode: true, companion: { version: "1.1.0" } },
      Work: { claudeCode: true },
      Ok: { claudeCode: true, companion: "carried" },
    });
    const lists = (): string[] =>
      ["Default", "Work"].map((name) => readFileSync(at.list(name), "utf8"));
    const before = lists();
    expect(lookAtCompanion({ dirs: at, carried, own: true })).toEqual({
      lines: [],
      needs: [
        'profile "Default" has a companion this engine does not carry, which `rigline install` replaces',
        'profile "Work" has no companion, which `rigline install` puts in',
      ],
    });
    expect(lists()).toEqual(before);
  });
});

describe("makeProfilesCurrent", () => {
  it("installs where a profile has none and replaces another version, leaving the carried build", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: "carried" },
      React: { claudeCode: true, companion: { version: "1.2.0", code: CODE } },
      Work: { claudeCode: true },
      Plain: {},
    });
    const fake = cli(at);
    expect(await makeProfilesCurrent(looking(at, fake))).toEqual({
      v: 1,
      lines: [
        `replaced profile "React"'s companion, 1.2.0, with this engine's, 2.0.0`,
        `installed the companion, 2.0.0, into profile "Work", which had none`,
      ],
      failed: false,
    });
    expect(fake.calls).toEqual([
      installArgv(carried.vsix, "React", true),
      installArgv(carried.vsix, "Work", false),
    ]);
    expect(existsSync(at.lock)).toBe(false);
  });

  // A checkout's build carries the release's version, and that profile may run the checkout (D144).
  it("leaves another build at the carried version, which only a person's verb replaces", async () => {
    const at = machine({
      Default: { claudeCode: true, companion: { version: "2.0.0", code: `${CODE}//checkout` } },
    });
    const fake = cli(at);
    expect(await makeProfilesCurrent(looking(at, fake))).toEqual({
      v: 1,
      lines: [],
      failed: false,
    });
    expect(fake.calls).toEqual([]);
  });

  it("changes nothing while a restore holds, asking again under the lock (D111)", async () => {
    const at = machine({ Default: { claudeCode: true } });
    const fake = cli(at);
    const before = await makeProfilesCurrent(looking(at, fake, () => true));
    let asked = 0;
    const during = await makeProfilesCurrent(looking(at, fake, () => asked++ > 0));
    expect(before.lines).toEqual([
      "changed no profile's companion: Rigline is out since `rigline restore`",
    ]);
    expect(during).toEqual(before);
    expect(fake.calls).toEqual([]);
  });

  it("reads the profiles again once a holder lets go, and installs only what is still stale", async () => {
    const at = machine({ Default: { claudeCode: true }, Work: { claudeCode: true } });
    const fake = cli(at);
    const since = new Date().toISOString();
    writeFileSync(at.lock, JSON.stringify({ pid: process.pid, since, what: "another window" }));
    const answer = await makeProfilesCurrent({
      ...looking(at, fake),
      lock: {
        path: at.lock,
        // The holder finishes Default, then lets go.
        sleep: async () => {
          if (!existsSync(at.lock)) return;
          await fake.run(null, installArgv(carried.vsix, null, false));
          rmSync(at.lock);
        },
      },
    });
    expect(fake.calls).toEqual([
      installArgv(carried.vsix, null, false),
      installArgv(carried.vsix, "Work", false),
    ]);
    expect(answer.lines).toEqual([
      `installed the companion, 2.0.0, into profile "Work", which had none`,
    ]);
  });

  it("reports an install that failed, with what the CLI said and the way round it", async () => {
    const at = machine({ Default: { claudeCode: true } });
    const answer = await makeProfilesCurrent(looking(at, cli(at, { Default: 1 })));
    expect(answer.failed).toBe(true);
    expect(answer.lines).toEqual([
      `the companion could not be installed into profile "Default": Profile 'Default' broke. ` +
        `Extensions: Install from VSIX… in that profile, with ${carried.vsix}, does it by hand`,
    ]);
  });

  it("says so where this engine carries no companion, and installs nothing", async () => {
    const at = machine({ Default: { claudeCode: true }, Work: { claudeCode: true } });
    const fake = cli(at);
    const answer = await makeProfilesCurrent({ ...looking(at, fake), carried: null });
    expect(fake.calls).toEqual([]);
    expect(answer.lines).toEqual([
      'profiles "Default" and "Work" lack the companion, and this engine carries none to add',
    ]);
  });
});

describe("isAcquiredEngine", () => {
  const home = join(tmpdir(), "home", ".rigline");

  it("is the engine under the home's prefix, and no other", () => {
    const entry = join(
      home,
      "engine",
      "node_modules",
      "@rigline",
      "core",
      "dist",
      "engine",
      "bin.js",
    );
    expect(isAcquiredEngine(entry, home)).toBe(true);
    expect(isAcquiredEngine(join(tmpdir(), "work", "node_modules", "bin.js"), home)).toBe(false);
    expect(isAcquiredEngine(join(home, "engines", "bin.js"), home)).toBe(false);
  });

  it("compares without case where the filesystem does", () => {
    const entry = join(home, "ENGINE", "bin.js");
    expect(isAcquiredEngine(entry, home, "win32")).toBe(true);
    expect(isAcquiredEngine(entry, home, "linux")).toBe(false);
  });
});
