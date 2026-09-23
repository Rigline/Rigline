import { createRequire } from "node:module";
import { basename } from "node:path";
import { RUNTIME_MODULES } from "@rigline/plugin-api";
import { defineConfig } from "rolldown";

/**
 * One self-contained file per hook.
 *
 * The injector copies exactly pre.js and post.js into the extension, so a shared chunk between
 * them would leave pre.js statically importing a file that was never copied, which fails the
 * module graph and renders the panel blank. Separate single-input builds with splitting off make
 * that unbuildable rather than merely unlikely.
 *
 * Neither file carries anything version-specific. The identifier tables are written beside the
 * payload by the injector, harvested from the bundle it is patching, so one build serves every
 * installed extension version.
 */
const hook = (name: "pre" | "post") =>
  defineConfig({
    input: `src/${name}.ts`,
    platform: "browser",
    output: {
      file: `dist/${name}.js`,
      format: "esm",
      // Inline, not a sibling: the webview's CSP is default-src 'none', so a separate fetch for
      // the map is a gamble. This is debugged in Open Webview Developer Tools.
      sourcemap: "inline",
      codeSplitting: false,
    },
  });

const VIRTUAL = "\0rigline-runtime:";

/** Every export `specifier` has, as the production build defines them. */
function exportNames(specifier: string): string[] {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const module = createRequire(import.meta.url)(specifier) as Record<string, unknown>;
    return Object.keys(module).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  } finally {
    process.env.NODE_ENV = previous;
  }
}

/**
 * React ships CommonJS, over which `export *` gives no reliable named exports, so name each one.
 * Our own modules are ES modules, and re-export as they stand.
 */
function runtimeEntry(specifier: string): string {
  if (specifier.startsWith("@rigline/")) return `export * from ${JSON.stringify(specifier)};\n`;
  const exports = exportNames(specifier).filter((name) => name !== "default");
  return [
    `import runtime from ${JSON.stringify(specifier)};`,
    ...exports.map((name) => `export const ${name} = runtime.${name};`),
    "export default runtime;",
    "",
  ].join("\n");
}

/**
 * The modules plugins import (RUNTIME_MODULES), one entry each, and the shell, which post.js loads:
 * all over shared chunks, so one React and one `@rigline/plugin-api/ui` (D88).
 */
const runtime = defineConfig({
  input: {
    ...Object.fromEntries(
      Object.entries(RUNTIME_MODULES).map(([specifier, file]) => [
        basename(file, ".js"),
        VIRTUAL + specifier,
      ]),
    ),
    shell: "src/shell/index.tsx",
  },
  platform: "browser",
  // The shell reaches plugin-api through its exports, as the entries do. tsconfig paths would hand
  // it the source and them the build: two copies of the menu's context (D88).
  tsconfig: false,
  plugins: [
    {
      name: "rigline-runtime-entries",
      resolveId: (id) => (id.startsWith(VIRTUAL) ? id : null),
      load: (id) => (id.startsWith(VIRTUAL) ? runtimeEntry(id.slice(VIRTUAL.length)) : null),
    },
  ],
  transform: {
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    jsx: "react-jsx",
  },
  output: {
    dir: "dist/runtime",
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
    minify: true,
  },
});

export default [hook("pre"), hook("post"), runtime];
