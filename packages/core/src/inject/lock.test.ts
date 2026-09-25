/**
 * One engine injects at a time (D105).
 *
 * The clock, the liveness check and the sleep are injected, so a contended lock costs nothing here.
 * The filesystem is real, because `wx` is the primitive the lock rests on. The race between two
 * processes is in `flow.test.ts`, where the flow is what waits.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InjectionLockedError, isStale, type LockHolder, withInjectionLock } from "./lock.ts";

const made: string[] = [];

function lockIn(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigline-inject-lock-"));
  made.push(dir);
  return join(dir, "inject.lock");
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function hold(path: string, holder: Partial<LockHolder> = {}): void {
  writeFileSync(
    path,
    JSON.stringify({
      pid: 424242,
      since: new Date(0).toISOString(),
      what: "rigline install",
      ...holder,
    }),
  );
}

const never = () => false;
const always = () => true;
const nosleep = () => {};

/** A clock that moves only when the lock sleeps, so a wait is counted in polls. */
function clock(start = 1_000_000): { now: () => number; sleep: (ms: number) => void } {
  let t = start;
  return { now: () => t, sleep: (ms) => (t += ms) };
}

describe("withInjectionLock", () => {
  it("runs the work, writes who holds it, and leaves no lock behind", () => {
    const path = lockIn();
    let written = "";
    const answer = withInjectionLock({ path, what: "rigline install" }, () => {
      written = readFileSync(path, "utf8");
      return "done";
    });
    expect(answer).toBe("done");
    expect(JSON.parse(written)).toMatchObject({ pid: process.pid, what: "rigline install" });
    expect(Date.parse(JSON.parse(written).since)).not.toBeNaN();
    expect(existsSync(path)).toBe(false);
  });

  it("is exclusive while held", () => {
    const path = lockIn();
    const inner = withInjectionLock({ path, what: "rigline install" }, () => {
      try {
        withInjectionLock({ path, what: "rigline check", waitMs: 0 }, () => "unreached");
        return null;
      } catch (error) {
        return error;
      }
    });
    expect(inner).toBeInstanceOf(InjectionLockedError);
    expect((inner as InjectionLockedError).holder).toMatchObject({
      pid: process.pid,
      what: "rigline install",
    });
  });

  it("releases when the work throws, so the next engine does not wait for nobody", () => {
    const path = lockIn();
    expect(() =>
      withInjectionLock({ path }, () => {
        throw new Error("the harvest fell over");
      }),
    ).toThrow("the harvest fell over");
    expect(existsSync(path)).toBe(false);
  });

  it("takes a lock whose process is gone and whose age is past", () => {
    const path = lockIn();
    hold(path);
    const answer = withInjectionLock({ path, isAlive: never, sleep: nosleep }, () => "stolen");
    expect(answer).toBe("stolen");
  });

  it("waits out a young lock whose process is gone, then takes it inside the wait", () => {
    const path = lockIn();
    const { now, sleep } = clock();
    hold(path, { since: new Date(now()).toISOString() });
    let polls = 0;
    const answer = withInjectionLock(
      {
        path,
        isAlive: never,
        now,
        sleep: (ms) => {
          polls++;
          sleep(ms);
        },
      },
      () => "stolen",
    );
    expect(answer).toBe("stolen");
    // Fifteen seconds of hundred-millisecond polls: stale comes before the thirty-second wait ends.
    expect(polls).toBe(150);
  });

  it("waits for a live holder and takes the lock when it goes", () => {
    const path = lockIn();
    hold(path, { since: new Date().toISOString() });
    let polls = 0;
    const answer = withInjectionLock(
      {
        path,
        isAlive: always,
        sleep: () => {
          if (++polls === 3) rmSync(path, { force: true });
        },
      },
      () => "taken",
    );
    expect(answer).toBe("taken");
    expect(polls).toBe(3);
  });

  it("says once that it is waiting, and refuses a live holder at the deadline, naming it", () => {
    const path = lockIn();
    const { now, sleep } = clock();
    hold(path, { since: new Date(now()).toISOString() });
    const lines: string[] = [];
    let failure: unknown = null;
    try {
      withInjectionLock(
        { path, isAlive: always, now, sleep, onWait: (line) => lines.push(line) },
        () => "unreached",
      );
    } catch (error) {
      failure = error;
    }
    expect(lines).toEqual(["waiting for rigline install (pid 424242) to finish"]);
    expect(failure).toBeInstanceOf(InjectionLockedError);
    expect((failure as Error).message).toMatch(/^rigline install \(pid 424242\) has held /);
    expect(existsSync(path)).toBe(true);
  });

  it("waits for an unreadable lock while it is young: a holder between its create and write", () => {
    const path = lockIn();
    writeFileSync(path, "");
    let failure: unknown = null;
    try {
      withInjectionLock({ path, isAlive: never, waitMs: 0 }, () => "unreached");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(InjectionLockedError);
    expect((failure as InjectionLockedError).holder).toBeNull();
  });

  it("takes an unreadable lock once it is old", () => {
    const path = lockIn();
    writeFileSync(path, "half a wr");
    const minuteAgo = new Date(Date.now() - 60_000);
    utimesSync(path, minuteAgo, minuteAgo);
    const answer = withInjectionLock({ path, isAlive: always, waitMs: 0 }, () => "stolen");
    expect(answer).toBe("stolen");
  });

  it("creates the directory it lives in", () => {
    const path = join(lockIn(), "..", "not", "there", "inject.lock");
    expect(withInjectionLock({ path }, () => "made")).toBe("made");
  });
});

describe("isStale", () => {
  const holder: LockHolder = { pid: 1, since: new Date(1_000).toISOString(), what: "x" };

  it("keeps a lock whose process is alive however old it is", () => {
    expect(isStale(holder, Number.NaN, 10_000_000, 15_000, always)).toBe(false);
  });

  it("keeps a young lock whose process has gone", () => {
    expect(isStale(holder, Number.NaN, 2_000, 15_000, never)).toBe(false);
  });

  it("takes an old lock whose process has gone", () => {
    expect(isStale(holder, Number.NaN, 16_001, 15_000, never)).toBe(true);
  });

  it("judges an unreadable lock by the file's own time", () => {
    expect(isStale(null, 1_000, 2_000, 15_000, always)).toBe(false);
    expect(isStale(null, 1_000, 16_000, 15_000, always)).toBe(true);
    expect(isStale(null, Number.NaN, 0, 15_000, always)).toBe(true);
  });

  it("treats an unparseable timestamp as old rather than as the epoch", () => {
    expect(isStale({ ...holder, since: "soon" }, Number.NaN, 0, 15_000, never)).toBe(true);
  });
});
