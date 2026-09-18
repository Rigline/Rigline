// A placeholder, so that this workspace typechecks before it has ever harvested anything.
//
// Replace it by running `pnpm codegen`, which reads the Claude Code extension installed on this
// machine and writes the real file: a module augmentation naming every CSS module, class, message
// type and payload field that extension has, plus the harvest the install flow diffs the next
// version against. Commit the result the way you commit a lockfile.
//
// Until you do, `ctx.cls`, `ctx.onMessage` and `ctx.rewrite` accept any string rather than the
// identifiers that exist. Everything still compiles and everything still runs; what you lose is
// being told about a typo at your desk instead of at install time. A plugin written entirely
// against curated anchors needs no harvest at all.

export const EXTENSION_VERSION = "not harvested yet";
