/** The URL schemes of the editors a Save link can name: only these reach an extension's handler. */
const PRODUCT_SCHEME = /^(vscode|vscode-insiders|vscodium|cursor|windsurf):$/i;

/**
 * A product-scheme link whose click misses VS Code's listener navigates the panel to an error page
 * nothing recovers (D93). Cancelled in capture, which that listener ignores, so a real click still
 * routes; and only these schemes, so the app's own links are untouched.
 */
export function guardLinks(): void {
  window.addEventListener(
    "click",
    (e) => {
      for (const node of e.composedPath()) {
        if (node instanceof HTMLAnchorElement && PRODUCT_SCHEME.test(node.protocol)) {
          e.preventDefault();
          return;
        }
      }
    },
    true,
  );
}
