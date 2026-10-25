/**
 * The published packages as one set: the order a release approves them in, when its stages are ready
 * to approve, and whether what the registry holds is whole (D146). Pure, so tier 1 answers all of it.
 */

/** The manifest fields that reach a consumer. A devDependency never does, so it orders nothing. */
const EDGE_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/**
 * Names in the order to approve them: every package after the packages it declares, and a package
 * with no declared edge to the set after every package that has one, because it can only reach the
 * set at runtime, where its manifest cannot say so — the wrapper's engine (D69), the scaffold's pins.
 */
export function approvalOrder(manifests) {
  const names = new Set(manifests.map((m) => m.name));
  const needs = new Map(
    manifests.map((m) => [
      m.name,
      new Set(
        EDGE_FIELDS.flatMap((field) => Object.keys(m[field] ?? {})).filter(
          (dep) => names.has(dep) && dep !== m.name,
        ),
      ),
    ]),
  );
  const connected = new Set();
  for (const [name, deps] of needs) {
    if (deps.size === 0) continue;
    connected.add(name);
    for (const dep of deps) connected.add(dep);
  }
  const pending = [...names].sort(
    (a, b) => Number(!connected.has(a)) - Number(!connected.has(b)) || a.localeCompare(b),
  );
  const order = [];
  while (pending.length > 0) {
    const at = pending.findIndex((name) => [...needs.get(name)].every((d) => order.includes(d)));
    if (at === -1)
      throw new Error(`the published packages depend on each other: ${pending.join(", ")}`);
    order.push(...pending.splice(at, 1));
  }
  return order;
}

/**
 * Each package's stage at a version, and what to do about all of them: `ready` when every one reads
 * `staged`, `wait` while one is missing or `validating`, and `stuck` on any other status, which is
 * npm's verdict on a stage rather than a step on the way, so a person reads it before anything is
 * approved.
 */
export function stageReadiness(stages, names, version) {
  const rows = names.map((name) => {
    const stage = stages.find((s) => s?.packageName === name && s?.version === version);
    return stage === undefined
      ? { name, id: null, status: "not staged" }
      : { name, id: stage.id, status: String(stage.status ?? "no status") };
  });
  const pending = (row) => row.id === null || row.status === "validating";
  const verdict = rows.every((row) => row.status === "staged")
    ? "ready"
    : rows.some((row) => !pending(row) && row.status !== "staged")
      ? "stuck"
      : "wait";
  return { rows, verdict };
}

/**
 * What is wrong with the set as the registry holds it, from each package's packument: empty when
 * every dist-tag agrees across all of them, and the most recently published version is on all of
 * them. Recency is read from `time` rather than compared by semver, which is the order a release
 * actually happened in — a maintenance release after a preview is the newest, and is the one that
 * has to be whole.
 */
export function setProblems(packuments) {
  const problems = [];
  const tags = new Set(packuments.flatMap((p) => Object.keys(p["dist-tags"] ?? {})));
  for (const tag of tags) {
    const each = packuments.map((p) => `${p.name} ${p["dist-tags"]?.[tag] ?? "(none)"}`);
    if (new Set(packuments.map((p) => p["dist-tags"]?.[tag])).size > 1) {
      problems.push(`\`${tag}\` disagrees: ${each.join(", ")}`);
    }
  }
  const newest = newestVersion(packuments);
  if (newest !== null) {
    const without = packuments.filter((p) => !Object.hasOwn(p.versions ?? {}, newest));
    if (without.length > 0) {
      problems.push(`${newest} is published without ${without.map((p) => p.name).join(", ")}`);
    }
  }
  return problems;
}

/** The version published most recently across all the packuments, or null when none has any. */
function newestVersion(packuments) {
  let newest = null;
  let at = "";
  for (const p of packuments) {
    for (const version of Object.keys(p.versions ?? {})) {
      const when = p.time?.[version] ?? "";
      if (when > at) {
        newest = version;
        at = when;
      }
    }
  }
  return newest;
}

/** One install per dist-tag the set carries, each naming all of it at that tag's version. */
export function installSets(packuments) {
  const tags = [...new Set(packuments.flatMap((p) => Object.keys(p["dist-tags"] ?? {})))].sort();
  return tags.map((tag) => ({
    tag,
    specs: packuments.map((p) => `${p.name}@${p["dist-tags"]?.[tag] ?? tag}`),
  }));
}
