/** An engine on disk, a registry serving one, and a finished child: what the wrapper's tests fake. */
import type { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_BIN, ENGINE_PACKAGE } from "../src/engine.ts";
import type { FetchLike, RegistryOptions } from "../src/registry.ts";

/** An engine prefix as npm would have left it, or as an older core would have. */
export function writeEngine(
  prefix: string,
  manifest: Record<string, unknown>,
  entry: string | null = "dist/engine/bin.js",
): string {
  const dir = join(prefix, "node_modules", ENGINE_PACKAGE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  if (entry !== null) {
    mkdirSync(join(dir, "dist", "engine"), { recursive: true });
    writeFileSync(join(dir, entry), "");
  }
  return dir;
}

export function core(version: string): Record<string, unknown> {
  return { name: ENGINE_PACKAGE, version, bin: { [ENGINE_BIN]: "./dist/engine/bin.js" } };
}

/** A registry serving one version of `@rigline/core`, with no network anywhere. */
export function npm(
  version: string,
  publishedAt = "2026-09-01T12:00:00.000Z",
  enginesNode?: string,
): RegistryOptions {
  const packument = {
    "dist-tags": { latest: version },
    time: { [version]: publishedAt },
    versions: {
      [version]: {
        ...(enginesNode === undefined ? {} : { engines: { node: enginesNode } }),
        dist: { tarball: "https://example/core.tgz", integrity: "sha512-x" },
      },
    },
  };
  const fetchImpl: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => packument,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  return {
    registry: "https://registry.example",
    fetchImpl,
    clock: () => Date.parse("2026-09-21T12:00:00.000Z"),
  };
}

/** A child process that has already finished. Enough of one for `close` and for no stdio. */
export function fakeChild(code: number): ReturnType<typeof spawn> {
  const handlers = new Map<string, (value: number) => void>();
  queueMicrotask(() => handlers.get("close")?.(code));
  return {
    stdout: null,
    stderr: null,
    on(event: string, handler: (value: number) => void) {
      handlers.set(event, handler);
      return this;
    },
  } as unknown as ReturnType<typeof spawn>;
}
