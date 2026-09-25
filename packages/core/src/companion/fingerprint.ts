/**
 * Whether an installed companion is the one this engine carries (D99).
 *
 * By fingerprint rather than version: the version follows releases, and most releases leave the
 * companion alone. The fingerprint leaves out what differs between two copies of one build.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledDir } from "../assets.ts";
import { COMPANION_VSIX } from "./setup.ts";

/** Beside the VSIX in `dist/bundled`: its version and fingerprint, written by `bundle-assets`. */
export const COMPANION_SIDECAR = "rigline.vsix.json";

/** How VS Code names a companion's directory, before the version. */
const COMPANION_PREFIX = "rigline.rigline-";

/** Every companion directory in `extensionsDir`, which holds every profile's. */
export function companionDirs(extensionsDir: string): string[] {
  if (!existsSync(extensionsDir)) return [];
  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(COMPANION_PREFIX))
    .map((entry) => join(extensionsDir, entry.name));
}

/** The file the companion's manifest names as `main`, which is all of its code. */
const COMPANION_CODE = "extension.cjs";

const SOURCE_MAP = "//# sourceMappingURL=";

/**
 * One build's identity: its code without the inline source map, which embeds the sources with the
 * checkout's line endings, and its manifest without `version` or VS Code's `__metadata`.
 */
export function companionFingerprint(code: string, manifest: unknown): string {
  const body = code
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith(SOURCE_MAP))
    .join("\n");
  const fields =
    manifest !== null && typeof manifest === "object"
      ? Object.fromEntries(
          Object.entries(manifest).filter(([key]) => key !== "version" && key !== "__metadata"),
        )
      : {};
  return createHash("sha256")
    .update(body)
    .update("\0")
    .update(JSON.stringify(sorted(fields)))
    .digest("hex");
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
  );
}

/** The fingerprint of the companion in `dir`, or null when it cannot be read. */
export function installedFingerprint(dir: string): string | null {
  try {
    return companionFingerprint(
      readFileSync(join(dir, COMPANION_CODE), "utf8"),
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
    );
  } catch {
    return null;
  }
}

export interface CarriedCompanion {
  readonly version: string;
  readonly fingerprint: string;
  readonly vsix: string;
}

/** The companion this engine carries, or null when it was built without one. */
export function carriedCompanion(bundled: string = bundledDir()): CarriedCompanion | null {
  const vsix = join(bundled, COMPANION_VSIX);
  const sidecar = join(bundled, COMPANION_SIDECAR);
  if (!existsSync(vsix) || !existsSync(sidecar)) return null;
  const { version, fingerprint } = JSON.parse(readFileSync(sidecar, "utf8")) as Record<
    string,
    unknown
  >;
  if (typeof version !== "string" || typeof fingerprint !== "string") return null;
  return { version, fingerprint, vsix };
}

/** What `companion-status` prints. `v`, so a companion can tell an answer it does not understand. */
export interface CompanionStatus {
  readonly v: 1;
  /** Whether the companion in the directory asked about is the one this engine carries. */
  readonly current: boolean;
  readonly carried: CarriedCompanion | null;
}

/** Compares `dir` alone: every profile shares the extensions directory, so a neighbour proves nothing. */
export function companionStatus(dir: string, bundled?: string): CompanionStatus {
  const carried = carriedCompanion(bundled);
  return {
    v: 1,
    current: carried !== null && installedFingerprint(dir) === carried.fingerprint,
    carried,
  };
}
