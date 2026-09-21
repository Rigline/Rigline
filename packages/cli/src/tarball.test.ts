/**
 * The tar reader, and mostly its refusals (D57).
 *
 * The reason to own this rather than depend on an extractor is that what we want is refusal, so
 * the refusals are the part worth testing: every one below is an archive npm would never produce
 * and a general extractor would faithfully reproduce.
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { packageTarball, tarball } from "../test/tar.ts";
import { readPackageTarball } from "./tarball.ts";

const LABEL = "clock@1.0.0";

const read = (bytes: Buffer) => readPackageTarball(bytes, LABEL);

describe("readPackageTarball", () => {
  it("strips the package prefix and keeps archive order", () => {
    const files = read(
      packageTarball({
        "rigline.json": '{"api":1}',
        "dist/index.js": "export default 1;",
        "README.md": "docs",
      }),
    );
    expect(files.map((f) => f.path)).toEqual(["rigline.json", "dist/index.js", "README.md"]);
    expect(files[1]?.bytes.toString("utf8")).toBe("export default 1;");
  });

  it("reads a body that is not a whole number of blocks, and one that is", () => {
    const exact = "x".repeat(512);
    const files = read(packageTarball({ a: "ab", b: exact, c: "z" }));
    expect(files.map((f) => f.bytes.toString("utf8"))).toEqual(["ab", exact, "z"]);
  });

  it("keeps a file whose bytes are not text", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
    const files = readPackageTarball(tarball([{ name: "package/logo.png", body: bytes }]), LABEL);
    expect(files[0]?.bytes.equals(bytes)).toBe(true);
  });

  it("skips directory entries and pax headers rather than treating them as files", () => {
    const files = readPackageTarball(
      tarball([
        { name: "package/", type: "5" },
        { name: "package/dist/", type: "5" },
        { name: "PaxHeader/package/dist/index.js", type: "x", body: "30 mtime=1700000000.0\n" },
        { name: "package/dist/index.js", body: "code" },
      ]),
      LABEL,
    );
    expect(files.map((f) => f.path)).toEqual(["dist/index.js"]);
  });

  it("refuses a symlink, which is the entry an extractor would faithfully create", () => {
    expect(() =>
      readPackageTarball(
        tarball([
          { name: "package/rigline.json", body: "{}" },
          { name: "package/link", type: "2", body: "" },
        ]),
        LABEL,
      ),
    ).toThrow(/is not a regular file/);
  });

  it("refuses a path that climbs out of the directory", () => {
    expect(() =>
      readPackageTarball(tarball([{ name: "package/../../evil.js", body: "x" }]), LABEL),
    ).toThrow(/does not stay inside the directory/);
  });

  it("refuses an absolute path, POSIX or Windows", () => {
    expect(() =>
      readPackageTarball(tarball([{ name: "package//etc/passwd", body: "x" }]), LABEL),
    ).toThrow(/does not stay inside the directory/);
    expect(() =>
      readPackageTarball(tarball([{ name: "package/C:/windows/x.dll", body: "x" }]), LABEL),
    ).toThrow(/does not stay inside the directory/);
  });

  it("strips whatever the one leading directory is called", () => {
    // `npm pack` writes `package/`, and most of the registry is its output. `@types/*` pack under
    // `node/`, and a reader that insisted on the first would refuse a package npm installs fine.
    const files = readPackageTarball(
      tarball([
        { name: "node/rigline.json", body: "{}" },
        { name: "node/dist/index.js", body: "code" },
      ]),
      LABEL,
    );
    expect(files.map((f) => f.path)).toEqual(["rigline.json", "dist/index.js"]);
  });

  it("refuses a tarball with two roots, whose shape nobody here understands", () => {
    expect(() =>
      readPackageTarball(
        tarball([
          { name: "package/rigline.json", body: "{}" },
          { name: "elsewhere/x.js", body: "x" },
        ]),
        LABEL,
      ),
    ).toThrow(/is outside "package\/"/);
  });

  it("refuses two members of one name, which answer differently to different readers", () => {
    expect(() =>
      read(
        tarball([
          { name: "package/a.js", body: "first" },
          { name: "package/a.js", body: "second" },
        ]),
      ),
    ).toThrow(/carries "a.js" twice/);
  });

  it("refuses an archive that ends inside an entry", () => {
    expect(() =>
      readPackageTarball(
        tarball([{ name: "package/a.js", body: "short", declaredSize: 4096 }]),
        LABEL,
      ),
    ).toThrow(/is truncated/);
  });

  it("refuses an entry over the size cap without allocating it", () => {
    expect(() =>
      readPackageTarball(
        tarball([{ name: "package/big.js", body: "x", declaredSize: 32 * 1024 * 1024 }]),
        LABEL,
      ),
    ).toThrow(/over the .* cap/);
  });

  it("refuses something that is not gzip, and something with no files in it", () => {
    expect(() => read(Buffer.from("not a tarball"))).toThrow(/is not a gzipped tarball/);
    expect(() => read(gzipSync(Buffer.alloc(1024)))).toThrow(/has no files in it/);
  });

  it("reads a name too long for the header field, from the ustar prefix", () => {
    const deep = `${"nested/".repeat(20)}index.js`;
    const files = read(packageTarball({ [deep]: "code" }));
    expect(files[0]?.path).toBe(deep);
  });
});
