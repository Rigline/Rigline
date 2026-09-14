/**
 * The log parsers, against fixture strings only.
 *
 * The fixtures below are transcriptions of real `main.log`, `renderer.log` and `exthost.log` output
 * from a machine that had actually lost a window: same indent characters, same trailing space after
 * a `<N>` marker, same two-line split of an uncaught exception. Nothing here reads the machine's own
 * log directory, for the reason D39 gives about the extension directory — a test that reads whatever
 * happens to be on disk passes and fails for reasons nobody can reproduce.
 */
import { describe, expect, it } from "vitest";
import {
  closingExit,
  errorSummary,
  hostStarts,
  parseEntries,
  parseMainLog,
  parseStamp,
} from "./logs.ts";

/**
 * Two episodes. The first is never recovered — the next thing in the file is another detect — and
 * the second "recovers" 1.6s before its extension host exits, which is a window being closed.
 * The `<N>` markers carry a trailing space, exactly as VS Code writes them.
 */
const MAIN_LOG = [
  "2026-09-14 08:59:18.884 [info] update#setState checking for updates",
  "2026-09-14 09:41:45.990 [error] CodeWindow: detected unresponsive",
  "2026-09-14 09:42:01.003 [error] [uncaught exception in main]: UnresponsiveSampleError: UnresponsiveSampleError: from window with ID 5 belonging to process with pid 35912",
  "2026-09-14 09:42:01.003 [error] ",
  "    at vscode-file://vscode-app/c:/Users/tester/AppData/Local/Programs/Code/out/vs/workbench/workbench.desktop.main.js:1141:10738",
  "2026-09-14 09:42:08.431 [error] CodeWindow: detected unresponsive",
  "2026-09-14 09:42:22.238 [error] CodeWindow unresponsive samples:",
  "<3> ",
  "    at vscode-file://vscode-app/c:/Users/tester/out/workbench.desktop.main.js:1141:10738",
  "<1> ",
  "    at Ct.onTimeout (vscode-file://vscode-app/c:/Users/tester/out/workbench.desktop.main.js:434:81648)",
  "Total Samples: 4",
  "For full overview of the unresponsive period, capture cpu profile via https://aka.ms/vscode-tracing-cpu-profile",
  "2026-09-14 09:42:22.241 [error] CodeWindow: recovered from unresponsive",
  "2026-09-14 09:42:23.738 [info] Extension host with pid 61184 exited with code: 0, signal: unknown.",
  "2026-09-14 09:59:18.886 [info] update#setState idle",
].join("\n");

describe("parseStamp", () => {
  it("reads a log timestamp as local time, and refuses anything else", () => {
    expect(parseStamp("2026-09-14 09:42:22.241")).toBe(
      new Date(2026, 8, 14, 9, 42, 22, 241).getTime(),
    );
    expect(parseStamp("not a timestamp")).toBeNull();
  });
});

