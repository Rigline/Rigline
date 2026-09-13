/**
 * The React identifier layer.
 *
 * The transcript capability rests on react-dom's own devtools integration: react-dom looks for a
 * global `__REACT_DEVTOOLS_GLOBAL_HOOK__` when it initialises, and if the hook has `supportsFiber`
 * and a falsy `isDisabled` it calls `inject(internals)` and then `onCommitFiberRoot` after every
 * commit. `internals.findFiberByHostInstance` maps a row's element to its fiber, and a fiber's
 * `memoizedProps` carries the props the row was rendered with.
 *
 * None of that is a CSS class or a message type, so nothing else in the system can notice one of
 * them moving, and every one of them fails silently: a capability that quietly resolves no rows.
 * So this layer asserts them at harvest time (P1, D11) and fails the harvest outright when one is
 * missing, which stops the generated tables being written at all rather than shipping a transcript
 * capability that does nothing.
 */
import { type Bundles, defineLayer, HarvestError } from "./types.ts";

/**
 * Spelled literally here and, again, literally in the pre hook, which is statically imported and
 * so cannot read a generated table the way the post hook can. A test in `react.test.ts` holds the
 * two spellings to each other.
 */
export const DEVTOOLS_HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";

/** What the React layer resolves: the devtools hook name and the react-dom version installed. */
export interface ReactAnchors {
  readonly hook: string;
  readonly version: string;
}

interface RequiredAnchor {
  /** The literal, unminified name or property this bundle must contain. */
  readonly text: string;
  /** What breaks, in plain terms, when this literal is absent. */
  readonly breaks: string;
}

/**
 * Property names, never the minified hook variable: the bundle reads `!xP.isDisabled&&xP.supportsFiber`
 * where `xP` is this build's name for the hook and changes every build, while `isDisabled` and
 * `supportsFiber` are the contract every devtools build depends on and cannot rename.
 */
const REQUIRED: readonly RequiredAnchor[] = [
  {
    text: DEVTOOLS_HOOK,
    breaks:
      "the pre hook would install a hook react-dom never looks for, so no commit is ever seen",
  },
  {
    text: "supportsFiber",
    breaks: "react-dom would not accept the hook",
  },
  {
    text: "isDisabled",
    breaks: "react-dom would not accept the hook",
  },
  {
    text: "onCommitFiberRoot",
    breaks: "nothing would report a commit, so the entry list would never refresh",
  },
  {
    text: "findFiberByHostInstance",
    breaks: "the host could not get from a row element to its fiber",
  },
  {
    text: "memoizedProps",
    breaks: "the host could reach a fiber but not read which message it shows",
  },
];

/** The set of literal names the layer requires, for the stability diff's `anchors` view. */
const REQUIRED_NAMES: ReadonlySet<string> = new Set(REQUIRED.map((anchor) => anchor.text));

/**
 * The renderer descriptor react-dom registers itself with. Anchored on `rendererPackageName`,
 * never on `version:"..."` alone, because that string alone appears all over a bundle this size.
 */
const RENDERER = /rendererPackageName:"react-dom"/;

/**
 * The version, read beside the renderer descriptor rather than searched for on its own, for the
 * same reason: `version:"..."` alone is not a safe anchor in a bundle this large.
 */
const VERSION_NEAR_RENDERER =
  /version:"(\d+\.\d+\.\d+)"[^{}]{0,200}rendererPackageName:"react-dom"/;

/**
 * Reads the React anchors out of the webview bundle, or throws `HarvestError` naming the literal
 * that is missing and what it breaks. Never returns a partial result: a build that would leave the
 * transcript capability silently empty cannot produce generated tables at all (D11).
 */
export function harvestReact(js: string): ReactAnchors {
  for (const { text, breaks } of REQUIRED) {
    if (!js.includes(text)) {
      throw new HarvestError("react", `"${text}" is not in this bundle: ${breaks}.`);
    }
  }
  if (!RENDERER.test(js)) {
    throw new HarvestError(
      "react",
      "the renderer descriptor has moved: no 'rendererPackageName:\"react-dom\"' in this bundle.",
    );
  }
  const match = VERSION_NEAR_RENDERER.exec(js);
  const version = match?.[1];
  if (version === undefined) {
    throw new HarvestError(
      "react",
      "found the react-dom renderer descriptor but no version sits beside it.",
    );
  }
  return { hook: DEVTOOLS_HOOK, version };
}

export const reactLayer = defineLayer({
  id: "react",
  describe:
    "The react-dom devtools integration points the transcript capability rests on: the hook name, the fiber accessors and the renderer version, asserted against the bundle rather than collected from it.",
  harvest: (bundles: Bundles) => harvestReact(bundles.webview),
  views: {
    anchors: () => REQUIRED_NAMES,
  },
});
