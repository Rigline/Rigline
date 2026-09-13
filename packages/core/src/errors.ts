/**
 * The error type for conditions a person, not a plugin author, must fix: no extension installed,
 * a directory that is not an extension, a missing manifest. Thrown rather than exiting the
 * process directly, so the library stays importable and testable: a CLI wraps a call in `try`
 * and prints `message`, but a test drives the same function and asserts on the throw.
 */
export class UserError extends Error {
  override readonly name = "UserError";
}
