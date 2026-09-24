/**
 * The scaffolding every harness test file shares: one browser for the file, a fresh payload and a
 * fresh page per test, and the diagnostics shape a test reads back out of the booted page.
 *
 * Extracted from `test/kernel.test.ts` when the first-party plugins arrived, so each plugin's DOM
 * tests are their own file rather than another block in a growing one. The boot itself is
 * per-test on purpose (docs/spikes/playwright-harness.md): a plugin deliberately made to fail
 * writes an expected `console.error`, and sharing a page would leak it into an unrelated test's
 * assertions.
 *
 * `register` calls vitest's own `beforeAll`/`afterAll`, so it must be called from inside a
 * `describe`. That is the one piece of test-framework knowledge in `src/`, and it is here rather
 * than copied into each test file because the alternative is every file launching its own browser.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Layout, SaveRecord } from "@rigline/plugin-api";
import { type Browser, type ConsoleMessage, chromium, type Page } from "playwright";
import { afterAll, beforeAll } from "vitest";
import { missing, versionDir } from "../../core/test/corpus.ts";
import { type FixturePlugin, preparePayload, type RemovedIdentifiers } from "./payload.ts";
import { type Harness, startHarness } from "./server.ts";

export type { FixturePlugin, RemovedIdentifiers } from "./payload.ts";

export interface PluginStatus {
  readonly name: string;
  readonly status: "loaded" | "refused" | "error" | "inactive";
  readonly reason?: string;
  readonly missingOptional?: readonly string[];
}

export interface RewriteRecord {
  readonly plugin: string;
  readonly type: string;
  readonly applied: number;
  readonly ran: number;
  readonly missed: number;
}

/** The fields of `__rigline.diagnostics` the harness tests read. See host/src/kernel/bridge.ts. */
export interface HarnessDiagnostics {
  readonly acquireWrapped: boolean;
  readonly acquireCalled: boolean;
  readonly outboundCount: number;
  readonly inboundCount: number;
  readonly bufferSealed: boolean;
  readonly identifiersFor: string | null;
  readonly errors: readonly string[];
  readonly react: {
    readonly hook: string;
    readonly version: string | null;
    readonly foreign: number;
  };
  readonly plugins: readonly PluginStatus[];
  readonly rewrites: readonly RewriteRecord[];
  readonly transcript: {
    readonly entries: number;
    readonly timed: number;
    readonly sweeps: number;
    readonly rebuilds: number;
  };
  readonly mounts: {
    readonly driver: "commit" | "observer";
    readonly active: number;
    readonly replaced: number;
    readonly moved: number;
    readonly lost: number;
    readonly multiple: Readonly<Record<string, number>>;
    readonly abandoned: readonly string[];
  };
  readonly meters: Record<
    string,
    { readonly peak: number; readonly peakAt: number | null; readonly recent: number }
  >;
  readonly storage: {
    readonly available: boolean;
    readonly writes: number;
    readonly failures: number;
    readonly bytes: number;
  };
}

/** One message as the fake host recorded it arriving: the envelope, with the inner request. */
export interface OutboundEnvelope {
  readonly type: string;
  readonly request?: { readonly type: string; readonly title?: unknown };
}

export interface Booted {
  readonly page: Page;
  /** What the page loads Rigline from, so a test can rewrite a file under it mid-run. */
  readonly payloadDir: string;
  /** Everything the page logged at error level, plus any uncaught page error. */
  readonly consoleErrors: readonly string[];
  readonly bootMs: number;
  /**
   * How long after the app's own first render the kernel finished loading plugins. The window a
   * test racing the payload falls into, printed rather than assumed: it is small on an idle
   * machine and widens under a full suite, which is why the race only ever showed up there.
   */
  readonly kernelMs: number;
  diagnostics(): Promise<HarnessDiagnostics>;
  /** Every message the app sent the fake host, in order. */
  sent(): Promise<readonly OutboundEnvelope[]>;
  close(): Promise<void>;
}

