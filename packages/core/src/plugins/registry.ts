/**
 * Talking to an npm registry: resolve a version, fetch its tarball, check the bytes are the ones
 * the registry said (decisions.md, D47, D48, D49, D58).
 *
 * It resolves and it fetches, and that is all. No package manager runs, no dependency is resolved,
 * no lifecycle script exists to be declined, because a plugin is one bundled ES module and a
 * manifest with nothing left to install (D47). What this module is careful about is the two things
 * that are actually at stake: that the version taken is one the maintainer is recommending and has
 * been long enough to have been noticed (D48), and that the bytes unpacked are the bytes the
 * registry served.
 *
 * `fetchImpl` is injected because no test here touches the network. The default is the platform's
 * own `fetch`.
 */
import { createHash } from "node:crypto";
import { UserError } from "../errors.ts";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * D48's number, in minutes: a day, matching pnpm's `minimumReleaseAge` default and resting on the
 * same evidence. A compromised publish is generally caught inside it, and a day of latency costs a
 * plugin user nothing they can perceive, because the urgent repair — an anchor an extension update
 * retired — does not route through a publish at all (D44).
 */
export const MINIMUM_RELEASE_AGE_MINUTES = 1440;

/** Just enough of `fetch` for this module, so a test's stand-in is a few lines rather than a mock. */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<FetchResponse>;

export interface RegistryOptions {
  /** Defaults to `$npm_config_registry`, else the public registry: a mirror is somebody's real setup. */
  readonly registry?: string;
  readonly fetchImpl?: FetchLike;
  /** Minutes a published version must have reached. Defaults to D48's day. */
  readonly minimumReleaseAge?: number;
  /** `--now`: take a version that has not reached that age, having been told what it is. */
  readonly ignoreReleaseAge?: boolean;
  /** The present, for a test that needs a version to be a known age. */
  readonly clock?: () => number;
}

/** What `add <name>` was asked for, before a registry has been consulted (D58). */
export interface PluginSpec {
  readonly name: string;
  /** An exact version, when one was named. Never a range: there are none (D58). */
  readonly version: string | null;
  /** The dist-tag to follow, when one was named. Null with an exact version. */
  readonly tag: string | null;
}

export interface ResolvedVersion {
  readonly name: string;
  readonly version: string;
  /** The tag followed, or null when the version was named outright and is therefore pinned. */
  readonly tag: string | null;
  readonly tarball: string;
  /** Subresource-integrity string, as recorded in `config.json` and as re-checked on every fetch. */
  readonly integrity: string;
  /** How long ago it was published, in minutes, or null when the registry does not say. */
  readonly ageMinutes: number | null;
}

/**
 * `clock`, `@scope/clock`, `clock@1.2.0`, `clock@next`.
 *
 * A version is told from a tag by looking like one, which is the whole of the rule because there
 * are no ranges to disambiguate from (D58). Anything that is not `1.2.3`-shaped is a tag, and a tag
 * the registry has not got is a refusal naming the tags it has.
 */
export function parsePluginSpec(spec: string): PluginSpec {
  const at = spec.lastIndexOf("@");
  const scoped = spec.startsWith("@");
  if (at <= 0 || (scoped && at === 0)) {
    return { name: spec, version: null, tag: null };
  }
  const name = spec.slice(0, at);
  const rest = spec.slice(at + 1);
  if (rest.length === 0) return { name, version: null, tag: null };
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(rest)
    ? { name, version: rest, tag: null }
    : { name, version: null, tag: rest };
}

/** The version this spec names today, and where to get it. Consults the registry; writes nothing. */
export async function resolveVersion(
  spec: PluginSpec,
  options: RegistryOptions = {},
): Promise<ResolvedVersion> {
  const packument = await fetchPackument(spec.name, options);
  const tag = spec.version === null ? (spec.tag ?? "latest") : null;
  const version = spec.version ?? distTag(packument, spec.name, tag as string);

  const release = packument.versions?.[version];
  if (release === undefined) {
    throw new UserError(`${spec.name} has no version ${version} on ${registryOf(options)}`);
  }

  const published = packument.time?.[version];
  const ageMinutes =
    typeof published === "string" && !Number.isNaN(Date.parse(published))
      ? Math.floor(((options.clock?.() ?? Date.now()) - Date.parse(published)) / 60_000)
      : null;

  const tarball = release.dist?.tarball;
  if (typeof tarball !== "string" || tarball.length === 0) {
    throw new UserError(`${spec.name}@${version} has no tarball on ${registryOf(options)}`);
  }
  return {
    name: spec.name,
    version,
    tag,
    tarball,
    integrity: integrityOf(release, `${spec.name}@${version}`),
    ageMinutes,
  };
}

/**
 * The tarball's bytes, having checked them against `integrity`.
 *
 * The check says the bytes are the ones the registry served and nothing more (D49). It is hygiene,
 * not a judgement about the plugin: what a plugin may do is what its manifest declares, and
 * installing it is the act that says yes to that (D26).
 */
