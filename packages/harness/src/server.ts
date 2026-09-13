/**
 * A tiny static server standing in for the installed extension directory: the fixture page, the
 * bundle's own CSS untouched, the bundle wrapped in the two lines the injector adds, and the
 * payload directory the injector would otherwise write beside it. No dependency reads or writes
 * the live extension directory; `bundleDir` is always a corpus snapshot.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import type { Surface } from "@prototype/plugin-api";
import { fixturePage } from "./page.ts";

/** The exact two lines docs/host.md records the injector adding around the bundle's bytes. */
const PRE_LINE = 'import"./prototype/pre.js";/*PROTOTYPE-PRE*/\n';
const POST_LINE =
  '\n/*PROTOTYPE-POST*/import("./prototype/post.js").catch((e)=>console.error("[prototype] post-hook",e));\n';

/** The nonce baked into the fixture page's CSP and its script tags. Fixed: nothing here reads it back. */
const NONCE = "prototypeharness";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".map": "application/json",
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
}

export interface HarnessOptions {
  /** The corpus snapshot directory holding `webview/index.js` and `webview/index.css`. */
  readonly bundleDir: string;
  /** Where `preparePayload` wrote pre.js, post.js, generated.js, registry.js and plugins/. */
  readonly payloadDir: string;
  readonly surface: Surface;
  /** Fixed port, for a test that wants a stable URL. Ephemeral (0) by default. */
  readonly port?: number;
}

export interface Harness {
  readonly url: string;
  close(): Promise<void>;
}

async function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
): Promise<void> {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: HarnessOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  if (path === "/") {
    await send(res, 200, fixturePage({ surface: options.surface, nonce: NONCE }), "text/html");
    return;
  }
  if (path === "/index.css") {
    const body = await readFile(join(options.bundleDir, "index.css"));
    await send(res, 200, body, "text/css");
    return;
  }
  if (path === "/index.js") {
    const bundle = await readFile(join(options.bundleDir, "index.js"));
    const injected = Buffer.concat([Buffer.from(PRE_LINE), bundle, Buffer.from(POST_LINE)]);
    await send(res, 200, injected, "application/javascript");
    return;
  }
  if (path.startsWith("/prototype/")) {
    // Confined to payloadDir: a leading ".." in the normalized tail cannot climb out of it,
    // because a join with a "../" prefix still resolves under payloadDir's own parent check below.
    const rel = normalize(path.slice("/prototype/".length)).replace(/^([.][.][/\\])+/, "");
    const file = join(options.payloadDir, rel);
    if (!file.startsWith(options.payloadDir + sep) && file !== options.payloadDir) {
      await send(res, 403, "forbidden", "text/plain");
      return;
    }
    const body = await readFile(file);
    await send(res, 200, body, contentType(file));
    return;
  }
  await send(res, 404, `not found: ${path}`, "text/plain");
}

/** Start the harness server. Resolves once it is listening. */
export function startHarness(options: HarnessOptions): Promise<Harness> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      handle(req, res, options).catch((e) => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(`harness server error: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    server.on("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
