/**
 * The panel-session identifier layer.
 *
 * The model capabilities read and drive the panel's own session object, which the composer footer
 * is handed as its `session` prop: its model and effort signals, and the setters its own picker
 * calls (D120 as amended). The editor context holds its selection through the dismissal behind
 * Claude Code's own chip. Those are unmangled property names, which the host may anchor on only
 * because this layer asserts each against the bundle at harvest, as the React layer does react-dom's
 * (P1, D11). A missing member refuses the features it names and nothing else.
 *
 * Two members are read where present and not asserted: `drawnClaudeConfig`, which falls back to
 * `claudeConfig`, and `setUltracode`, whose absence refuses only a choice that names ultracode.
 */
import type { SessionFeature, SessionGap } from "@rigline/plugin-api/internal";
import { type Bundles, defineLayer } from "./types.ts";

/** What the panel-session layer resolves: what each feature resting on it needs and this lacks. */
export interface PanelSession {
  readonly missing: readonly SessionGap[];
}

interface RequiredMember {
  /** What a refusal names. */
  readonly needs: string;
  readonly present: (js: string) => boolean;
  /** What breaks, in plain terms, when it is absent. */
  readonly breaks: string;
  readonly refuses: readonly SessionFeature[];
}

const MODELS: readonly SessionFeature[] = ["models"];
const EDITOR: readonly SessionFeature[] = ["editorContext"];
const BOTH: readonly SessionFeature[] = ["models", "editorContext"];

/** A member named literally: unmangled, so the bundle spells it as the host does. */
function member(text: string, breaks: string, refuses: readonly SessionFeature[]): RequiredMember {
  return { needs: `"${text}"`, present: (js) => js.includes(text), breaks, refuses };
}

/** Destructured beside a prop only the composer footer takes, so no other `session` stands in. */
const FOOTER_SESSION = /session:[\w$]{1,8},[^{}()]{0,200}availablePermissionModes:/;

const REQUIRED: readonly RequiredMember[] = [
  {
    needs: 'footer prop "session"',
    present: (js) => FOOTER_SESSION.test(js),
    breaks: "the host could not find the panel's session from the composer footer",
    refuses: BOTH,
  },
  member("async setModel(", "no model could be applied", MODELS),
  member("async setEffortLevel(", "no effort could be applied", MODELS),
  member("async setThinkingLevel(", "no thinking level could be applied", MODELS),
  member("modelSelection=", "the live model could not be read", MODELS),
  member("effortLevel=", "the live effort could not be read", MODELS),
  member("claudeConfig=", "the list of models could not be read", MODELS),
  member(
    "prototype.subscribe=function",
    "the host could not follow the session as it changes",
    BOTH,
  ),
  member("dismissSelection(){", "the editor context could not be held back", EDITOR),
  member(
    "this.dismissedSelection=this.selection.value",
    "what was held back could not be read for Rigline's chip",
    EDITOR,
  ),
  member("applySelectionUpdate(", "a ticked editor context could not be put back", EDITOR),
  member(
    "this.lastSentSelection=",
    "a ticked editor context could not be told apart from one already sent",
    EDITOR,
  ),
];

/** Reads the panel-session surface out of the webview bundle, with one gap per member not there. */
export function harvestPanelSession(js: string): PanelSession {
  return {
    missing: REQUIRED.filter(({ present }) => !present(js)).map(({ needs, breaks, refuses }) => ({
      needs,
      breaks,
      refuses,
    })),
  };
}

export const panelSessionLayer = defineLayer({
  id: "panelSession",
  describe:
    "The panel's own session object the model capabilities read and drive and the editor context holds: the footer's session prop, its setters, its signals and its selection, asserted against the bundle rather than collected from it.",
  harvest: (bundles: Bundles) => harvestPanelSession(bundles.webview),
  // The asserted names are constant, so a diff of them would report only Rigline's own edits.
  views: {},
});
