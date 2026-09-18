/**
 * The manifest's JSON schema, built from the capability registry (decisions.md, D18).
 *
 * `validateManifest` is the rule that decides whether a plugin installs; this says the same thing
 * in the one language an editor reads, so an author is told about a misspelled anchor while typing
 * rather than at install. Neither is derivable from the other — a `shape` function cannot be turned
 * into a schema, and a schema cannot produce the collected, sentence-shaped problems an install
 * report wants — so they are two statements of one rule, and `schema.test.ts` is what keeps them
 * from drifting apart.
 *
 * Built rather than written out, for the same reason every other walk over `CONTRACTS` is: a
 * capability added later appears in the schema without anybody remembering to add it. `uses` and
 * `uses.optional` are emitted from the same fragments, which is what makes the two halves mirror
 * each other by construction rather than by care (D41).
 */
import { ANCHOR_NAMES } from "./anchors.ts";
import { CONTRACTS } from "./capabilities/index.ts";
import { NAME_PATTERN, SURFACES } from "./manifest.ts";

type JsonObject = Record<string, unknown>;

/** One half of `uses`: every capability's own fragment, and nothing else allowed. */
function declarations(title: string, description: string): JsonObject {
  const properties: JsonObject = {};
  for (const contract of CONTRACTS) properties[contract.key] = { ...contract.schema };
  return { title, description, type: "object", additionalProperties: false, properties };
}

/** The whole of `rigline.json`, as a JSON Schema 2020-12 document. */
export function manifestSchema(): JsonObject {
  const uses = declarations(
    "uses",
    "Everything this plugin depends on. An identifier named here that the installed extension does not have refuses the plugin by name.",
  );
  (uses.properties as JsonObject).optional = declarations(
    "uses.optional",
    "The same keys, for what this plugin can do without. A missing one is reported and costs the plugin that decoration; it never refuses the plugin.",
  );

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://rigline.dev/schema/manifest.json",
    title: "Rigline plugin manifest",
    description:
      "rigline.json: what a plugin depends on, as data. Read by the installer and by the loader without evaluating the plugin.",
    type: "object",
    required: ["api", "name", "entry"],
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      api: {
        const: 1,
        description:
          "The version of this shape and of ctx. Only 1 exists; it moves when a meaning changes, never for growth.",
      },
      name: {
        type: "string",
        pattern: NAME_PATTERN,
        description: "Must match the plugin's directory name.",
      },
      description: { type: "string" },
      entry: {
        type: "string",
        minLength: 1,
        description: "The built entry module, relative to this file and inside this directory.",
      },
      surfaces: {
        type: "array",
        minItems: 1,
        items: { enum: [...SURFACES] },
        description: "The webview surfaces this plugin is for. Absent means all of them.",
      },
      uses,
      patches: {
        type: "array",
        description:
          "Byte substitutions in the extension host's own bundle, applied by the installer. The find bytes must occur exactly once and replace must be the same length, so a patch that no longer fits is refused rather than applied somewhere else.",
        items: {
          type: "object",
          required: ["find", "replace", "why"],
          additionalProperties: false,
          properties: {
            find: {
              type: "string",
              minLength: 1,
              description: "The exact bytes to find. Must occur exactly once in the bundle.",
            },
            replace: {
              type: "string",
              minLength: 1,
              description:
                "The bytes to write in their place. Must be the same byte length as find, because matches are located before any is written and a substitution that resized the bundle would move every offset after it.",
            },
            why: {
              type: "string",
              minLength: 1,
              description: "What the patch buys. The bytes cannot say for themselves.",
            },
            required: {
              type: "boolean",
              description:
                "Refuse the plugin when the patch cannot apply, rather than loading it without. Default false.",
            },
          },
        },
      },
    },
    $defs: {
      // Named so an editor's hover says which anchors exist, and so the list appears once in the
      // document rather than twice over.
      anchorName: { enum: [...ANCHOR_NAMES] },
    },
  };
}

/** The schema as the bytes committed to `schema/manifest.json`. One definition of the formatting. */
export function manifestSchemaJson(): string {
  return `${JSON.stringify(manifestSchema(), null, 2)}\n`;
}
