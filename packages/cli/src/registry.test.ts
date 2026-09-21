/**
 * The registry client, against a `fetch` this file provides. Nothing here touches the network.
 *
 * What is worth pinning is the three things that decide whether a version is installed at all: the
 * spec that was typed, the age gate (D48), and the integrity check (D49).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { packageTarball } from "../test/tar.ts";
import { UserError } from "./errors.ts";
import {
  describeAge,
  type FetchLike,
  fetchTarball,
  integrityProblem,
  parsePluginSpec,
  releaseAgeProblem,
  resolveVersion,
} from "./registry.ts";

const REGISTRY = "https://registry.example";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const AGES_AGO = "2026-09-01T12:00:00.000Z";
const MINUTES_AGO = "2026-09-18T11:20:00.000Z";

const TARBALL = packageTarball({ "rigline.json": '{"api":1,"name":"clock","entry":"i.js"}' });
const INTEGRITY = `sha512-${createHash("sha512").update(TARBALL).digest("base64")}`;

interface PackumentOptions {
  readonly tags?: Readonly<Record<string, string>>;
  readonly time?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, unknown>>;
}

/** A registry serving one package and its tarball, and 404 for everything else. */
function registry(options: PackumentOptions = {}): FetchLike {
  const packument = {
    "dist-tags": options.tags ?? { latest: "1.2.0" },
    time: options.time ?? { "1.2.0": AGES_AGO, "1.1.0": AGES_AGO },
    versions: options.versions ?? {
      "1.1.0": { dist: { tarball: `${REGISTRY}/clock/-/clock-1.1.0.tgz`, integrity: INTEGRITY } },
      "1.2.0": { dist: { tarball: `${REGISTRY}/clock/-/clock-1.2.0.tgz`, integrity: INTEGRITY } },
    },
  };
  return async (url: string) => {
    if (url.endsWith(".tgz")) return response(200, TARBALL);
    if (url === `${REGISTRY}/clock`) return response(200, packument);
    return response(404, {});
  };
}

function response(status: number, body: unknown) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

const options = (extra: Record<string, unknown> = {}) => ({
  registry: REGISTRY,
  fetchImpl: registry(),
  clock: () => NOW,
  ...extra,
});

describe("parsePluginSpec", () => {
  it("tells a version from a tag by whether it looks like one, there being no ranges", () => {
    expect(parsePluginSpec("clock")).toEqual({ name: "clock", version: null, tag: null });
    expect(parsePluginSpec("clock@1.2.0")).toEqual({ name: "clock", version: "1.2.0", tag: null });
    expect(parsePluginSpec("clock@1.2.0-rc.1")).toEqual({
      name: "clock",
      version: "1.2.0-rc.1",
      tag: null,
    });
    expect(parsePluginSpec("clock@next")).toEqual({ name: "clock", version: null, tag: "next" });
  });

  it("does not read a scope as a tag separator", () => {
    expect(parsePluginSpec("@leo/clock")).toEqual({ name: "@leo/clock", version: null, tag: null });
    expect(parsePluginSpec("@leo/clock@2.0.0")).toEqual({
      name: "@leo/clock",
      version: "2.0.0",
      tag: null,
    });
  });
});

describe("resolveVersion", () => {
  it("follows latest by default and records the tag it followed", async () => {
    const resolved = await resolveVersion(parsePluginSpec("clock"), options());
    expect(resolved.version).toBe("1.2.0");
    expect(resolved.tag).toBe("latest");
    expect(resolved.integrity).toBe(INTEGRITY);
  });

  it("records no tag when a version was named, because that is a person pinning", async () => {
    const resolved = await resolveVersion(parsePluginSpec("clock@1.1.0"), options());
    expect(resolved.version).toBe("1.1.0");
    expect(resolved.tag).toBeNull();
  });

  it("names the tags there are when the one asked for is not among them", async () => {
    await expect(resolveVersion(parsePluginSpec("clock@next"), options())).rejects.toThrow(
      /has no "next" tag; it has latest/,
    );
  });

  it("says a 404 is a 404, since the likely cause is the name", async () => {
    await expect(resolveVersion(parsePluginSpec("cloak"), options())).rejects.toThrow(
      /is not there \(404\)/,
    );
  });

  it("normalises a legacy hex shasum into the SRI it records", async () => {
    const shasum = createHash("sha1").update(TARBALL).digest("hex");
    const resolved = await resolveVersion(
      parsePluginSpec("clock"),
      options({
        fetchImpl: registry({
          versions: { "1.2.0": { dist: { tarball: `${REGISTRY}/c.tgz`, shasum } } },
        }),
      }),
    );
    expect(resolved.integrity).toBe(`sha1-${Buffer.from(shasum, "hex").toString("base64")}`);
    expect(integrityProblem(TARBALL, resolved.integrity)).toBeNull();
  });

  it("refuses a release with no integrity hash at all", async () => {
    await expect(
      resolveVersion(
        parsePluginSpec("clock"),
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
    resolveVersion(
      parsePluginSpec("clock"),
      options({ fetchImpl: registry({ time: { "1.2.0": MINUTES_AGO } }) }),
    );

  it("holds back a version published inside the window, naming it, its age and the flag", async () => {
    const problem = releaseAgeProblem(await young(), {});
    expect(problem).toContain("clock@1.2.0 was published 40 minutes ago");
    expect(problem).toContain("--now");
  });

  it("lets it through on --now, and once it is old enough", async () => {
    expect(releaseAgeProblem(await young(), { ignoreReleaseAge: true })).toBeNull();
    expect(releaseAgeProblem(await young(), { minimumReleaseAge: 10 })).toBeNull();
    expect(releaseAgeProblem(await resolveVersion(parsePluginSpec("clock"), options()))).toBeNull();
  });

  it("does not gate on a registry that does not date its releases", async () => {
    // A rule about our own ignorance rather than about the release.
    const resolved = await resolveVersion(
      parsePluginSpec("clock"),
      options({ fetchImpl: registry({ time: {} }) }),
    );
    expect(resolved.ageMinutes).toBeNull();
    expect(releaseAgeProblem(resolved)).toBeNull();
  });
});

describe("fetchTarball", () => {
  it("returns the bytes when they hash to what was recorded", async () => {
    const resolved = await resolveVersion(parsePluginSpec("clock"), options());
    expect((await fetchTarball(resolved, options())).equals(TARBALL)).toBe(true);
  });

  it("refuses bytes that are not the ones the registry described, and writes nothing", async () => {
    const resolved = await resolveVersion(parsePluginSpec("clock"), options());
    const swapped = { ...resolved, integrity: `sha512-${"A".repeat(86)}==` };
    await expect(fetchTarball(swapped, options())).rejects.toThrow(UserError);
    await expect(fetchTarball(swapped, options())).rejects.toThrow(/Nothing was written/);
  });

  it("says so rather than throwing a digest error at a person", () => {
    expect(integrityProblem(TARBALL, "nonsense")).toMatch(/integrity string this cannot read/);
    expect(integrityProblem(TARBALL, "sha9000-abc")).toMatch(/digest this cannot compute/);
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
