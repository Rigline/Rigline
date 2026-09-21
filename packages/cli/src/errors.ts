/**
 * The wrapper's own error type for a condition a person must fix.
 *
 * A copy of core's, and deliberately: `rigline` declares no dependency on any Rigline package (D69),
 * because a retrieval layer that depends on the thing it retrieves is one that cannot replace it.
 * This is the same price the prefix rule pays — two lines here against a dependency that would
 * undo the split — and the surface is small enough that the two cannot drift apart usefully.
 *
 * Thrown rather than exiting, so the wrapper stays testable: a test drives the same function and
 * asserts on the throw, where a process exit would take the test runner with it.
 */
export class UserError extends Error {
  override readonly name = "UserError";
}
