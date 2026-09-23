import { describe, expect, it } from "vitest";
import { store, storeFrom } from "./store.ts";

describe("store", () => {
  it("tells subscribers about a change, and not about the same value again", () => {
    const count = store(0);
    const seen: number[] = [];
    count.subscribe(() => seen.push(count.get()));

    count.set(1);
    count.set(1);
    count.set(2);

    expect(seen).toEqual([1, 2]);
  });

  it("stops telling a subscriber once it is removed, even from inside a notification", () => {
    const flag = store(false);
    let calls = 0;
    const off = flag.subscribe(() => {
      calls += 1;
      off();
    });

    flag.set(true);
    flag.set(false);

    expect(calls).toBe(1);
  });
});

describe("storeFrom", () => {
  it("subscribes at once, so a value handed over during the call is kept", () => {
    // The shape of ctx.onSessionId: it calls the handler at once with the current value.
    const subscribe = (handler: (id: string | null) => void) => {
      handler("abc");
      return () => {};
    };

    expect(storeFrom(subscribe, null).get()).toBe("abc");
  });

  it("follows later values, starting from the initial one", () => {
    let push: (value: number) => void = () => {};
    const subscribe = (handler: (value: number) => void) => {
      push = handler;
      return () => {};
    };

    const latest = storeFrom(subscribe, null);
    expect(latest.get()).toBeNull();
    push(7);
    expect(latest.get()).toBe(7);
  });
});
