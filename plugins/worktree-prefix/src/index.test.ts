import { describe, expect, it } from "vitest";
import { samePath, worktreeFromTool, worktreeLabel } from "./index.ts";

describe("worktreeLabel", () => {
  it("keeps the ticket key a name starts with", () => {
    expect(worktreeLabel("TD-1234-close-the-write-leak")).toBe("TD-1234");
    expect(worktreeLabel("TD-1234")).toBe("TD-1234");
    expect(worktreeLabel("ABC-99999-long-tail")).toBe("ABC-99999");
    expect(worktreeLabel("A-1")).toBe("A-1");
  });

  it("preserves case rather than normalising it", () => {
    expect(worktreeLabel("td-1234-lower")).toBe("td-1234");
  });

  it("falls back to 8-character truncation for near-misses to the ticket shape", () => {
    // Six digits after the hyphen is not the ticket shape (max 5).
    expect(worktreeLabel("TD-123456-x")).toBe("TD-12345");
    // Four leading letters is one too many (max 3).
    expect(worktreeLabel("ABCD-1234")).toBe("ABCD-123");
    // A hyphen with no digits after it never matches at all.
    expect(worktreeLabel("prototype-wt")).toBe("prototype-w");
  });

  it("leaves short or empty names alone", () => {
    expect(worktreeLabel("wt")).toBe("wt");
    expect(worktreeLabel("")).toBe("");
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
    // Observed live: one session's transcript recorded both c:\dev\ai\prototype and
    // C:\dev\ai\prototype for the same directory, since defaultCwd comes through realpathSync,
    // which preserves whatever case it was handed.
    expect(samePath("c:\\dev\\ai\\prototype", "C:\\dev\\ai\\prototype")).toBe(true);
  });

  it("ignores separator style and a trailing separator", () => {
    expect(samePath("C:\\dev\\ai\\prototype\\", "C:/dev/ai/prototype")).toBe(true);
    expect(samePath("/home/me/repo/", "/home/me/repo")).toBe(true);
  });

  it("still distinguishes genuinely different directories", () => {
    expect(samePath("C:\\dev\\ai\\prototype", "C:\\dev\\ai\\other")).toBe(false);
    // A worktree subdirectory of the same root is not the root.
    expect(samePath("C:\\dev\\ai\\prototype", "C:\\dev\\ai\\prototype\\.claude\\worktrees\\td-9")).toBe(
      false,
    );
  });
});
