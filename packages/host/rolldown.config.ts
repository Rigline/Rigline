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

export default [hook("pre"), hook("post")];