export interface BootOptions {
  readonly plugins?: readonly FixturePlugin[];
  readonly surface?: "editor" | "sidebar" | "sessionList";
  /** Identifiers to delete from the tables the loader reads, to stand up an extension update. */
  readonly remove?: RemovedIdentifiers;
  readonly layout?: Layout;
  readonly save?: SaveRecord | null;
}

interface HarnessWindow {
  readonly __rigline?: { readonly diagnostics: HarnessDiagnostics };
  readonly __harness?: { readonly sent: readonly OutboundEnvelope[] };
}

/** Try launching Chromium once; the failure reason, or null when it launched fine. */
async function chromiumLaunchFailure(): Promise<string | null> {
  try {
    const probe = await chromium.launch();
    await probe.close();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * The corpus version every harness file drives. One constant rather than the same literal in each,
 * because `test/page.test.ts` checks the committed `generated.ts` against this and the check is
 * only exact while they are the same extension. Moving it is maintenance, not a decision: the
 * corpus keeps every version, so an old pin costs reproducibility nothing and buys testing a bundle
 * nobody runs.
 */
export const HARNESS_VERSION = "2.1.280";

/**
 * Why this file's tests cannot run, or null. Read at module scope so a `describe.skipIf` can use
 * it: a fresh clone without the corpus or without a launchable Chromium is not a failure, and a
 * skip with a reason says which of the two it is.
 */
export async function harnessSkipReason(version: string): Promise<string | null> {
  const corpus = missing(version);
  if (corpus) return corpus;
  return await chromiumLaunchFailure();
}

/** One browser for the file, and a `boot` that gives each test its own payload, server and page. */
export function register(version: string): (options?: BootOptions) => Promise<Booted> {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  return async function boot(options: BootOptions = {}): Promise<Booted> {
    const dir = mkdtempSync(join(tmpdir(), "rigline-harness-"));
    preparePayload(dir, {
      version,
      plugins: options.plugins ?? [],
      remove: options.remove,
      layout: options.layout,
      save: options.save,
    });
    const harness: Harness = await startHarness({
      bundleDir: join(versionDir(version), "webview"),
      payloadDir: dir,
      surface: options.surface ?? "editor",
    });
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    const started = performance.now();
    await page.goto(harness.url);
    // The model pill is the app's own markup, so waiting for it is waiting for a real render
    // rather than for anything Rigline placed. The session list has no composer, so it waits on
    // its own root instead.
    await page.waitForSelector(
      options.surface === "sessionList" ? "#root > *" : ".modelPill_gGYT1w",
      { timeout: 15000 },
    );
    const bootMs = performance.now() - started;
    // And then for the kernel, which is a separate event: the pre hook is static but post.js loads
    // dynamically, so the app's own markup can be on screen before a single plugin's setup() has
    // run. A test that waits on a node its plugin placed gets this for free; one that reads what
    // setup() installed on `window`, or pushes a message expecting a tap to be listening, does not
    // — and it fails only when the machine is loaded enough to widen the window, which is the whole
    // suite and never the test on its own. `bufferSealed` is the signal because post.js sets it in
    // the `finally` of the plugin-loading loop, so it means "every plugin has had its chance",
    // including the ones that were refused.
    await page.waitForFunction(
      () => (window as unknown as HarnessWindow).__rigline?.diagnostics?.bufferSealed === true,
      undefined,
      { timeout: 15000 },
    );
    const kernelMs = performance.now() - started - bootMs;

    return {
      page,
      payloadDir: dir,
      consoleErrors,
      bootMs,
      kernelMs,
      diagnostics: () =>
        page.evaluate(
          () => (window as unknown as HarnessWindow).__rigline?.diagnostics as HarnessDiagnostics,
        ),
      sent: () => page.evaluate(() => (window as unknown as HarnessWindow).__harness?.sent ?? []),
      async close() {
        await page.close();
        await harness.close();
      },
    };
  };
}
