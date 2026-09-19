import { describe, expect, it } from "vitest";
import { samePath, worktreeFromTool, worktreeLabel } from "./index.ts";

describe("worktreeLabel", () => {
  it("keeps the whole ticket key a name starts with, however long", () => {
    expect(worktreeLabel("TD-1234-close-the-write-leak")).toBe("TD-1234");
    expect(worktreeLabel("TD-1234")).toBe("TD-1234");
    expect(worktreeLabel("ABC-99999-long-tail")).toBe("ABC-99999");
    // Wider than eight characters: a ticket key is never truncated, which is the whole point of
    // recognising one.
    expect(worktreeLabel("PROJECT-123456")).toBe("PROJECT-123456");
    expect(worktreeLabel("PROJECT-123456-with-a-tail")).toBe("PROJECT-123456");
  });

  it("recognises the key shapes the common trackers actually issue", () => {
    expect(worktreeLabel("ENG-12-linear-style")).toBe("ENG-12");
    expect(worktreeLabel("sc-1234-shortcut-style")).toBe("sc-1234");
    // Jira's own project keys run to ten characters and its issue numbers past five digits.
    expect(worktreeLabel("PLATFORM99-100001-x")).toBe("PLATFORM99-100001");
  });

  it("preserves case rather than normalising it", () => {
    expect(worktreeLabel("td-1234-lower")).toBe("td-1234");
  });

  it("refuses a key that only looks like one", () => {
    // A digit-led name is a date or a version, not a ticket. This is the case that makes the
    // widened key length safe: an alphanumeric-first pattern of the same width takes "2026-09".
    expect(worktreeLabel("2026-09-14-spike")).toBe("2026-09");
    // Alphanumerics running on past the digits: TD-1234x is its own thing, not TD-1234. It is not
    // a key, so it takes the ordinary boundary cut, which is terse here and never a wrong number.
    expect(worktreeLabel("TD-1234x-tail")).toBe("TD");
    expect(worktreeLabel("TD-1234x")).toBe("TD-1234x");
    // A key found in the middle is not this worktree's key.
    expect(worktreeLabel("revert-ABC-123")).toBe("revert");
  });

  it("cuts a long name at a word boundary rather than mid-token", () => {
    expect(worktreeLabel("spike-new-parser")).toBe("spike");
    expect(worktreeLabel("atlas-wt-extra")).toBe("atlas");
    expect(worktreeLabel("some_snake_case_name")).toBe("some");
  });

  it("never invents a ticket number by truncating one", () => {
    // The bug this replaced: slice(0, 8) turned ABCD-1234 into ABCD-123, which is not a shortened
    // name but a different, perfectly plausible ticket — printed onto a real VS Code tab with
    // nothing to tell a reader it is wrong (P8: absent beats wrong).
    expect(worktreeLabel("ABCD-1234")).toBe("ABCD-1234");
    expect(worktreeLabel("AB-12345678-tail")).toBe("AB");

    // The invariant behind those two, over every shape this has to survive: whatever comes back is
    // either the key the name genuinely starts with, or something nobody can read as a key.
    const ticketish = /^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,6}$/;
    const names = [
      "ABCD-1234",
      "AB-12345678",
      "AB-12-xyz-longer",
      "TD-123456789-x",
      "ZZ-9",
      "2026-09-14-spike",
      "revert-ABC-123",
      "spike-new-parser",
      "verylongsinglewordname",
      "a-b-c-d-e-f-g-h",
      "",
    ];
    for (const name of names) {
      const label = worktreeLabel(name);
      if (!ticketish.test(label)) continue;
      expect(name.startsWith(label), `${name} -> ${label}`).toBe(true);
      // And it is the key the name starts with, not a prefix of a longer one.
      expect(ticketish.test(label) && !/^[A-Za-z0-9]/.test(name.slice(label.length))).toBe(true);
    }
  });

  it("leaves a short name alone", () => {
    expect(worktreeLabel("wt")).toBe("wt");
    expect(worktreeLabel("")).toBe("");
    expect(worktreeLabel("a-1")).toBe("a-1");
  });
});

describe("worktreeFromTool", () => {
  it("returns an EnterWorktree call's name input verbatim", () => {
    expect(worktreeFromTool({ id: "t1", name: "EnterWorktree", input: { name: "TD-9-y" } })).toBe(
      "TD-9-y",
    );
  });

  it("returns the last path segment of an EnterWorktree call's path input", () => {
    expect(
      worktreeFromTool({
        id: "t1",
        name: "EnterWorktree",
        input: { path: "C:\\repo\\.claude\\worktrees\\TD-9-y" },
      }),
    ).toBe("TD-9-y");
    // A worktree made outside .claude/worktrees/ is exactly the case the {path} form exists for,
    // and a trailing separator must not leave an empty final segment.
    expect(
      worktreeFromTool({
        id: "t1",
        name: "EnterWorktree",
        input: { path: "/home/me/elsewhere/spike/" },
      }),
    ).toBe("spike");
  });

  it("returns null for ExitWorktree, a positive 'left' answer rather than an absence", () => {
    expect(worktreeFromTool({ id: "t1", name: "ExitWorktree", input: {} })).toBeNull();
  });

  it("returns undefined for any tool call that says nothing about a worktree", () => {
    expect(worktreeFromTool({ id: "t1", name: "Bash", input: { command: "ls" } })).toBeUndefined();
    // Tool names are matched, never checked: a differently-cased name matches nothing.
    expect(
      worktreeFromTool({ id: "t1", name: "enterworktree", input: { name: "TD-9-y" } }),
    ).toBeUndefined();
  });

  it("returns undefined for an EnterWorktree call with no usable name or path", () => {
    expect(worktreeFromTool({ id: "t1", name: "EnterWorktree", input: {} })).toBeUndefined();
    expect(
      worktreeFromTool({ id: "t1", name: "EnterWorktree", input: { name: "" } }),
    ).toBeUndefined();
    expect(
      worktreeFromTool({ id: "t1", name: "EnterWorktree", input: { path: 12 } }),
    ).toBeUndefined();
  });
});

describe("samePath", () => {
  it("ignores drive-letter case", () => {
    // Observed live: one session's transcript recorded both c:\dev\ai\atlas and
    // C:\dev\ai\atlas for the same directory, since defaultCwd comes through realpathSync,
    // which preserves whatever case it was handed.
    expect(samePath("c:\\dev\\ai\\atlas", "C:\\dev\\ai\\atlas")).toBe(true);
  });

  it("ignores separator style and a trailing separator", () => {
    expect(samePath("C:\\dev\\ai\\atlas\\", "C:/dev/ai/atlas")).toBe(true);
    expect(samePath("/home/me/repo/", "/home/me/repo")).toBe(true);
  });

  it("still distinguishes genuinely different directories", () => {
    expect(samePath("C:\\dev\\ai\\atlas", "C:\\dev\\ai\\other")).toBe(false);
    // A worktree subdirectory of the same root is not the root.
    expect(samePath("C:\\dev\\ai\\atlas", "C:\\dev\\ai\\atlas\\.claude\\worktrees\\td-9")).toBe(
      false,
    );
  });
});
