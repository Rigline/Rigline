/**
 * The dist-tag derivation (D61). Pure functions over a registry state, so tier 1 answers all of it.
 *
 * Worth testing at all because both mistakes it can make are silent and expensive: staging a
 * maintenance release under `latest` is a downgrade for everybody, and letting `next` fall behind
 * strands whoever is following it on a version older than a bare install gives.
 */
import { describe, expect, it } from "vitest";
import { nextShouldMove, stageTag } from "./tags.mjs";

/** The registry as it is today: alphas only, `latest` on the newest and `next` not maintained. */
const alphaLine = { latest: "1.0.0-alpha.2", next: null, hasStable: false };

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

  // With `next` unset on the alpha line, "above next" is vacuously true, so without the stable-line
  // guard a version that is merely not new would stage under `next` rather than being refused.
  it("still refuses a stale version once next is unset, rather than falling through to it", () => {
    expect(stageTag("1.0.0-alpha.1", alphaLine).tag).toBeUndefined();
    expect(stageTag("1.0.0-alpha.2", alphaLine).refusal).toBeTypeOf("string");
  });

  it("refuses a version already behind both tags", () => {
    expect(stageTag("1.0.0-alpha.1", alphaLine).refusal).toBeTypeOf("string");
  });

  it("does not suggest a line tag for a version that is simply already published", () => {
    // Which is every dry run: the tree's version is one the registry has. `1.x` here would name
    // the line `latest` is already on, so the suggestion would be to do something strange.
    expect(stageTag("1.0.0-alpha.2", alphaLine).refusal).not.toContain("1.x");
  });
});

describe("nextShouldMove", () => {
  // The alpha line, which is where every release has been so far. `latest` already names the newest
  // version of any kind, so a `next` beside it names the same one — and keeping them in step costs
  // an authenticated write per package, per release, for a pointer that says nothing.
  it("never moves next while no stable release exists", () => {
    expect(nextShouldMove("1.0.0-alpha.3", "1.0.0-alpha.2", false)).toBe(false);
    expect(nextShouldMove("1.0.0-alpha.3", undefined, false)).toBe(false);
    expect(nextShouldMove("1.0.0-alpha.3", null, false)).toBe(false);
  });

  it("moves next up behind a release to latest once a stable line exists", () => {
    expect(nextShouldMove("1.2.4", "1.2.3", true)).toBe(true);
  });

  // The one release with no version to publish under `next`: a promotion supersedes the preview the
  // tag is pointing at, so the tag has to be moved rather than published to.
  it("carries next forward onto the stable version that supersedes a preview", () => {
    expect(nextShouldMove("1.3.0", "1.3.0-beta.1", true)).toBe(true);
  });

  it("does nothing when the release was staged to next itself", () => {
    expect(nextShouldMove("2.0.0-beta.2", "2.0.0-beta.2", true)).toBe(false);
  });

  it("leaves a preview alone that is ahead of a maintenance release", () => {
    expect(nextShouldMove("1.2.4", "2.0.0-beta.1", true)).toBe(false);
  });

  it("compares as semver, not as text", () => {
    // The release that would move the tag backwards is exactly the one nobody would check:
    // "1.0.0-alpha.10" < "1.0.0-alpha.2" as strings.
    expect(nextShouldMove("2.0.0-alpha.10", "2.0.0-alpha.2", true)).toBe(true);
    expect(nextShouldMove("2.0.0-alpha.2", "2.0.0-alpha.10", true)).toBe(false);
  });

  it("sets next on a package that has none, once there is a line to preview", () => {
    expect(nextShouldMove("2.0.0-beta.1", undefined, true)).toBe(true);
  });
});
