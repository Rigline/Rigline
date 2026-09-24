import { describe, expect, it } from "vitest";
import {
  decodeSavePayload,
  encodeSavePayload,
  MAX_SAVE_PAYLOAD,
  SAVE_PAYLOAD_VERSION,
  type SavePayload,
} from "./save.ts";

const payload: SavePayload = {
  v: SAVE_PAYLOAD_VERSION,
  token: "abcdefghijklmnopqrstuv",
  from: { "before footerSpacer": ["session-id/short-id"] },
  to: { rigRow: ["session-id/address", "ünïcode/élément"], off: ["session-id/short-id"] },
};

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("a Save link's payload", () => {
  it("round-trips, names outside ASCII included, in characters a URL carries as they are", () => {
    const encoded = encodeSavePayload(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSavePayload(encoded)).toEqual({ payload });
  });

  it("is what Node's own base64url makes of the JSON, so either side can build one", () => {
    expect(encodeSavePayload(payload)).toBe(encodeJson(payload));
  });

  it("refuses one that is too long before decoding it", () => {
    expect(decodeSavePayload("A".repeat(MAX_SAVE_PAYLOAD + 1))).toMatchObject({
      problem: expect.stringContaining("longer than"),
    });
  });

  it("refuses what is not base64url, not UTF-8, not JSON or not an object", () => {
    expect(decodeSavePayload("not+base64/")).toHaveProperty("problem");
    expect(decodeSavePayload(Buffer.from([0xff, 0xfe]).toString("base64url"))).toHaveProperty(
      "problem",
    );
    expect(decodeSavePayload(Buffer.from("{nope").toString("base64url"))).toMatchObject({
      problem: "the payload is not JSON",
    });
    expect(decodeSavePayload(encodeJson([1, 2]))).toMatchObject({
      problem: "the payload is not an object",
    });
  });

  it("names a version it does not read", () => {
    expect(decodeSavePayload(encodeJson({ ...payload, v: 2 }))).toMatchObject({
      problem: expect.stringContaining("version 2"),
    });
  });

  it("refuses a missing token and a layout of the wrong shape", () => {
    expect(decodeSavePayload(encodeJson({ ...payload, token: "" }))).toMatchObject({
      problem: "the payload has no token",
    });
    expect(decodeSavePayload(encodeJson({ ...payload, to: { rigRow: "a/b" } }))).toMatchObject({
      problem: expect.stringContaining('"to.rigRow"'),
    });
    expect(decodeSavePayload(encodeJson({ ...payload, from: ["a/b"] }))).toMatchObject({
      problem: '"from" is not a layout',
    });
    const control = `a/b${String.fromCharCode(10)}c`;
    expect(decodeSavePayload(encodeJson({ ...payload, to: { rigRow: [control] } }))).toHaveProperty(
      "problem",
    );
    const many = { rigRow: Array.from({ length: 1030 }, (_, i) => `a/${i}`) };
    expect(decodeSavePayload(encodeJson({ ...payload, to: many }))).toMatchObject({
      problem: expect.stringContaining("more than"),
    });
  });

  it("keeps a `__proto__` place an ordinary key", () => {
    const decoded = decodeSavePayload(
      Buffer.from(`{"v":1,"token":"t","from":{},"to":{"__proto__":["a/b"]}}`).toString("base64url"),
    );
    if (!("payload" in decoded)) throw new Error(decoded.problem);
    expect(Object.hasOwn(decoded.payload.to, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(decoded.payload.to)).toBe(Object.prototype);
  });
});
