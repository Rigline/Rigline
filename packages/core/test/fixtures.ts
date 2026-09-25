/**
 * Synthetic bundle fragments shared by more than one test file, so that a single edit covers
 * every fixture that needs to stay harvestable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RUNTIME_MODULES } from "@rigline/plugin-api";

/**
 * A minified-looking snippet reproducing react-dom 18's own devtools hook integration closely
 * enough for `harvestReact` (`../src/layers/react.ts`) to succeed against it: the fiber key with its
 * per-load suffix, the hook check, the commit callback, the renderer descriptor beside its version,
 * and the fiber-props accessor.
 */
export const REACT_BODY =
  'var k=Math.random().toString(36).slice(2),K="__reactFiber$"+k;function f(n){return n[K]||null}if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"){if(h=__REACT_DEVTOOLS_GLOBAL_HOOK__,!h.isDisabled&&h.supportsFiber)try{i=h.inject(R)}catch(e){}}function c(r){if(h&&typeof h.onCommitFiberRoot==="function")h.onCommitFiberRoot(i,r)}var R={findFiberByHostInstance:f,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"};function p(n){return n.memoizedProps}';

/**
 * The same for react-dom 19, whose injected internals are copied from 19.3.0's own: no
 * `findFiberByHostInstance`, and a reconciler version beside the renderer's.
 */
export const REACT_19_BODY =
  'var k=Math.random().toString(36).slice(2),K="__reactFiber$"+k;var R={bundleType:0,version:"19.3.0",rendererPackageName:"react-dom",currentDispatcherRef:T,reconcilerVersion:"19.3.0"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"){var h=__REACT_DEVTOOLS_GLOBAL_HOOK__;if(!h.isDisabled&&h.supportsFiber)try{i=h.inject(R),s=h}catch{}}function c(r){if(s&&typeof s.onCommitFiberRoot=="function")try{s.onCommitFiberRoot(i,r,void 0,!1)}catch{}}function p(n){return n.memoizedProps}';

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
 *
 * Each module's map is bound to a variable and every class is applied through it, because that is
 * what the bundle does and because the site count is harvested from exactly those accesses: a
 * fixture of bare object literals would clear the class floor and fall through the reference floor.
 * `local0` of the first module is applied three times, so that the `reused` view and the ambiguity
 * check have something to be true about.
 */
export function harvestableWebview(): HarvestableWebview {
  const modules: string[] = [];
  const uses: string[] = [];
  const cssRules: string[] = [];
  for (let m = 0; m < MODULE_COUNT; m++) {
    const hash = `f${m.toString().padStart(5, "0")}`;
    const name = `mod${m}`;
    const entries: string[] = [];
    for (let l = 0; l < LOCALS_PER_MODULE; l++) {
      const local = `local${l}`;
      const value = `${local}_${hash}`;
      entries.push(`${local}:"${value}"`);
      uses.push(`${name}.${local}`);
      cssRules.push(`.${value}{}`);
    }
    modules.push(`var ${name}={${entries.join(",")}}`);
  }
  uses.push("mod0.local0", "mod0.local0");

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
    `var applied=[${uses.join(",")}]`,
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

/**
 * A disposable extension directory that clears every layer's floor, so an install can run against
 * it end to end. Never a copy of a real one, and never the live one (D39).
 *
 * The webview bundle carries CRLF line endings and Latin-1 bytes deliberately: byte-faithful I/O is
 * the property under test wherever this is injected into, and text-mode I/O would rewrite every
 * line ending on Windows and turn a 133-byte patch into a diff nobody could audit (D37).
 */
export function writeFixtureExtension(ext: string, version = "2.1.263"): string {
  const { js, css } = harvestableWebview();
  const bundle = `var a=1;\r\n${js}\r\n/*end*/\r\n`;

  mkdirSync(join(ext, "webview"), { recursive: true });
  writeFileSync(join(ext, "webview", "index.js"), Buffer.from(bundle, "latin1"));
  writeFileSync(join(ext, "webview", "index.css"), css);
  writeFileSync(
    join(ext, "extension.js"),
    `${harvestableHostReplies()};function listSessions(){return {dir:this.cwd,includeWorktrees:!1}}`,
  );
  writeFileSync(join(ext, "package.json"), JSON.stringify({ version }));
  return ext;
}

/** A payload directory as `install` requires one: the two hooks and the runtime modules. */
export function writePayload(
  dir: string,
  pre = "export default 1;\n",
  post = "export default 2;\n",
): string {
  writeFileSync(join(dir, "pre.js"), pre);
  writeFileSync(join(dir, "post.js"), post);
  for (const file of Object.values(RUNTIME_MODULES)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "export default {};\n");
  }
  return dir;
}
