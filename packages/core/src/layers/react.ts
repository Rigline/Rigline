/**
 * The React identifier layer.
 *
 * The transcript capability rests on react-dom's own devtools integration: react-dom looks for a
 * global `__REACT_DEVTOOLS_GLOBAL_HOOK__` when it initialises, and if the hook has `supportsFiber`
 * and a falsy `isDisabled` it calls `inject(internals)` and then `onCommitFiberRoot` after every
 * commit. An element react-dom created carries its fiber under a `__reactFiber$` property, and a
 * fiber's `memoizedProps` carries the props the row was rendered with.
 *
 * None of that is a CSS class or a message type, so nothing else in the system can notice one of
 * them moving, and every one of them fails silently: a capability that quietly resolves no rows.
 * So this layer asserts them at harvest time (P1, D11). One that is missing refuses the transcript
 * capability by name and nothing else, since nothing else rests on it (D102).
 */
import type { ReactGap } from "@rigline/plugin-api";
import { type Bundles, defineLayer } from "./types.ts";

/**
 * Spelled literally here and, again, literally in the pre hook, which is statically imported and
 * so cannot read a generated table the way the post hook can. A test in `react.test.ts` holds the
 * two spellings to each other, and does the same for `FIBER_KEY`.
 */
export const DEVTOOLS_HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";

/** The prefix of the property an element carries its fiber under, before a per-load suffix (D103). */
export const FIBER_KEY = "__reactFiber$";

/** What the React layer resolves: the devtools hook name, the react-dom version, and what is missing. */
export interface ReactAnchors {
  readonly hook: string;
  readonly version: string | null;
  readonly missing: readonly ReactGap[];
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
    text: FIBER_KEY,
    breaks: "the host could not get from a row element to its fiber",
  },
  {
    text: "memoizedProps",
    breaks: "the host could reach a fiber but not read which message it shows",
  },
];

/**
 * The renderer descriptor react-dom registers itself with. Anchored on `rendererPackageName`,
 * never on `version:"..."` alone, because that string alone appears all over a bundle this size.
 */
const RENDERER = /rendererPackageName:["'`]react-dom["'`]/;

/**
 * The version, read beside the renderer descriptor rather than searched for on its own, for the
 * same reason: `version:"..."` alone is not a safe anchor in a bundle this large.
 */
const VERSION_NEAR_RENDERER =
  /version:["'`](\d+\.\d+\.\d+)["'`][^{}]{0,200}rendererPackageName:["'`]react-dom["'`]/;

/** What a descriptor this layer cannot read leaves unvouched for. */
const RESHAPED = "its devtools integration has changed shape, so nothing here can vouch for it";

/** Reads the React anchors out of the webview bundle, with one gap per thing that is not there. */
export function harvestReact(js: string): ReactAnchors {
  const missing: ReactGap[] = REQUIRED.filter(({ text }) => !js.includes(text)).map(
    ({ text, breaks }) => ({ needs: `"${text}"`, breaks }),
  );
  const version = VERSION_NEAR_RENDERER.exec(js)?.[1] ?? null;
  if (!RENDERER.test(js)) {
    missing.push({ needs: "renderer descriptor", breaks: RESHAPED });
  } else if (version === null) {
    missing.push({ needs: "version beside its renderer descriptor", breaks: RESHAPED });
  }
  return { hook: DEVTOOLS_HOOK, version, missing };
}

export const reactLayer = defineLayer({
  id: "react",
  describe:
    "The react-dom devtools integration points the transcript capability rests on: the hook name, the fiber accessors and the renderer version, asserted against the bundle rather than collected from it.",
  harvest: (bundles: Bundles) => harvestReact(bundles.webview),
  views: {
    // The version, not the asserted names: those are constant, so a diff of them reports only
    // Rigline's own edits, as the extension's (D103).
    renderer: (data) => new Set(data.version === null ? [] : [data.version]),
  },
});
