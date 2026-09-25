import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPANION_SIDECAR,
  carriedCompanion,
  companionFingerprint,
  companionStatus,
  installedFingerprint,
} from "./fingerprint.ts";
import { COMPANION_VSIX } from "./setup.ts";

const made: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-companion-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CODE = '"use strict";\nexports.activate = () => {};\n';
const MANIFEST = { name: "rigline", version: "1.0.0-alpha.11", activationEvents: ["onUri"] };

/** A companion directory as VS Code extracts one. */
function companion(parent: string, code = CODE, manifest: unknown = MANIFEST): string {
  const dir = join(parent, `rigline.rigline-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.cjs"), code);
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

/** A `dist/bundled` carrying the companion that `CODE` and `MANIFEST` describe. */
function bundled(): string {
  const dir = temp();
  writeFileSync(join(dir, COMPANION_VSIX), "a vsix");
  writeFileSync(
    join(dir, COMPANION_SIDECAR),
    JSON.stringify({
      version: "1.0.0-alpha.11",
      fingerprint: companionFingerprint(CODE, MANIFEST),
    }),
  );
  return dir;
}

describe("companionFingerprint", () => {
  const base = companionFingerprint(CODE, MANIFEST);

  it("is the same build whatever the checkout's line endings, since the source map carries them", () => {
    const withMap = (text: string) =>
      `${text}//# sourceMappingURL=data:application/json;base64,A\n`;
    expect(companionFingerprint(withMap(CODE), MANIFEST)).toBe(base);
    expect(companionFingerprint(withMap(CODE).replace(/\n/g, "\r\n"), MANIFEST)).toBe(base);
  });

  it("ignores the version, VS Code's __metadata and key order", () => {
    const installed = {
      activationEvents: ["onUri"],
      version: "1.0.0-alpha.12",
      name: "rigline",
      __metadata: { installedTimestamp: 1 },
    };
    expect(companionFingerprint(CODE, installed)).toBe(base);
  });

  it("differs when the code or the rest of the manifest does", () => {
    expect(companionFingerprint(`${CODE};`, MANIFEST)).not.toBe(base);
    expect(companionFingerprint(CODE, { ...MANIFEST, activationEvents: [] })).not.toBe(base);
  });
});

describe("companionStatus", () => {
  it("is current when the companion in the directory asked about is the one carried", () => {
    const status = companionStatus(companion(temp()), bundled());
    expect(status).toMatchObject({ v: 1, current: true });
    expect(status.carried?.version).toBe("1.0.0-alpha.11");
  });

  // Every profile shares the extensions directory, so a current neighbour can be another profile's.
  it("compares only that directory, never a neighbour", () => {
    const parent = temp();
    companion(parent);
    const stale = companion(parent, `${CODE};`);
    expect(companionStatus(stale, bundled()).current).toBe(false);
  });

  it("is not current for a directory it cannot read", () => {
    const dir = companion(temp());
    writeFileSync(join(dir, "package.json"), "{ not json");
    expect(installedFingerprint(dir)).toBeNull();
    expect(companionStatus(dir, bundled()).current).toBe(false);
  });

  it("carries nothing from an engine built without a companion", () => {
    const empty = temp();
    expect(carriedCompanion(empty)).toBeNull();
    expect(companionStatus(companion(temp()), empty)).toEqual({
      v: 1,
      current: false,
      carried: null,
    });
  });
});
