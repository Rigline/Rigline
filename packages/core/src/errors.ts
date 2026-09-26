/**
 * The error type for conditions a person, not a plugin author, must fix: no extension installed,
 * a directory that is not an extension, a missing manifest. Thrown rather than exiting the
 * process directly, so the library stays importable and testable: a CLI wraps a call in `try`
 * and prints `message`, but a test drives the same function and asserts on the throw.
 *
 * The wrapper keeps its own copy in `packages/cli/src/errors.ts` (D69).
 */
export class UserError extends Error {
  override readonly name = "UserError";
}

/**
 * An extension directory still being written, refused before anything is read (D81). Its own type
 * so the flow can refuse that one version and carry on with the rest (D104).
 */
export class UnfinishedExtensionError extends UserError {}

/** A `rigline.json` that does not hold up, keeping each problem so a one-line report can join them. */
export class ManifestError extends UserError {
  readonly label: string;
  readonly problems: readonly string[];

  constructor(label: string, problems: readonly string[]) {
    super(`${label} is not a valid manifest:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.label = label;
    this.problems = problems;
  }
}
