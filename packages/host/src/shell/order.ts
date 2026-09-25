/** Geometry for editing in place (D95), kept free of the DOM so it runs in a unit test. */

/** A box on screen, in viewport pixels. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `items` as a person reads them: line by line, top to bottom, then left to right. Boxes on one line
 * have different tops when their heights differ, so a line is every box whose middle is above the
 * bottom of the line's first box, not every box with the same top.
 */
export function readingOrder<T extends { readonly box: Box }>(items: readonly T[]): T[] {
  const lines: T[][] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  for (const item of [...items].sort((a, b) => a.box.top - b.box.top)) {
    const line = lines.at(-1);
    if (line && item.box.top + item.box.height / 2 < bottom) {
      line.push(item);
    } else {
      lines.push([item]);
      bottom = item.box.top + item.box.height;
    }
  }
  return lines.flatMap((line) => line.sort((a, b) => a.box.left - b.box.left));
}
