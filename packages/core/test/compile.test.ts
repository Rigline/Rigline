/**
 * The compile-time half of the contract, proved by running the compiler (decisions.md, D40).
 *
 * Every other test here asks what happens at install or at load. This asks the one question those
 * cannot: does a plugin author find out, while typing, that they have paired a class with the wrong
 * module or named a message that does not exist. The answer rests on a module augmentation
 * resolving and merging correctly across a program boundary, which is exactly the kind of property
 * that works when it is set up and quietly stops working a year later, so it is worth a test that
 * actually drives `tsc` rather than a comment claiming it holds.
 *
 * Both halves are asserted, because D40 needs both. With a harvest the unions narrow and a wrong
 * pair is an error; with no harvest every union widens to `string` and the same source compiles,
 * which is what lets a scaffold build before codegen has ever run.
 *
 * The augmentation is written into a temporary directory *outside* the fixture plugin's own
 * directory, and pulled in by the tsconfig, because that is the arrangement the phase 4 template
 * needs: one harvest at a workspace root serving every plugin in the repository (D50).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { generate } from "../src/codegen/generate.ts";
import { harvestAll } from "../src/layers/index.ts";
import { harvestableHostReplies, harvestableWebview } from "./fixtures.ts";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const TSC = join(REPO, "node_modules", "typescript", "bin", "tsc");
const PLUGIN_API = join(REPO, "packages", "plugin-api", "src", "index.ts");

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The augmentation for the synthetic bundle the other fixtures use: modules `f00000`.., `req_0`.. */
function augmentation(): string {
  const { js, css } = harvestableWebview();
  return generate(
    harvestAll({ version: "9.9.9", webview: js, host: harvestableHostReplies(), css }),
  ).source;
}

/**
 * A throwaway plugin workspace: the harvest at the root, the plugin in a subdirectory, and a
 * tsconfig that reaches the first from the second. Returns `tsc`'s output, empty when it succeeded.
 */
function compile(source: string, options: { readonly harvest: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), "rigline-compile-"));
  dirs.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "w", type: "module" }));
  if (options.harvest) writeFileSync(join(root, "generated.ts"), augmentation());

  const plugin = join(root, "plugins", "fixture");
  mkdirSync(join(plugin, "src"), { recursive: true });
  writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "p", type: "module" }));
  writeFileSync(join(plugin, "src", "index.ts"), source);
  writeFileSync(
    join(plugin, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        lib: ["esnext", "dom"],
        types: [],
        paths: { "@rigline/plugin-api": [PLUGIN_API] },
      },
      // The harvest by absolute path from two directories away: a plugin never imports it, and the
      // augmentation reaches this program only because the config pulls the file in.
      ...(options.harvest ? { files: [join(root, "generated.ts")] } : {}),
      include: ["src/**/*.ts"],
    }),
  );

  try {
    execFileSync(process.execPath, [TSC, "-p", join(plugin, "tsconfig.json")], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return "";
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

const HEAD = `import { definePlugin } from "@rigline/plugin-api";\n\nexport default definePlugin({\n  setup(ctx) {\n`;
const TAIL = `  },\n});\n`;

function plugin(body: string): string {
  return `${HEAD}${body}${TAIL}`;
}

const RIGHT = plugin(`    ctx.cls("f00000", "local1");
    ctx.onMessage("req_0", () => {});
    ctx.rewrite("req_0", () => ({ field_0: 1 }));
`);

describe("a plugin compiled against a committed harvest", () => {
  it("accepts a pair, a message type and a field the extension really has", () => {
    expect(compile(RIGHT, { harvest: true })).toBe("");
  }, 60000);

  it("refuses a local class from the wrong module, which is the failure module scoping exists for", () => {
    const out = compile(
      plugin(`    ctx.cls("f00001", "local1");\n    ctx.cls("f00000", "nope");\n`),
      {
        harvest: true,
      },
    );
    // `local1` exists — in every module — so the first call is only wrong as a pair. A flat class
    // map would have accepted it and resolved the wrong element at runtime.
    expect(out).toContain("nope");
    expect(out).toMatch(/error TS/);
  }, 60000);

  it("refuses a module, a message type and a payload field that do not exist", () => {
    const cases = [
      `    ctx.cls("zzzzzz", "local1");\n`,
      `    ctx.onMessage("not_a_message", () => {});\n`,
      `    ctx.rewrite("req_0", () => ({ not_a_field: 1 }));\n`,
    ];
    for (const body of cases) {
      expect(compile(plugin(body), { harvest: true }), body).toMatch(/error TS/);
    }
  }, 120000);
});

/**
 * The source a scaffolded plugin starts life as, run through the same compiler.
 *
 * It is the one plugin in this repository that nothing else typechecks: it lives under
 * `create-plugin/template/` with `__NAME__` placeholders, outside every package's `include`, and a
 * scaffolded copy resolves `@rigline/plugin-api` from npm rather than from here — so a template
 * written against an API this repository has but has not yet published looks fine until somebody
 * scaffolds. Both halves, because a fresh scaffold has no harvest and gains one at `pnpm codegen`.
 */
describe("the template create-rigline-plugin ships", () => {
  const source = readFileSync(
    join(REPO, "packages/create-plugin/template/plugins/__NAME__/src/index.ts"),
    "utf8",
  );

  it("compiles before codegen has ever run, and again once it has", () => {
    expect(compile(source, { harvest: false })).toBe("");
    expect(compile(source, { harvest: true })).toBe("");
  }, 120000);
});

describe("the same plugin with no harvest committed", () => {
  it("compiles unchanged, because every union widens to string (D40)", () => {
    expect(compile(RIGHT, { harvest: false })).toBe("");
  }, 60000);

  it("accepts what the harvest would have refused, so a scaffold builds before codegen has run", () => {
    const out = compile(
      plugin(`    ctx.cls("zzzzzz", "anything");\n    ctx.onMessage("not_a_message", () => {});\n`),
      { harvest: false },
    );
    expect(out).toBe("");
  }, 60000);
});
