import { createContext } from "react";

/**
 * The error path of the contribution rendering here, for a handler that throws, which no boundary
 * catches (D88). The shell provides it around every menu entry and element.
 */
export const FaultContext = createContext<(reason: string) => void>((reason) =>
  console.error(`[rigline] ${reason}`),
);

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
