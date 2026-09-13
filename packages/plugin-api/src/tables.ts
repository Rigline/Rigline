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
  /** The react-dom integration points the transcript capability rests on. */
  readonly react: { readonly hook: string; readonly version: string };
}
