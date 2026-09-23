/**
 * The one place this package states its own version.
 *
 * Separate from `index.ts` so a module deep in the tree can stamp a report with it without
 * importing the barrel that re-exports that module — a cycle that resolves at runtime but reads as
 * an accident waiting to happen.
 */
export const CORE_VERSION = "1.0.0-alpha.10";
