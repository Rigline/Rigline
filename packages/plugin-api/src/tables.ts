/**
 * The identifier tables for one extension version, as data.
 *
 * Harvested from the installed bundles by core and written in two forms: `generated.ts` in this
 * package, which carries the same data plus the literal-union types a plugin compiles against, and
 * `generated.js` beside the injected loader, which the post hook reads at runtime. The two are
 * rendered from one object so they cannot disagree about a version. A manifest's declarations are
 * checked against this shape in both places, by the same functions.
 */
export interface IdentifierTables {
  /** The extension version the tables were harvested from. */
  readonly version: string;
  /** Module hash -> local class name -> full hashed class. */
  readonly moduleClasses: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Every message type a plugin may tap: all four protocol directions plus the reachable replies. */
  readonly messageTypes: readonly string[];
  /** The reply types, listed separately because they are harvested from the host bundle by a different rule. */
  readonly inboundResponses: readonly string[];
  /** Outbound message type -> the payload fields a rewrite may replace. Envelope types have no entry. */
  readonly outboundFields: Readonly<Record<string, readonly string[]>>;
  /** Outbound types whose field list is a lower bound, because a send site spreads a variable in. */
  readonly partialFieldTypes: readonly string[];
  /** Curated anchor name -> the full class it resolves to in this version, or null when it does not. */
  readonly anchors: Readonly<Record<string, string | null>>;
  /**
   * The same names resolved to a CSS selector, which is what the host queries with (D7): the class
   * plus the spec's refinement, under the ancestor its `within` names. Null for a style anchor,
   * which is borrowed rather than queried, and for an anchor that does not resolve at all. No
   * plugin sees this; `ctx.anchor()` still hands over the bare class.
   */
  readonly anchorSelectors: Readonly<Record<string, string | null>>;
  /**
   * Why each unresolved anchor is unresolved, by name, so a refusal says which of the two it is:
   * the class has gone, or the class names more than one control and the table cannot say which.
   * Present for exactly the anchors whose entry in `anchors` is null.
   */
  readonly unresolvedAnchors: Readonly<Record<string, string>>;
  /** The react-dom integration points the transcript capability rests on. */
  readonly react: { readonly hook: string; readonly version: string };
}
