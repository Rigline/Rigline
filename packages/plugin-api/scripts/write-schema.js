/**
 * Writes `schema/manifest.json` from the built package. Run by this package's `build` script, and
 * the file is committed: a fresh clone must have it, because a plugin's `rigline.json` points at it
 * by relative path and an editor resolves that before anything has been built.
 *
 * `schema.test.ts` fails when the committed file and the registry disagree, which is what makes
 * "forgot to rebuild" a test failure rather than a schema that quietly describes last week's
 * capabilities.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestSchemaJson } from "../dist/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "schema", "manifest.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, manifestSchemaJson());
console.log(`wrote ${out}`);
