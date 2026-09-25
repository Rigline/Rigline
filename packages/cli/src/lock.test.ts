/**
 * One writer at a time under the home (D80).
 *
 * The clock, the liveness check and the sleep are all injected, so a contended lock is a few
 * microseconds here rather than a real wait. What is not faked is the filesystem: `wx` is the
 * primitive the whole thing rests on, and a test that stubbed it would be asserting its own mock.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HomeLockedError, isStale, type LockHolder, lockPath, withHomeLock } from "./lock.ts";

const made: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-lock-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function hold(home: string, holder: Partial<LockHolder> = {}): void {
  writeFileSync(
    lockPath(home),
    JSON.stringify({
      pid: 424242,
      since: new Date(0).toISOString(),
      what: "rigline update",
      ...holder,
    }),
  );
}

const never = () => false;
const always = () => true;
const nosleep = async () => {};

describe("withHomeLock", () => {
  it("runs the work and leaves no lock behind", async () => {
    const home = temp();
    const answer = await withHomeLock({ home, what: "test" }, async () => "done");
    expect(answer).toBe("done");
    expect(existsSync(lockPath(home))).toBe(false);
  });

  it("releases even when the work throws, so the next process does not wait a minute", async () => {
    const home = temp();
    await expect(
      withHomeLock({ home, what: "test" }, async () => {
        throw new Error("npm fell over");
      }),
    ).rejects.toThrow("npm fell over");
    expect(existsSync(lockPath(home))).toBe(false);
  });

  it("writes who holds it, for somebody deciding whether to delete the file", async () => {
    const home = temp();
    let written = "";
    await withHomeLock({ home, what: "companion: update" }, async () => {
      written = readFileSync(lockPath(home), "utf8");
    });
    const holder = JSON.parse(written);
    expect(holder).toMatchObject({ pid: process.pid, what: "companion: update" });
    expect(Date.parse(holder.since)).not.toBeNaN();
  });

  it("refuses to a live holder, and names it", async () => {
    const home = temp();
    hold(home, { since: new Date().toISOString() });
    await expect(
      withHomeLock(
        { home, what: "test", isAlive: always, waitMs: 0, sleep: nosleep },
        async () => "unreached",
      ),
    ).rejects.toThrow(/pid 424242/);
  });

  it("waits for a live holder and takes the lock when it goes", async () => {
    const home = temp();
    hold(home, { since: new Date().toISOString() });
    let polls = 0;
    const answer = await withHomeLock(
      {
        home,
        what: "test",
        isAlive: always,
        waitMs: 10_000,
        now: () => 1_000,
        sleep: async () => {
          // The holder finishes on the third look, which is the ordinary case rather than a race.
          if (++polls === 3) rmSync(lockPath(home), { force: true });
        },
      },
      async () => "taken",
    );
    expect(answer).toBe("taken");
    expect(polls).toBe(3);
  });

  it("takes a lock whose process is gone and whose age is past", async () => {
    const home = temp();
    hold(home);
    const answer = await withHomeLock(
      { home, what: "test", isAlive: never, sleep: nosleep },
      async () => "stolen",
    );
    expect(answer).toBe("stolen");
  });

  it("waits for an unreadable lock while it is young: a holder between its create and write", async () => {
    const home = temp();
    writeFileSync(lockPath(home), "");
    const failure = await withHomeLock(
      { home, what: "test", isAlive: never, waitMs: 0, sleep: nosleep },
      async () => "unreached",
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HomeLockedError);
    expect((failure as HomeLockedError).holder).toBeNull();
  });

  it("takes an unreadable lock once it is old", async () => {
    const home = temp();
    writeFileSync(lockPath(home), "half a wr");
    const longAgo = new Date(Date.now() - 120_000);
    utimesSync(lockPath(home), longAgo, longAgo);
    const answer = await withHomeLock(
      { home, what: "test", isAlive: always, sleep: nosleep },
      async () => "stolen",
    );
    expect(answer).toBe("stolen");
  });

  it("creates the home, because a first run locks before anything has made it", async () => {
    const home = join(temp(), "not", "there", "yet");
    await expect(withHomeLock({ home, what: "test" }, async () => "made")).resolves.toBe("made");
  });

  it("carries the holder on the error, so a caller can report rather than reparse", async () => {
    const home = temp();
    hold(home, { since: new Date().toISOString(), what: "rigline update" });
    const failure = await withHomeLock(
      { home, what: "test", isAlive: always, waitMs: 0, sleep: nosleep },
      async () => "unreached",
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HomeLockedError);
    expect((failure as HomeLockedError).holder).toMatchObject({ what: "rigline update" });
  });
});

describe("isStale", () => {
  const holder: LockHolder = { pid: 1, since: new Date(1_000).toISOString(), what: "x" };

  it("keeps a lock whose process is alive however old it is", () => {
    expect(isStale(holder, Number.NaN, 10_000_000, 60_000, always)).toBe(false);
  });

  it("keeps a young lock whose process has gone", () => {
    expect(isStale(holder, Number.NaN, 2_000, 60_000, never)).toBe(false);
  });

  it("takes an old lock whose process has gone", () => {
    expect(isStale(holder, Number.NaN, 61_001, 60_000, never)).toBe(true);
  });

  it("judges a lock with no readable holder by the file's own time", () => {
    expect(isStale(null, 1_000, 2_000, 60_000, always)).toBe(false);
    expect(isStale(null, 1_000, 61_000, 60_000, always)).toBe(true);
    expect(isStale(null, Number.NaN, 0, 60_000, always)).toBe(true);
  });

  it("treats an unparseable timestamp as old rather than as the epoch", () => {
    expect(isStale({ ...holder, since: "soon" }, Number.NaN, 0, 60_000, never)).toBe(true);
  });
});
