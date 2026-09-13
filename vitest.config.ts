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
});
