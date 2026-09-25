/** Geometry for editing in place (D95). */
import { describe, expect, it } from "vitest";
import { insertionIndex, readingOrder } from "../src/shell/order.ts";

const at = (name: string, left: number, top: number, height = 18) => ({
  name,
  box: { left, top, width: 40, height },
});

describe("reading order", () => {
  it("reads a line left to right though its boxes' tops differ", () => {
    const order = readingOrder([
      at("pill", 90, 104, 14),
      at("text", 10, 100, 22),
      at("mid", 50, 102),
    ]);
    expect(order.map((i) => i.name)).toEqual(["text", "mid", "pill"]);
  });

  it("reads the lines top to bottom", () => {
    const order = readingOrder([
      at("row-b", 10, 132),
      at("footer-b", 60, 100),
      at("row-a", 90, 130),
      at("footer-a", 10, 100),
    ]);
    expect(order.map((i) => i.name)).toEqual(["footer-a", "footer-b", "row-b", "row-a"]);
  });
});

describe("where a drop lands", () => {
  // A zone wrapped onto two lines: a and b on the first, c on the second.
  const boxes = [at("a", 10, 100), at("b", 60, 100), at("c", 10, 124)].map((i) => i.box);

  it("goes before the first box whose middle is after the pointer", () => {
    expect(insertionIndex(boxes, 20, 108)).toBe(0);
    expect(insertionIndex(boxes, 40, 108)).toBe(1);
  });

  it("goes after a line's last box as before the next line's first", () => {
    expect(insertionIndex(boxes, 95, 108)).toBe(2);
    expect(insertionIndex(boxes, 5, 130)).toBe(2);
  });

  it("goes after everything past the last box, and first above them all", () => {
    expect(insertionIndex(boxes, 45, 130)).toBe(3);
    expect(insertionIndex(boxes, 45, 90)).toBe(0);
    expect(insertionIndex([], 0, 0)).toBe(0);
  });
});
