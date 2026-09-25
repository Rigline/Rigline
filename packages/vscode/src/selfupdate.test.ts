import { describe, expect, it } from "vitest";
import { stubEditor } from "../test/editor.ts";
import { parseStatus, SELF_UPDATE_KEY, selfUpdate } from "./selfupdate.ts";

const CARRIED = { version: "1.0.0-alpha.12", fingerprint: "f12", vsix: "/engine/rigline.vsix" };

/** `companion-status` answering this, with exit 0. */
function answering(status: unknown) {
  return async () => ({ code: 0, stdout: `${JSON.stringify(status)}\n` });
}

const stale = answering({ v: 1, current: false, carried: CARRIED });

describe("selfUpdate", () => {
  it("installs nothing when this companion is the one carried", async () => {
    const stub = stubEditor();
    const outcome = await selfUpdate({
      editor: stub.editor,
      version: "1.0.0-alpha.11",
      ask: answering({ v: 1, current: true, carried: CARRIED }),
      green: true,
    });
    expect(outcome).toBe("current");
    expect(stub.installs).toEqual([]);
  });

  it("installs the carried VSIX, records it, and never restarts anything", async () => {
    const stub = stubEditor();
    const outcome = await selfUpdate({
      editor: stub.editor,
      version: "1.0.0-alpha.11",
      ask: stale,
      green: true,
    });
    expect(outcome).toBe("installed");
    expect(stub.installs).toEqual([CARRIED.vsix]);
    expect(stub.memory.get(SELF_UPDATE_KEY)).toMatchObject({ fingerprint: "f12", installed: true });
    expect(stub.reloads).toEqual([]);
    expect(stub.lines.join("\n")).toContain("takes over when extensions next restart");
  });

  // The running companion's own directory stays old until extensions restart, so without the
  // record every run would install again, and so would every other window of the profile.
  it("installs a carried companion once, however many runs follow", async () => {
    const stub = stubEditor();
    const options = { editor: stub.editor, version: "1.0.0-alpha.11", ask: stale, green: true };
    await selfUpdate(options);
    expect(await selfUpdate(options)).toBe("pending");
    expect(stub.installs).toHaveLength(1);
  });

  it("leaves a companion alone at the same version, where VS Code would extract over it", async () => {
    const stub = stubEditor();
    const outcome = await selfUpdate({
      editor: stub.editor,
      version: CARRIED.version,
      ask: stale,
      green: true,
    });
    expect(outcome).toBe("skipped");
    expect(stub.installs).toEqual([]);
    expect(stub.lines.join("\n")).toContain("left alone");
  });

  it("says needs you once for a failure, only over green, and tries again each run", async () => {
    const stub = stubEditor({
      installExtension: async () => {
        throw new Error("blocked by policy");
      },
    });
    const run = (green: boolean) =>
      selfUpdate({ editor: stub.editor, version: "1.0.0-alpha.11", ask: stale, green });

    expect(await run(false)).toBe("failed");
    expect(stub.statuses).toEqual([]);
    expect(await run(true)).toBe("failed");
    expect(await run(true)).toBe("failed");
    expect(stub.statuses).toHaveLength(1);
    expect(stub.statuses[0]).toMatchObject({ health: "attention", text: "Rigline: needs you" });
    expect(stub.statuses[0]?.tooltip).toContain("Install from VSIX");
    expect(stub.statuses[0]?.tooltip).toContain(CARRIED.vsix);
  });

  it("only logs when the engine cannot answer, as one too old for the verb cannot", async () => {
    const stub = stubEditor();
    const outcome = await selfUpdate({
      editor: stub.editor,
      version: "1.0.0-alpha.11",
      ask: async () => ({ code: 1, stdout: "" }),
      green: true,
    });
    expect(outcome).toBe("skipped");
    expect(stub.statuses).toEqual([]);
    expect(stub.lines.join("\n")).toContain("did not check for a newer companion");
  });

  it("installs nothing from an engine built without a companion", async () => {
    const stub = stubEditor();
    const outcome = await selfUpdate({
      editor: stub.editor,
      version: "1.0.0-alpha.11",
      ask: answering({ v: 1, current: false, carried: null }),
      green: true,
    });
    expect(outcome).toBe("current");
    expect(stub.installs).toEqual([]);
  });
});

describe("parseStatus", () => {
  it("refuses a shape it does not know rather than guessing at it", () => {
    expect(parseStatus(JSON.stringify({ v: 2, current: false, carried: CARRIED }))).toHaveProperty(
      "problem",
    );
    expect(parseStatus("not json")).toHaveProperty("problem");
    expect(
      parseStatus(JSON.stringify({ v: 1, current: false, carried: { version: 1 } })),
    ).toHaveProperty("problem");
  });
});
