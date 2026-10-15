import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "docs/archive/**",
      "generated.ts",
      "packages/create-plugin/template/**",
      "packages/plugin-api/schema/**",
      ".local/**",
      ".claude/worktrees/**",
    ],
  },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    // A leading underscore is this codebase's existing mark for a binding that exists to satisfy a
    // signature, so the rule should read it the same way.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  ...tseslint.configs.recommended,
  {
    // The type-aware rules are the reason for this stack, and they need a tsconfig that owns the
    // file — which the config and script files at the package roots do not have.
    files: [
      "packages/*/src/**/*.{ts,tsx}",
      "packages/*/test/**/*.{ts,tsx}",
      "plugins/*/src/**/*.{ts,tsx}",
    ],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // A test builds fakes and feeds hand-written payloads, so the `any` family and `require-await`
    // report the fixture rather than a defect. Everything type-aware stays on for src.
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  // Last, so it switches off every rule the formatter owns.
  prettier,
);
