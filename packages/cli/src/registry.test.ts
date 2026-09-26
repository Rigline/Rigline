/**
 * The wrapper's registry client, against a `fetch` this file provides. Nothing here touches the
 * network.
 *
 * The last block earns the duplication D69 accepts: the engine resolves plugins with its own copy,
 * so the two are fed the same packuments. The import is relative and test-only, as `engine.test.ts`'s
 * is.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as core from "../../core/src/plugins/npm.ts";
import {
  describeAge,
  type FetchLike,
  type PluginSpec,
  type RegistryOptions,
  releaseAgeProblem,
  resolveVersion,
} from "./registry.ts";

const REGISTRY = "https://registry.example";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const AGES_AGO = "2026-09-01T12:00:00.000Z";
const MINUTES_AGO = "2026-09-18T11:20:00.000Z";
const INTEGRITY = `sha512-${createHash("sha512").update("the tarball").digest("base64")}`;

interface PackumentOptions {
  readonly tags?: Readonly<Record<string, string>>;
  readonly time?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, unknown>>;
}

/** A registry serving one package, and 404 for everything else. */
function registry(options: PackumentOptions = {}): FetchLike {
  const packument = {
    "dist-tags": options.tags ?? { latest: "1.2.0" },
    time: options.time ?? { "1.2.0": AGES_AGO, "1.1.0": AGES_AGO },
    versions: options.versions ?? {
      "1.1.0": { dist: { tarball: `${REGISTRY}/clock/-/clock-1.1.0.tgz`, integrity: INTEGRITY } },
      "1.2.0": { dist: { tarball: `${REGISTRY}/clock/-/clock-1.2.0.tgz`, integrity: INTEGRITY } },
    },
  };
  return async (url: string) => response(url === `${REGISTRY}/clock` ? 200 : 404, packument);
}

function response(status: number, body: unknown) {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

const options = (extra: Partial<RegistryOptions> = {}): RegistryOptions => ({
  registry: REGISTRY,
  fetchImpl: registry(),
  clock: () => NOW,
  ...extra,
});

const LATEST: PluginSpec = { name: "clock", version: null, tag: null };

describe("resolveVersion", () => {
  it("follows latest by default and records the tag it followed", async () => {
    const resolved = await resolveVersion(LATEST, options());
    expect(resolved.version).toBe("1.2.0");
    expect(resolved.tag).toBe("latest");
    expect(resolved.integrity).toBe(INTEGRITY);
  });

  it("records no tag when a version was named", async () => {
    const resolved = await resolveVersion({ ...LATEST, version: "1.1.0" }, options());
    expect(resolved.version).toBe("1.1.0");
    expect(resolved.tag).toBeNull();
  });

  it("names the tags there are when the one asked for is not among them", async () => {
    await expect(resolveVersion({ ...LATEST, tag: "next" }, options())).rejects.toThrow(
      /has no "next" tag; it has latest/,
    );
  });

  it("says a 404 is a 404, since the likely cause is the name", async () => {
    await expect(resolveVersion({ ...LATEST, name: "cloak" }, options())).rejects.toThrow(
      /is not there \(404\)/,
    );
  });

  it("normalises a legacy hex shasum into SRI", async () => {
    const shasum = createHash("sha1").update("the tarball").digest("hex");
    const resolved = await resolveVersion(
      LATEST,
      options({
        fetchImpl: registry({
          versions: { "1.2.0": { dist: { tarball: `${REGISTRY}/c.tgz`, shasum } } },
        }),
      }),
    );
    expect(resolved.integrity).toBe(`sha1-${Buffer.from(shasum, "hex").toString("base64")}`);
  });

  it("refuses a release with no integrity hash at all", async () => {
    await expect(
      resolveVersion(
        LATEST,
        options({
          fetchImpl: registry({
            versions: { "1.2.0": { dist: { tarball: `${REGISTRY}/c.tgz` } } },
          }),
        }),
      ),
    ).rejects.toThrow(/carries no integrity hash/);
  });
});

describe("releaseAgeProblem", () => {
  const young = () =>
    resolveVersion(LATEST, options({ fetchImpl: registry({ time: { "1.2.0": MINUTES_AGO } }) }));

  it("holds back a version published inside the window, naming it, its age and the flag", async () => {
    const problem = releaseAgeProblem(await young(), {});
    expect(problem).toContain("clock@1.2.0 was published 40 minutes ago");
    expect(problem).toContain("--now");
  });

  it("lets it through on --now, and once it is old enough", async () => {
    expect(releaseAgeProblem(await young(), { ignoreReleaseAge: true })).toBeNull();
    expect(releaseAgeProblem(await young(), { minimumReleaseAge: 10 })).toBeNull();
    expect(releaseAgeProblem(await resolveVersion(LATEST, options()))).toBeNull();
  });

  it("does not gate on a registry that does not date its releases", async () => {
    const resolved = await resolveVersion(LATEST, options({ fetchImpl: registry({ time: {} }) }));
    expect(resolved.ageMinutes).toBeNull();
    expect(releaseAgeProblem(resolved)).toBeNull();
  });
});

describe("describeAge", () => {
  it("does not make a person divide", () => {
    expect(describeAge(1)).toBe("1 minute");
    expect(describeAge(59)).toBe("59 minutes");
    expect(describeAge(60)).toBe("1 hour");
    expect(describeAge(1440)).toBe("24 hours");
    expect(describeAge(4320)).toBe("3 days");
  });
});

describe("the engine's copy", () => {
  const packuments: readonly [string, PackumentOptions, PluginSpec][] = [
    ["latest", {}, LATEST],
    ["a named version", {}, { ...LATEST, version: "1.1.0" }],
    ["a young release", { time: { "1.2.0": MINUTES_AGO } }, LATEST],
    ["an undated release", { time: {} }, LATEST],
    [
      "a legacy shasum",
      { versions: { "1.2.0": { dist: { tarball: `${REGISTRY}/c.tgz`, shasum: "0".repeat(40) } } } },
      LATEST,
    ],
  ];

  it.each(packuments)("resolves %s and gates it as this one does", async (_, packument, spec) => {
    const given = options({ fetchImpl: registry(packument) });
    const ours = await resolveVersion(spec, given);
    const theirs = await core.resolveVersion(spec, given);
    expect(theirs).toEqual(ours);
    expect(core.releaseAgeProblem(theirs, given)).toBe(releaseAgeProblem(ours, given));
  });

  it("refuses what this one refuses, in the same words", async () => {
    const given = options({ fetchImpl: registry({ tags: { next: "1.2.0" } }) });
    const ours = await resolveVersion(LATEST, given).catch((error: Error) => error.message);
    const theirs = await core.resolveVersion(LATEST, given).catch((error: Error) => error.message);
    expect(theirs).toBe(ours);
    expect(ours).toMatch(/has no "latest" tag/);
  });
});
