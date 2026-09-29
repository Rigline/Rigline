import { describe, expect, it } from "vitest";
import { parseJson } from "./json.ts";

const BOM = String.fromCharCode(0xfeff);

describe("parseJson", () => {
  it("reads a file that starts with a byte order mark as the JSON after it", () => {
    expect(parseJson(`${BOM}{"api": 1}`)).toEqual({ api: 1 });
  });

  it("still refuses one anywhere else", () => {
    expect(() => parseJson(`{"api": 1}${BOM}`)).toThrow(SyntaxError);
  });
});
