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

/** A webview bundle body, and the stylesheet that matches it, produced by `harvestableWebview`. */
export interface HarvestableWebview {
  /** The bundle text: enough class-map pairs, protocol sites and react anchors to clear every layer's floor. */
  readonly js: string;
  /** Every class the bundle's map defines, and nothing else — no module is partially reachable. */
  readonly css: string;
}

const MODULE_COUNT = 32;
const LOCALS_PER_MODULE = 10;
const REQUEST_COUNT = 70;
const NOTIFICATION_COUNT = 8;
const PUSH_COUNT = 8;
const HOST_REQUEST_COUNT = 12;

/**
 * A synthetic webview bundle that clears every identifier layer's floor, for tests that install
 * against a fixture extension rather than asserting on one harvest layer in isolation.
 *
 * `${MODULE_COUNT} * ${LOCALS_PER_MODULE}` class-map pairs clear the classes layer's 30-module,
 * 300-class floor; ${REQUEST_COUNT} `sendRequest` sites (each carrying one payload field,
 * `field_0`) and ${NOTIFICATION_COUNT} `send` sites clear the protocol layer's outbound floors; an
 * inbound-push `for await` switch and a `processRequestInner` switch carry ${PUSH_COUNT} and
 * ${HOST_REQUEST_COUNT} cases; `REACT_BODY` carries the react anchors. The stylesheet lists exactly
 * the classes the map defines, so no module reads as partially harvested.
 */
export function harvestableWebview(): HarvestableWebview {
  const modules: string[] = [];
  const cssRules: string[] = [];
  for (let m = 0; m < MODULE_COUNT; m++) {
    const hash = `f${m.toString().padStart(5, "0")}`;
    const entries: string[] = [];
    for (let l = 0; l < LOCALS_PER_MODULE; l++) {
      const local = `local${l}`;
      const value = `${local}_${hash}`;
      entries.push(`${local}:"${value}"`);
      cssRules.push(`.${value}{}`);
    }
    modules.push(`{${entries.join(",")}}`);
  }

  const requests = Array.from(
    { length: REQUEST_COUNT },
    (_, i) => `sendRequest({type:"req_${i}",field_0:1})`,
  );
  const notifications = Array.from(
    { length: NOTIFICATION_COUNT },
    (_, i) => `this.send({type:"note_${i}"})`,
  );
  const pushCases = Array.from({ length: PUSH_COUNT }, (_, i) => `case"push_${i}":break;`).join("");
  const hostCases = Array.from(
    { length: HOST_REQUEST_COUNT },
    (_, i) => `case"host_${i}":break;`,
  ).join("");

  const js = [
    modules.join(";"),
    requests.join(";"),
    notifications.join(";"),
    `for await(x of this.fromHost)switch(x.type){${pushCases}}`,
    `function processRequestInner(e,t){switch(e.request.type){${hostCases}}}`,
    REACT_BODY,
  ].join(";\n");

  return { js, css: cssRules.join("") };
}

/** The `req_N_response` reply literals a host bundle needs to pair with `harvestableWebview`'s requests. */
export function harvestableHostReplies(): string {
  return Array.from({ length: REQUEST_COUNT }, (_, i) => `{type:"req_${i}_response"}`).join(";");
}
