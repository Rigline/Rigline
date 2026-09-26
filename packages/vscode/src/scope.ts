/**
 * Whether the engine injects the Claude Code this editor loads.
 *
 * The engine injects `~/.vscode/extensions` alone, so a companion installed anywhere else — another
 * editor, a portable VS Code, a remote host — would inject VS Code's Claude Code and report green
 * over a panel it never touched.
 */
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/** Core's `EXTENSIONS_DIR`, in `packages/core/src/extension/locate.ts`, which this copies. */
export function injectedDir(home: string = homedir(), platform = process.platform): string {
  return (platform === "win32" ? win32 : posix).join(home, ".vscode", "extensions");
}

/** Whether `extensionsDir`, where this editor installs extensions, is the one the engine injects. */
export function injectsHere(
  extensionsDir: string,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): boolean {
  const path = platform === "win32" ? win32 : posix;
  const mine = path.resolve(extensionsDir);
  const injected = path.resolve(injectedDir(home, platform));
  return platform === "win32" ? mine.toLowerCase() === injected.toLowerCase() : mine === injected;
}
