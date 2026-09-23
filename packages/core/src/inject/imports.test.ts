import { describe, expect, it } from "vitest";
import { importProblem, resolveRuntimeImports } from "./imports.ts";

const ENTRY = "plugins/badge/dist/index.js";

describe("resolveRuntimeImports", () => {
  it("points each runtime import at the payload's copy, relative to the entry", () => {
    const source = [
      'import { useState } from "react";',
      'import { jsx } from "react/jsx-runtime";',
      'export { createPortal } from "react-dom";',
      "",
    ].join("\n");
    const { source: out, unresolved } = resolveRuntimeImports(source, ENTRY);
    expect(out).toBe(
      [
        'import { useState } from "../../../runtime/react.js";',
        'import { jsx } from "../../../runtime/jsx-runtime.js";',
        'export { createPortal } from "../../../runtime/react-dom.js";',
        "",
      ].join("\n"),
    );
    expect(unresolved).toEqual([]);
  });

  it("keeps a dynamic import's quotes, which its range includes", () => {
    const { source } = resolveRuntimeImports('const r = import("react");', "plugins/x/index.js");
    expect(source).toBe('const r = import("../../runtime/react.js");');
  });

  it("leaves relative imports, URLs and specifier-shaped strings alone", () => {
    const source = [
      'import "./local.js";',
      'import data from "data:text/javascript,export default 1";',
      'const note = "from \\"react\\"";',
      "// import x from 'react';",
      "",
    ].join("\n");
    const result = resolveRuntimeImports(source, ENTRY);
    expect(result.source).toBe(source);
    expect(result.unresolved).toEqual([]);
  });

  it("names each bare import outside the runtime set once", () => {
    const source = 'import a from "lodash";\nimport b from "lodash";\nimport c from "react";\n';
    expect(resolveRuntimeImports(source, ENTRY).unresolved).toEqual(["lodash"]);
  });
});

describe("importProblem", () => {
  it("is null for a plugin whose imports all resolve", () => {
    expect(importProblem('import { useState } from "react";\nexport default {};')).toBeNull();
  });

  it("names what cannot be resolved and what can", () => {
    expect(importProblem('import pad from "left-pad";')).toBe(
      'it imports "left-pad", which the panel does not provide; bundle it, or import only ' +
        "react, react/jsx-runtime, react-dom",
    );
  });

  it("says so when the entry cannot be read as a module at all", () => {
    expect(importProblem("import {")).toMatch(/^its entry is not an ES module Rigline can read/);
  });
});
