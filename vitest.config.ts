import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "plugins/*/src/**/*.test.ts",
      // The release scripts are plain ES modules with no build step, so their tests are too.
      "scripts/**/*.test.mjs",
    ],
    environment: "node",
  },
  resolve: {
    // Tests read the workspace packages from source, so a test never runs against a stale dist/.
    // Builds and typechecks resolve through each package's exports as a consumer would.
    // Anchored, so the root's alias does not also rewrite `@rigline/plugin-api/ui`.
    alias: [
      {
        find: /^@rigline\/plugin-api\/ui$/,
        replacement: fileURLToPath(
          new URL("./packages/plugin-api/src/ui/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@rigline\/plugin-api$/,
        replacement: fileURLToPath(new URL("./packages/plugin-api/src/index.ts", import.meta.url)),
      },
      {
        find: /^@rigline\/core$/,
        replacement: fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      },
    ],
  },
});
