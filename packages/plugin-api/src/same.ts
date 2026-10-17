/**
 * Deep equality over what YAML and JSON both carry, key order ignored: whether a settings value has
 * moved. Shared by the engine, which leaves an unchanged key untouched, and the panel, which learns
 * that a save landed when the file reads back as what it sent.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
