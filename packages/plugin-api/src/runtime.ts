/**
 * The modules the panel serves to plugins, by the bare specifier a plugin imports each as, mapped to
 * the file's path inside the payload directory.
 *
 * A plugin's build leaves these imports bare and `install` points each at the payload's copy, so
 * every plugin shares one React and no plugin's output names the payload's layout.
 */
export const RUNTIME_MODULES = {
  react: "runtime/react.js",
  "react/jsx-runtime": "runtime/jsx-runtime.js",
  "react-dom": "runtime/react-dom.js",
  "@rigline/plugin-api/ui": "runtime/ui.js",
} as const satisfies Record<string, string>;

export type RuntimeSpecifier = keyof typeof RUNTIME_MODULES;

export function isRuntimeSpecifier(specifier: string): specifier is RuntimeSpecifier {
  return Object.hasOwn(RUNTIME_MODULES, specifier);
}
