/**
 * The release set (D146): the approval order, stage readiness, and the registry check. Each mistake
 * here publishes a set that does not resolve, or says nothing while one does.
 */
import { describe, expect, it } from "vitest";
import { approvalOrder, installSets, setProblems, stageReadiness } from "./release-set.mjs";
import { publishedManifests } from "./workspace.mjs";

const pkg = (name, fields = {}) => ({ name, ...fields });

describe("approvalOrder", () => {
  it("puts a dependency before what depends on it", () => {
    const order = approvalOrder([
      pkg("core", { dependencies: { api: "workspace:*" } }),
      pkg("api"),
    ]);
    expect(order).toEqual(["api", "core"]);
  });

  it("puts a package with no declared edge to the set after every package that has one", () => {
    const order = approvalOrder([
      pkg("aaa-wrapper"),
      pkg("core", { dependencies: { api: "workspace:*" } }),
      pkg("api"),
    ]);
    expect(order).toEqual(["api", "core", "aaa-wrapper"]);
  });

  it("orders by what reaches a consumer, never by devDependencies", () => {
    const order = approvalOrder([
      pkg("scaffolder", { devDependencies: { api: "workspace:*" } }),
      pkg("api"),
      pkg("core", { peerDependencies: { api: "*" } }),
    ]);
    expect(order).toEqual(["api", "core", "scaffolder"]);
  });

  it("ignores a dependency outside the set", () => {
    expect(approvalOrder([pkg("api", { dependencies: { semver: "^7" } })])).toEqual(["api"]);
  });

  it("refuses a cycle rather than picking an order", () => {
    expect(() =>
      approvalOrder([
        pkg("a", { dependencies: { b: "*" } }),
        pkg("b", { dependencies: { a: "*" } }),
      ]),
    ).toThrow(/depend on each other/);
  });

  it("approves this workspace's engine before the wrapper and the scaffolder that install it", () => {
    const order = approvalOrder(publishedManifests());
    const at = (name) => order.indexOf(name);
    expect(at("@rigline/plugin-api")).toBeLessThan(at("@rigline/core"));
    expect(at("@rigline/core")).toBeLessThan(at("rigline"));
    expect(at("@rigline/core")).toBeLessThan(at("create-rigline-plugin"));
  });
});

describe("stageReadiness", () => {
  const stage = (packageName, status, version = "2.0.1") => ({
    id: `${packageName}-id`,
    packageName,
    version,
    status,
  });

  it("waits for a package with no stage yet", () => {
    const { rows, ready } = stageReadiness([stage("a", "ready")], ["a", "b"], "2.0.1");
    expect(ready).toBe(false);
    expect(rows[1]).toEqual({ name: "b", id: null, status: "not staged" });
  });

  it("waits while any stage is still validating", () => {
    const stages = [stage("a", "ready"), stage("b", "validating")];
    expect(stageReadiness(stages, ["a", "b"], "2.0.1").ready).toBe(false);
  });

  it("is ready when every stage is past validating, whatever npm calls that", () => {
    const stages = [stage("a", "ready"), stage("b", "something new")];
    const { rows, ready } = stageReadiness(stages, ["a", "b"], "2.0.1");
    expect(ready).toBe(true);
    expect(rows.map((row) => row.id)).toEqual(["a-id", "b-id"]);
  });

  it("ignores a stage at another version", () => {
    const stages = [stage("a", "ready", "2.0.0")];
    expect(stageReadiness(stages, ["a"], "2.0.1").ready).toBe(false);
  });
});

describe("setProblems", () => {
  const packument = (name, latest, versions, extraTags = {}) => ({
    name,
    "dist-tags": { latest, ...extraTags },
    versions: Object.fromEntries(Object.keys(versions).map((v) => [v, {}])),
    time: versions,
  });
  const day1 = "2026-10-20T00:00:00.000Z";
  const day2 = "2026-10-21T10:45:00.000Z";

  it("finds nothing wrong with a whole set", () => {
    const set = ["a", "b"].map((n) => packument(n, "2.0.1", { "2.0.0": day1, "2.0.1": day2 }));
    expect(setProblems(set)).toEqual([]);
  });

  it("names a version published without one of the set, and the latest that disagrees", () => {
    const problems = setProblems([
      packument("core", "2.0.1", { "2.0.0": day1, "2.0.1": day2 }),
      packument("api", "2.0.0", { "2.0.0": day1 }),
    ]);
    expect(problems).toEqual([
      "`latest` disagrees: core 2.0.1, api 2.0.0",
      "2.0.1 is published without api",
    ]);
  });

  it("catches a partial preview, which leaves latest alone", () => {
    const problems = setProblems([
      packument("core", "2.0.1", { "2.0.1": day1, "2.1.0-beta.0": day2 }, { next: "2.1.0-beta.0" }),
      packument("api", "2.0.1", { "2.0.1": day1 }),
    ]);
    expect(problems).toContain("2.1.0-beta.0 is published without api");
  });

  it("takes the newest by when it was published, not by semver", () => {
    // A maintenance release after a preview is the newest release, and the one that must be whole.
    const problems = setProblems([
      packument("core", "1.2.4", { "2.0.0-beta.0": day1, "1.2.4": day2 }, { next: "2.0.0-beta.0" }),
      packument("api", "1.2.3", { "2.0.0-beta.0": day1 }, { next: "2.0.0-beta.0" }),
    ]);
    expect(problems).toContain("1.2.4 is published without api");
  });
});

describe("installSets", () => {
  it("installs the whole set once per dist-tag, at that tag's versions", () => {
    const set = [
      { name: "core", "dist-tags": { latest: "2.0.1", next: "2.1.0-beta.0" } },
      { name: "api", "dist-tags": { latest: "2.0.1", next: "2.1.0-beta.0" } },
    ];
    expect(installSets(set)).toEqual([
      { tag: "latest", specs: ["core@2.0.1", "api@2.0.1"] },
      { tag: "next", specs: ["core@2.1.0-beta.0", "api@2.1.0-beta.0"] },
    ]);
  });
});
