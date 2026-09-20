/**
 * The dist-tag derivation (D61). Pure functions over a registry state, so tier 1 answers all of it.
 *
 * Worth testing at all because both mistakes it can make are silent and expensive: staging a
 * maintenance release under `latest` is a downgrade for everybody, and letting `next` fall behind
 * strands whoever is following it on a version older than a bare install gives.
 */
import { describe, expect, it } from "vitest";
import { nextShouldMove, stageTag } from "./tags.mjs";

/** The registry as it is today: alphas only, both tags on the newest one. */
const alphaLine = { latest: "1.0.0-alpha.2", next: "1.0.0-alpha.2", hasStable: false };

/** A stable line with a preview running ahead of it, which is the case D61 was written for. */
const stableWithPreview = { latest: "1.2.3", next: "2.0.0-beta.1", hasStable: true };

describe("stageTag", () => {
  it("puts a new alpha on latest while no stable version exists", () => {
    // `latest` must point somewhere useful before there is a stable line, or `npm create
    // rigline-plugin` resolves an older scaffold than the one that fixed it.
    expect(stageTag("1.0.0-alpha.3", alphaLine)).toEqual({ tag: "latest" });
  });

  it("puts a preview on next once a stable line exists", () => {
    expect(stageTag("2.0.0-beta.2", stableWithPreview)).toEqual({ tag: "next" });
  });

  it("puts a maintenance release on latest without disturbing a preview ahead of it", () => {
    expect(stageTag("1.2.4", stableWithPreview)).toEqual({ tag: "latest" });
  });

  it("puts a finished major on latest, over the preview that led to it", () => {
    expect(stageTag("2.0.0", stableWithPreview)).toEqual({ tag: "latest" });
  });

  it("takes the first published version of an unpublished package to latest", () => {
    expect(stageTag("1.0.0-alpha.0", { latest: null, next: null, hasStable: false })).toEqual({
      tag: "latest",
    });
  });

  it("refuses a release on a superseded major rather than downgrading latest", () => {
    // 1.2.4 while 2.0.0 is the stable line: `latest` would be a downgrade for everybody and `next`
    // would strand the preview. The answer is a line tag, which this pipeline does not set.
    const superseded = { latest: "2.0.0", next: "2.1.0-beta.1", hasStable: true };
    const { tag, refusal } = stageTag("1.2.4", superseded);
    expect(tag).toBeUndefined();
    expect(refusal).toContain("1.x");
  });

  it("refuses a version already behind both tags", () => {
    expect(stageTag("1.0.0-alpha.1", alphaLine).refusal).toBeTypeOf("string");
  });
});

describe("nextShouldMove", () => {
  it("moves next up behind a release to latest", () => {
    expect(nextShouldMove("1.0.0-alpha.3", "1.0.0-alpha.2")).toBe(true);
  });

  it("does nothing when the release was staged to next itself", () => {
    expect(nextShouldMove("2.0.0-beta.2", "2.0.0-beta.2")).toBe(false);
  });

  it("leaves a preview alone that is ahead of a maintenance release", () => {
    expect(nextShouldMove("1.2.4", "2.0.0-beta.1")).toBe(false);
  });

  it("compares as semver, not as text", () => {
    // The release that would move the tag backwards is exactly the one nobody would check:
    // "1.0.0-alpha.10" < "1.0.0-alpha.2" as strings.
    expect(nextShouldMove("1.0.0-alpha.10", "1.0.0-alpha.2")).toBe(true);
    expect(nextShouldMove("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(false);
  });

  it("sets next on a package that has none", () => {
    expect(nextShouldMove("1.0.0-alpha.3", undefined)).toBe(true);
  });
});
