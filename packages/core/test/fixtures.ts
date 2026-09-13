/**
 * Synthetic bundle fragments shared by more than one test file, so that a single edit covers
 * every fixture that needs to stay harvestable.
 */

/**
 * A minified-looking snippet reproducing react-dom's own devtools hook integration closely enough
 * for `harvestReact` (`../src/layers/react.ts`) to succeed against it: the hook check, the commit
 * callback, the renderer descriptor beside its version, and the fiber-props accessor.
 */
export const REACT_BODY =
  'if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"){if(h=__REACT_DEVTOOLS_GLOBAL_HOOK__,!h.isDisabled&&h.supportsFiber)try{i=h.inject(R)}catch(e){}}function c(r){if(h&&typeof h.onCommitFiberRoot==="function")h.onCommitFiberRoot(i,r)}var R={findFiberByHostInstance:f,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"};function p(n){return n.memoizedProps}';
