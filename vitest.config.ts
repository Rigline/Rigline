import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "plugins/*/src/**/*.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    // Tests read the workspace packages from source, so a test never runs against a stale dist/.
    // Builds and typechecks resolve through each package's exports as a consumer would.
    alias: {
      "@prototype/plugin-api": fileURLToPath(
        new URL("./packages/plugin-api/src/index.ts", import.meta.url),
      ),
      "@prototype/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
});
