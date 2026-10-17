/**
 * The panel-session identifier layer.
 *
 * The model capabilities read and drive the panel's own session object, which the composer footer
 * is handed as its `session` prop: its model and effort signals, and the setters its own picker
 * calls (D120 as amended). Those are unmangled property names, which the host may anchor on only
 * because this layer asserts each against the bundle at harvest, as the React layer does react-dom's
 * (P1, D11). One that is missing refuses `models` and `modelChoice` and nothing else.
 *
 * Two members are read where present and not asserted: `drawnClaudeConfig`, which falls back to
 * `claudeConfig`, and `setUltracode`, whose absence refuses only a choice that names ultracode.
 */
import type { ReactGap } from "@rigline/plugin-api/internal";
import { type Bundles, defineLayer } from "./types.ts";

/** What the panel-session layer resolves: what the model capabilities need and this version lacks. */
export interface PanelSession {
  readonly missing: readonly ReactGap[];
}

interface RequiredMember {
  /** What a refusal names. */
  readonly needs: string;
  readonly present: (js: string) => boolean;
  /** What breaks, in plain terms, when it is absent. */
  readonly breaks: string;
}

/** A member named literally: unmangled, so the bundle spells it as the host does. */
function member(text: string, breaks: string): RequiredMember {
  return { needs: `"${text}"`, present: (js) => js.includes(text), breaks };
}

/** Destructured beside a prop only the composer footer takes, so no other `session` stands in. */
const FOOTER_SESSION = /session:[\w$]{1,8},[^{}()]{0,200}availablePermissionModes:/;

const REQUIRED: readonly RequiredMember[] = [
  {
    needs: 'footer prop "session"',
    present: (js) => FOOTER_SESSION.test(js),
    breaks: "the host could not find the panel's session from the composer footer",
  },
  member("async setModel(", "no model could be applied"),
  member("async setEffortLevel(", "no effort could be applied"),
  member("async setThinkingLevel(", "no thinking level could be applied"),
  member("modelSelection=", "the live model could not be read"),
  member("effortLevel=", "the live effort could not be read"),
  member("claudeConfig=", "the list of models could not be read"),
  member("prototype.subscribe=function", "the host could not follow the session as it changes"),
];

/** Reads the panel-session surface out of the webview bundle, with one gap per member not there. */
export function harvestPanelSession(js: string): PanelSession {
  return {
    missing: REQUIRED.filter(({ present }) => !present(js)).map(({ needs, breaks }) => ({
      needs,
      breaks,
    })),
  };
}

export const panelSessionLayer = defineLayer({
  id: "panelSession",
  describe:
    "The panel's own session object the model capabilities read and drive: the footer's session prop, its setters and its signals, asserted against the bundle rather than collected from it.",
  harvest: (bundles: Bundles) => harvestPanelSession(bundles.webview),
  // The asserted names are constant, so a diff of them would report only Rigline's own edits.
  views: {},
});
