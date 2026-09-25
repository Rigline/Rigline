/** Geometry for editing in place (D95). */
import { describe, expect, it } from "vitest";
import { readingOrder } from "../src/shell/order.ts";

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