export async function fetchTarball(
  resolved: ResolvedVersion,
  options: RegistryOptions = {},
): Promise<Buffer> {
  const response = await request(resolved.tarball, options);
  const bytes = Buffer.from(await response.arrayBuffer());
  const problem = integrityProblem(bytes, resolved.integrity);
  if (problem !== null) {
    throw new UserError(
      `${resolved.name}@${resolved.version} from ${resolved.tarball} ${problem}. ` +
        "Nothing was written.",
    );
  }
  return bytes;
}

/** Why `bytes` are not what `integrity` describes, or null. Accepts any digest node supports. */
export function integrityProblem(bytes: Buffer, integrity: string): string | null {
  const dash = integrity.indexOf("-");
  if (dash <= 0) return `has an integrity string this cannot read ("${integrity}")`;
  const algorithm = integrity.slice(0, dash);
  const expected = integrity.slice(dash + 1);
  let actual: string;
  try {
    actual = createHash(algorithm).update(bytes).digest("base64");
  } catch {
    return `names a digest this cannot compute ("${algorithm}")`;
  }
  return actual === expected
    ? null
    : `does not match its recorded integrity (${algorithm}-${actual} against ${integrity})`;
}

/**
 * Why this version has not been published long enough to install, or null (D48).
 *
 * A verdict rather than a throw, because the two callers read it differently: `add` was asked for
 * this version outright and refuses, `update` reports it and leaves the plugin where it is, which is
 * what D48 means by a withheld version being named rather than hidden.
 *
 * A gate rather than a walk back to something older (D58): publish order is not tag order, so
 * taking the newest version old enough could install a patch to an old line that no tag points at,
 * which is a wrong answer arrived at quietly.
 */
export function releaseAgeProblem(
  resolved: ResolvedVersion,
  options: RegistryOptions = {},
): string | null {
  if (options.ignoreReleaseAge) return null;
  const minimum = options.minimumReleaseAge ?? MINIMUM_RELEASE_AGE_MINUTES;
  // A registry that does not date its releases cannot be gated on, and refusing everything it
  // serves would be a rule about our own ignorance rather than about the release.
  if (resolved.ageMinutes === null || resolved.ageMinutes >= minimum) return null;
  return (
    `${resolved.name}@${resolved.version} was published ${describeAge(resolved.ageMinutes)} ago, ` +
    `and rigline waits ${describeAge(minimum)} before installing a version. That window is where ` +
    "a compromised publish is usually caught, and it costs little here because the urgent repair " +
    "— an anchor an extension update retired — is a local edit rather than a release (D44). " +
    "Wait, or pass --now."
  );
}

/** "40 minutes", "6 hours", "2 days". A report a person reads should not make them divide. */
export function describeAge(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.floor(hours / 24)} days`;
}

/** The packument, as much of its shape as this module reads. Everything is optional; it is theirs. */
interface Packument {
  readonly "dist-tags"?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, Release>>;
  /** Publish instants by version, which is why the full packument is asked for: the abbreviated one omits it. */
  readonly time?: Readonly<Record<string, string>>;
}

interface Release {
  readonly dist?: {
    readonly tarball?: string;
    /** Subresource integrity, on anything published this decade. */
    readonly integrity?: string;
    /** Hex sha1, on anything older. Normalised to SRI before it is recorded. */
    readonly shasum?: string;
  };
}

function distTag(packument: Packument, name: string, tag: string): string {
  const version = packument["dist-tags"]?.[tag];
  if (typeof version === "string" && version.length > 0) return version;
  const tags = Object.keys(packument["dist-tags"] ?? {});
  throw new UserError(
    `${name} has no "${tag}" tag${tags.length > 0 ? `; it has ${tags.join(", ")}` : ""}`,
  );
}

/** The SRI to record and re-check against, converting a legacy hex sha1 into one (D49). */
function integrityOf(release: Release, label: string): string {
  const { integrity, shasum } = release.dist ?? {};
  if (typeof integrity === "string" && integrity.length > 0) return integrity;
  if (typeof shasum === "string" && /^[0-9a-f]{40}$/.test(shasum)) {
    return `sha1-${Buffer.from(shasum, "hex").toString("base64")}`;
  }
  throw new UserError(`${label} carries no integrity hash, so its bytes cannot be checked`);
}

function registryOf(options: RegistryOptions): string {
  return (options.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY).replace(
    /\/+$/,
    "",
  );
}

async function fetchPackument(name: string, options: RegistryOptions): Promise<Packument> {
  // A scoped name's slash is the one character in a package name that is also a path separator.
  const url = `${registryOf(options)}/${name.replace("/", "%2F")}`;
  const response = await request(url, options, { Accept: "application/json" });
  return (await response.json()) as Packument;
}

async function request(
  url: string,
  options: RegistryOptions,
  headers?: Record<string, string>,
): Promise<FetchResponse> {
  const impl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof impl !== "function") {
    throw new UserError("this Node has no fetch, so nothing can be installed from a registry");
  }
  let response: FetchResponse;
  try {
    response = await impl(url, headers ? { headers } : undefined);
  } catch (error) {
    throw new UserError(`could not reach ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new UserError(
      response.status === 404
        ? `${url} is not there (404). Check the name, and that it is published.`
        : `${url} answered ${response.status}`,
    );
  }
  return response;
}
