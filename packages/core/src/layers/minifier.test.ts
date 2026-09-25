import { minifySync } from "rolldown/utils";
import { describe, expect, it } from "vitest";
import { CORPUS_VERSIONS, corpusBundles, missing } from "../../test/corpus.ts";
import { harvestableHostReplies, harvestableWebview } from "../../test/fixtures.ts";
import { scanToJson } from "./diff.ts";
import { harvestAll, scanOf } from "./index.ts";
import type { Bundles } from "./types.ts";

/** The bundles as Rolldown writes them, which quotes plain strings with backticks (D101). */
function rolldown(bundles: Bundles, compress: boolean): Bundles {
  const options = { compress, mangle: compress };
  return {
    ...bundles,
    webview: minifySync("index.js", bundles.webview, { ...options, module: true }).code,
    host: minifySync("extension.js", bundles.host, options).code,
  };
}

function views(bundles: Bundles, except: readonly string[] = []): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(scanToJson(scanOf(harvestAll(bundles))).views).filter(
      ([view]) => !except.includes(view),
    ),
  );
}

describe("the harvest is indifferent to the minifier", () => {
  const webview = harvestableWebview();
  const fixture: Bundles = {
    version: "0.0.0",
    webview: webview.js,
    host: harvestableHostReplies(),
    css: webview.css,
  };

  it("reads strings written as template literals", () => {
    const requoted = rolldown(fixture, false);
    expect(requoted.webview).toContain("type:`req_0`");
    expect(requoted.webview).not.toContain('"req_0"');
    expect(views(requoted)).toEqual(views(fixture));
  });

  it("reads strings written with single quotes", () => {
    const requoted = {
      ...fixture,
      webview: fixture.webview.replaceAll('"', "'"),
      host: fixture.host.replaceAll('"', "'"),
    };
    expect(requoted.webview).not.toContain('"');
    expect(views(requoted)).toEqual(views(fixture));
  });

  for (const version of CORPUS_VERSIONS) {
    it.skipIf(missing(version))(
      `reads ${version} the same after Rolldown re-minifies it`,
      () => {
        // A compressor folds `c?F(A,{className:x}):F(B,{className:x})` into one site (D101).
        const except = ["classes.reused"];
        const reminified = rolldown(corpusBundles(version), true);
        expect(reminified.webview).toContain("rendererPackageName:`react-dom`");
        expect(views(reminified, except)).toEqual(views(corpusBundles(version), except));
      },
      60_000,
    );
  }
});
