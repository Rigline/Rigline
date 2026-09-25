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

/**
 * Where a drop at `x`, `y` lands among `boxes`, which are in the order their place shows them: before
 * the first whose middle comes after the point in reading order, or after them all.
 */
export function insertionIndex(boxes: readonly Box[], x: number, y: number): number {
  const i = boxes.findIndex((b) => y < b.top || (y < b.top + b.height && x < b.left + b.width / 2));
  return i === -1 ? boxes.length : i;
}

export function contains(box: Box, x: number, y: number): boolean {
  return x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
}

/** The smallest box holding all of `boxes`. */
export function union(first: Box, ...rest: readonly Box[]): Box {
  let left = first.left;
  let top = first.top;
  let right = first.left + first.width;
  let bottom = first.top + first.height;
  for (const b of rest) {
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.left + b.width);
    bottom = Math.max(bottom, b.top + b.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}
