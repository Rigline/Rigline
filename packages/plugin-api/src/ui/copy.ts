/** Copying a value in the panel, and flashing the outcome where the value is shown (D123). */
import { useCallback, useEffect, useState } from "react";

/**
 * Copies `text`, and says whether it did. Over a hidden textarea rather than the async Clipboard
 * API, which needs a permission a webview may not hold and fails as a rejected promise, and puts
 * focus back so a menu's keys still work.
 */
export function copyText(text: string): boolean {
  const back = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  if (back instanceof HTMLElement) back.focus();
  return ok;
}

/** A flash for `Pill`'s or `MenuItem`'s `flash`, and the function that shows one for `ms`. */
export function useFlash(ms = 1200): readonly [string | null, (flash: string) => void] {
  // An object per show, so showing the same text again restarts the timer.
  const [shown, setShown] = useState<{ readonly text: string } | null>(null);
  useEffect(() => {
    if (shown === null) return;
    const timer = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(timer);
  }, [shown, ms]);
  const show = useCallback((text: string) => setShown({ text }), []);
  return [shown?.text ?? null, show];
}
