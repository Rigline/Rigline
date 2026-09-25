import { describe, expect, it } from "vitest";
import { stubEditor } from "../test/editor.ts";
import { addToProfiles, PROFILES_KEY, parseAdditions } from "./profiles.ts";

/** `companion-profiles` answering this, with exit 0. */
function answering(answer: unknown) {
  return async () => ({ code: 0, stdout: `${JSON.stringify(answer)}\n` });
}

const ADDED = 'added the companion to profile "B", which has Claude Code';
const FAILED = `could not add the companion to profile "B": Profile 'B' not found.`;

describe("addToProfiles", () => {
  it("logs what the engine did, and changes no status when nothing failed", async () => {
    const stub = stubEditor();
    const outcome = await addToProfiles({
      editor: stub.editor,
      ask: answering({ v: 1, lines: [ADDED], failed: false }),
      green: true,
    });
    expect(outcome).toBe("done");
    expect(stub.lines).toEqual([ADDED]);
    expect(stub.statuses).toEqual([]);
  });

  it("says needs you once for a failure, only over green, and again for a different one", async () => {
    const stub = stubEditor();
    const run = (green: boolean, line = FAILED) =>
      addToProfiles({
        editor: stub.editor,
        ask: answering({ v: 1, lines: [line], failed: true }),
        green,
      });

    expect(await run(false)).toBe("failed");
    expect(stub.statuses).toEqual([]);
    await run(true);
    await run(true);
    expect(stub.statuses).toHaveLength(1);
    expect(stub.statuses[0]).toMatchObject({ health: "attention", text: "Rigline: needs you" });
    expect(stub.statuses[0]?.tooltip).toBe(FAILED);

    await run(true, `${FAILED} Again.`);
    expect(stub.statuses).toHaveLength(2);
  });

  it("forgets the failure once a look succeeds, so its return is told", async () => {
    const stub = stubEditor();
    const failing = { v: 1, lines: [FAILED], failed: true };
    await addToProfiles({ editor: stub.editor, ask: answering(failing), green: true });
    await addToProfiles({
      editor: stub.editor,
      ask: answering({ v: 1, lines: [], failed: false }),
      green: true,
    });
    expect(stub.memory.get(PROFILES_KEY)).toBeUndefined();
    await addToProfiles({ editor: stub.editor, ask: answering(failing), green: true });
    expect(stub.statuses).toHaveLength(2);
  });

  it("only logs an engine too old for the verb, which exits 1 with its usage on stderr", async () => {
    const stub = stubEditor();
    const outcome = await addToProfiles({
      editor: stub.editor,
      ask: async () => ({ code: 1, stdout: "" }),
      green: true,
    });
    expect(outcome).toBe("skipped");
    expect(stub.statuses).toEqual([]);
    expect(stub.lines.join("\n")).toContain("the engine exited 1");
  });
});

describe("parseAdditions", () => {
  it("refuses a shape it does not know rather than guessing", () => {
    expect(parseAdditions("usage: rigline")).toEqual({
      problem: "the engine's answer was not JSON",
    });
    expect(parseAdditions(JSON.stringify({ v: 2, lines: [], failed: false }))).toMatchObject({
      problem: expect.stringContaining("v 2"),
    });
    expect(parseAdditions(JSON.stringify({ v: 1, lines: "no" }))).toMatchObject({
      problem: expect.stringContaining("missing"),
    });
  });
});