describe("parseMainLog", () => {
  const parsed = parseMainLog(MAIN_LOG);

  it("pairs a recovery with the newest detect still open, leaving the older one open", () => {
    expect(parsed.episodes).toHaveLength(2);
    const [first, second] = parsed.episodes;
    expect(first?.detectedAt).toBe("2026-09-14 09:41:45.990");
    // Oldest-first pairing would close this one out and call the lockup 36s. Against a real log it
    // produced a two-and-a-half-hour episode from two detects that plainly belonged to different
    // windows, so the recovery goes to the detect it followed.
    expect(first?.recoveredAt).toBeNull();
    expect(first?.durationMs).toBeNull();
    expect(second?.recoveredAt).toBe("2026-09-14 09:42:22.241");
    expect(second?.durationMs).toBe(13810);
    expect(parsed.orphanRecoveries).toEqual([]);
  });

  it("flags a recovery that is really the window closing", () => {
    const [, second] = parsed.episodes;
    expect(second?.closedBy?.pid).toBe(61184);
    expect(second?.closedBy?.detail).toBe("code: 0, signal: unknown.");
    // Nothing followed the first detect, so nothing claims it recovered either.
    expect(parsed.episodes[0]?.closedBy).toBeNull();
  });

  it("keeps the sample block verbatim, trailing spaces and all", () => {
    // Attached to the newest open episode, which is the window VS Code had just sampled.
    const block = parsed.episodes[1]?.samples[0];
    expect(block?.at).toBe("2026-09-14 09:42:22.238");
    expect(block?.totalSamples).toBe(4);
    expect(block?.lines[0]).toBe("<3> ");
    expect(block?.lines[1]).toContain("workbench.desktop.main.js:1141:10738");
    expect(block?.lines).toContain("Total Samples: 4");
    expect(parsed.straySamples).toEqual([]);
  });

  it("takes an uncaught exception's frames from the empty error line that follows it", () => {
    const uncaught = parsed.episodes[0]?.uncaught[0];
    expect(uncaught?.windowId).toBe(5);
    expect(uncaught?.pid).toBe(35912);
    expect(uncaught?.message).toMatch(/^UnresponsiveSampleError/);
    expect(uncaught?.frames).toHaveLength(1);
    expect(uncaught?.frames[0]).toContain("workbench.desktop.main.js:1141:10738");
  });

  it("collects extension host exits with their pid and detail", () => {
    expect(parsed.exits).toEqual([
      {
        at: "2026-09-14 09:42:23.738",
        pid: 61184,
        detail: "code: 0, signal: unknown.",
      },
    ]);
  });

  it("records a recovery with nothing open rather than discarding it", () => {
    const log = parseMainLog(
      [
        "2026-09-14 09:42:22.241 [error] CodeWindow: recovered from unresponsive",
        "2026-09-14 09:43:00.000 [error] CodeWindow: detected unresponsive",
      ].join("\n"),
    );
    expect(log.orphanRecoveries).toEqual(["2026-09-14 09:42:22.241"]);
    expect(log.episodes).toHaveLength(1);
    expect(log.episodes[0]?.recoveredAt).toBeNull();
  });

  it("reads a repeated recovery line as the same event, not as another window", () => {
    // Taken at face value the second line would pair with the detect from two hours earlier and
    // lead the report with an episode that never happened.
    const log = parseMainLog(
      [
        "2026-09-14 10:00:00.000 [error] CodeWindow: detected unresponsive",
        "2026-09-14 12:13:08.954 [error] CodeWindow: detected unresponsive",
        "2026-09-14 12:13:11.451 [error] CodeWindow: recovered from unresponsive",
        "2026-09-14 12:13:11.452 [error] CodeWindow: recovered from unresponsive",
      ].join("\n"),
    );
    expect(log.duplicateRecoveries).toBe(1);
    expect(log.episodes[0]?.recoveredAt).toBeNull();
    expect(log.episodes[1]?.recoveredAt).toBe("2026-09-14 12:13:11.451");
    expect(log.orphanRecoveries).toEqual([]);
  });

  it("is empty, not broken, for a log with nothing in it", () => {
    expect(parseMainLog("")).toEqual({
      episodes: [],
      exits: [],
      orphanRecoveries: [],
      straySamples: [],
      duplicateRecoveries: 0,
    });
  });
});

describe("closingExit", () => {
  const exits = [
    { at: "2026-09-14 09:42:25.500", pid: 1, detail: "code: 0" },
    { at: "2026-09-14 09:42:19.000", pid: 2, detail: "code: 0" },
  ];

  it("takes an exit up to three seconds after the recovery", () => {
    // 2.1s was the widest real gap observed, so "a second or two" would have missed it.
    expect(closingExit("2026-09-14 09:42:23.400", exits)?.pid).toBe(1);
  });

  it("ignores an exit before the recovery, or too long after it", () => {
    expect(closingExit("2026-09-14 09:42:20.000", exits)).toBeNull();
    expect(closingExit("2026-09-14 09:42:21.000", exits)).toBeNull();
  });
});

const EXTHOST_LOG = [
  "2026-09-14 12:25:34.939 [info] Extension host with pid 45272 starting",
  "2026-09-14 12:25:34.939 [error] Error: Channel has been closed",
  "\tat i (file:///c:/Code/out/vs/workbench/api/node/extensionHostProcess.js:549:3935)",
  "\tat Object.stderr (c:\\Users\\tester\\.vscode\\extensions\\anthropic.claude-code-2.1.270\\extension.js:988:10457)",
  "",
  "2026-09-14 12:25:35.571 [error] Error: Channel has been closed",
  "\tat i (file:///c:/Code/out/vs/workbench/api/node/extensionHostProcess.js:549:3935)",
  "\tat Object.stderr (c:\\Users\\tester\\.vscode\\extensions\\anthropic.claude-code-2.1.270\\extension.js:988:10457)",
  "2026-09-14 12:25:36.000 [error] TypeError: Cannot read properties of undefined",
  "\tat Object.re [as deactivate] (c:\\Users\\tester\\.vscode\\extensions\\other-1.0.0\\extension.js:2:770294)",
].join("\n");

