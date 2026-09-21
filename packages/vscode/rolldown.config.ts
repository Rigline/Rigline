import { defineConfig } from "rolldown";

/**
 * One CommonJS file, with `vscode` left alone.
 *
 * `vscode` is not a package: the extension host supplies it at require time, so bundling it is
 * impossible and marking it external is the only correct treatment.
 *
 * CommonJS rather than ESM, though everything here is written as modules. VS Code's support for an
 * ESM `main` is recent and conditional, and a sideloaded extension that fails to load has no
 * diagnostic a user could act on — it is simply absent, which is the failure mode this milestone
 * exists to remove. The bundle is the output format, not the source's.
 *
 * The wrapper's acquisition code is inlined here (D80). That is the direction sharing goes: this
 * package bundles, `rigline` publishes unbundled, so the import can only run this way round.
 */
export default defineConfig({
  input: "src/extension.ts",
  platform: "node",
  external: ["vscode"],
  output: {
    file: "dist/extension.cjs",
    format: "cjs",
    sourcemap: "inline",
    codeSplitting: false,
  },
});
