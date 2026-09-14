/**
 * The extension's own identifiers, as types a plugin compiles against — declared here as an empty
 * interface and filled in, on the author's machine, from the extension in front of them (D40).
 *
 * Nothing harvested is published. A snapshot shipped in this package could never carry the version
 * released tomorrow, which is exactly when an author needs it; a green typecheck against one would
 * assert only that the identifiers existed wherever codegen ran; and shipping several under a
 * selector would rebuild the version matrix P7 exists to refuse. So `RiglineIdentifiers` is empty
 * as published, `rigline codegen` writes a module augmentation filling it in, and the author
 * commits that file the way they commit a lockfile.
 *
 * Each type below reads one key of the interface and falls back to that key's `string`-shaped
 * default when it is absent, so a plugin written before codegen has ever run still compiles — every
 * union simply widens to `string`. The narrowing is dev-time ergonomics; the contract is the
 * install-time check on the user's machine (D43), which does not care whether types were generated.
 *
 * The lookup has to be a conditional rather than the obvious `interface` member with a `string`
 * default, because interface merging refuses to change a member's type: an augmentation may add
 * keys to an empty interface, and may not narrow `string` to a union. That is the whole reason for
 * the indirection, and the reason the four public types are aliases rather than the interface's own
 * members.
 *
 * `AnchorName` is deliberately not here. It is Rigline's own vocabulary, curated in this repo and
 * versioned with this package, while module hashes and local class names are the extension's
 * vocabulary and are harvested where they are used. A plugin written entirely against anchors needs
 * no generated file at all, so the type system enforces D7's preference instead of restating it.
 */

/**
 * The augmentation point. Empty here; `rigline codegen` writes
 *
 *     declare module "@rigline/plugin-api" {
 *       interface RiglineIdentifiers {
 *         modules: "07S1Yg" | ...;
 *         classes: { "07S1Yg": "message" | ...; ... };
 *         messages: "init" | ...;
 *         outboundFields: { rename_tab: "title"; ... };
 *       }
 *     }
 *
 * into the author's own `generated.ts`. Naming the package works even though this interface is
 * declared in a module the index only re-exports: an augmentation resolves its target through the
 * alias, verified against both tsconfig `paths` to source and the emitted `.d.ts` in node_modules.
 */
// biome-ignore lint/suspicious/noEmptyInterface: empty is the published state; augmentation is the entire mechanism
export interface RiglineIdentifiers {}

/** `RiglineIdentifiers[K]` when the augmentation supplied `K`, and `Fallback` when it did not. */
type Lookup<K extends PropertyKey, Fallback> =
  RiglineIdentifiers extends Record<K, infer V> ? V : Fallback;

/** The CSS modules in the webview bundle, by their six-character hash. `string` with no harvest. */
export type ModuleId = Lookup<"modules", string>;

/**
 * The local class names each module defines. Module-scoped rather than flat because local names are
 * reused across modules, and a flat map would resolve the wrong one silently. `Record<string,
 * string>` with no harvest, which is what keeps `ctx.cls(m, l)` compiling either way.
 */
export type ModuleClasses = Lookup<"classes", Record<string, string>>;

/** Every message type a plugin may tap, in either direction. `string` with no harvest. */
export type MessageType = Lookup<"messages", string>;

/**
 * The payload fields of each outbound message, which is what a rewrite may replace. Envelope
 * wrappers have no entry: their fields are correlation state.
 */
export type OutboundFields = Lookup<"outboundFields", Record<string, string>>;