describe("parseEntries", () => {
  it("attaches untimestamped lines to the entry above them, indent kept", () => {
    const entries = parseEntries(EXTHOST_LOG);
    expect(entries).toHaveLength(4);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.detail).toEqual([]);
    expect(entries[1]?.detail).toHaveLength(2);
    expect(entries[1]?.detail[0]).toBe(
      "\tat i (file:///c:/Code/out/vs/workbench/api/node/extensionHostProcess.js:549:3935)",
    );
  });

  it("treats a continuation as any line without a timestamp, whatever its indent", () => {
    const entries = parseEntries(
      [
        "2026-09-14 12:18:35.369 [error] [Extension Host] DeprecationWarning: url.parse()",
        "(Use `Code --trace-deprecation ...` to show where the warning was created)",
        "2026-09-14 12:18:35.702 [info] done",
      ].join("\n"),
    );
    expect(entries[0]?.detail).toEqual([
      "(Use `Code --trace-deprecation ...` to show where the warning was created)",
    ]);
  });

  it("ignores a leading fragment with no entry to belong to", () => {
    expect(parseEntries("\tat somewhere (file.js:1:1)")).toEqual([]);
  });
});

describe("errorSummary", () => {
  it("collapses identical errors to one row with a count and a span", () => {
    const summary = errorSummary(parseEntries(EXTHOST_LOG));
    expect(summary.total).toBe(3);
    expect(summary.distinct).toBe(2);
    const [channel, typeError] = summary.groups;
    expect(channel?.count).toBe(2);
    expect(channel?.first).toBe("2026-09-14 12:25:34.939");
    expect(channel?.last).toBe("2026-09-14 12:25:35.571");
    expect(channel?.detail).toHaveLength(2);
    expect(typeError?.count).toBe(1);
  });

  it("keeps errors apart when they share a message but not a stack", () => {
    const summary = errorSummary(
      parseEntries(
        [
          "2026-09-14 12:00:00.000 [error] Canceled: Canceled",
          "\tat one (a.js:1:1)",
          "2026-09-14 12:00:01.000 [error] Canceled: Canceled",
          "\tat two (b.js:1:1)",
        ].join("\n"),
      ),
    );
    expect(summary.distinct).toBe(2);
  });

  it("keeps the most recent distinct errors when there are more than the cap", () => {
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) {
      lines.push(`2026-09-14 12:00:0${i}.000 [error] error number ${i}`);
    }
    const summary = errorSummary(parseEntries(lines.join("\n")), { maxGroups: 2 });
    expect(summary.total).toBe(5);
    expect(summary.distinct).toBe(5);
    // The two latest, still rendered in the order they first appeared.
    expect(summary.groups.map((g) => g.message)).toEqual(["error number 3", "error number 4"]);
  });

  it("truncates a very long stack and says how much it dropped", () => {
    const frames = Array.from({ length: 30 }, (_, i) => `\tat frame${i} (a.js:1:1)`);
    const summary = errorSummary(
      parseEntries(["2026-09-14 12:00:00.000 [error] Boom", ...frames].join("\n")),
      { maxDetail: 4 },
    );
    expect(summary.groups[0]?.detail).toHaveLength(4);
    expect(summary.groups[0]?.detailDropped).toBe(26);
  });

  it("ignores anything that is not an error", () => {
    const summary = errorSummary(parseEntries("2026-09-14 12:00:00.000 [info] all is well"));
    expect(summary).toEqual({ groups: [], total: 0, distinct: 0, older: 0 });
  });

  it("counts errors older than the window instead of reporting them", () => {
    const summary = errorSummary(parseEntries(EXTHOST_LOG), {
      fromMs: new Date(2026, 8, 14, 12, 25, 35).getTime(),
    });
    expect(summary.total).toBe(2);
    expect(summary.older).toBe(1);
    expect(summary.groups.map((g) => g.message)).toEqual([
      "Error: Channel has been closed",
      "TypeError: Cannot read properties of undefined",
    ]);
  });

  it("keeps an entry whose timestamp it cannot parse rather than filtering it away", () => {
    const summary = errorSummary([{ at: "not a time", level: "error", message: "x", detail: [] }], {
      fromMs: Date.now(),
    });
    expect(summary.total).toBe(1);
    expect(summary.older).toBe(0);
  });
});

describe("hostStarts", () => {
  it("finds the line that ties a pid in main.log to a window", () => {
    const entries = parseEntries(
      [
        "2026-09-14 12:25:35.888 [info] Started local extension host with pid 45272.",
        "2026-09-14 12:25:36.256 [info] something else",
      ].join("\n"),
    );
    expect(hostStarts(entries)).toEqual([{ at: "2026-09-14 12:25:35.888", pid: 45272 }]);
  });
});
