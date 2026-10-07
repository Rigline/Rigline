/**
 * The Diagnostics submenu (D119): every contributor's checks, from the run the pill's count came from,
 * and Copy report.
 */
import type { Store, Surface } from "@rigline/plugin-api/internal";
import { copyText, MenuItem, Submenu, useFlash, useStore } from "@rigline/plugin-api/ui";
import type { ReactNode } from "react";
import type { Diagnostics } from "../kernel/bridge.ts";
import type { CheckGroup } from "../kernel/checks.ts";
import { formatGroups, formatReport, reportFacts } from "./report.ts";

/** The submenu, bound to the shell's check run, for the shell to add as its own menu entry. */
export function diagnosticsMenu(
  groups: Store<readonly CheckGroup[]>,
  diagnostics: Diagnostics,
  surface: Surface,
): () => ReactNode {
  return function DiagnosticsMenu() {
    const run = useStore(groups);
    const [flash, showFlash] = useFlash();
    const failing = run.reduce((total, group) => total + group.failing, 0);
    return (
      <Submenu label="Diagnostics" description={failing > 0 ? `${failing} failing` : "all pass"}>
        <MenuItem
          label="Copy report"
          description="Versions, peaks, plugins and the previous run"
          flash={flash}
          onSelect={(event) => {
            event.preventDefault();
            const report = formatReport(reportFacts(diagnostics, surface, Date.now()), run);
            showFlash(copyText(report) ? "Copied" : "Copy failed");
          }}
        />
        <pre
          style={{
            margin: 0,
            padding: "4px 12px",
            font: "11px/1.45 var(--app-monospace-font-family, monospace)",
            whiteSpace: "pre-wrap",
            userSelect: "text",
          }}
        >
          {formatGroups(run)}
        </pre>
      </Submenu>
    );
  };
}
