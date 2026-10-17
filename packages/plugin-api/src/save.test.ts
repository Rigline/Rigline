import { describe, expect, it } from "vitest";
import { sameValue } from "./same.ts";
import {
  decodeSavePayload,
  decodeSettingsPayload,
  encodeSavePayload,
  encodeSettingsPayload,
  MAX_SAVE_PAYLOAD,
  SAVE_PAYLOAD_VERSION,
  type SavePayload,
  SETTINGS_PAYLOAD_VERSION,
  type SettingsPayload,
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

describe("a settings Save link's payload", () => {
  const settings: SettingsPayload = {
    v: SETTINGS_PAYLOAD_VERSION,
    token: "abcdefghijklmnopqrstuv",
    sections: { clock: { from: {}, to: { seconds: true } } },
    rigline: {
      from: { model: { requireChoice: "off", default: null } },
      to: { model: { requireChoice: "always", default: { model: "opus", effort: "high" } } },
    },
  };

  it("carries Rigline's own blocks beside the plugins' sections", () => {
    expect(decodeSettingsPayload(encodeSettingsPayload(settings))).toEqual({ payload: settings });
    const { rigline: _, ...plugins } = settings;
    expect(decodeSettingsPayload(encodeSettingsPayload(plugins))).toEqual({ payload: plugins });
  });

  it("refuses an older version with what to do about it", () => {
    expect(decodeSettingsPayload(encodeJson({ ...settings, v: 1 }))).toMatchObject({
      problem: expect.stringContaining("reload the panel"),
    });
  });

  it("refuses a block, a key or a mode of Rigline's that this engine does not know", () => {
    const to = (blocks: unknown) =>
      decodeSettingsPayload(encodeJson({ ...settings, rigline: { from: blocks, to: blocks } }));
    expect(to({ companion: {} })).toMatchObject({
      problem: expect.stringContaining('"companion"'),
    });
    expect(to({ model: { requireChoice: "sometimes" } })).toMatchObject({
      problem: expect.stringContaining("model.requireChoice: sometimes"),
    });
    expect(to({ model: { colour: "red" } })).toMatchObject({
      problem: expect.stringContaining("model.colour"),
    });
    expect(to({ model: { default: { effort: "high" } } })).toMatchObject({
      problem: expect.stringContaining("must name a model"),
    });
  });

  it("refuses sides that name different blocks", () => {
    const rigline = { from: {}, to: settings.rigline?.to };
    expect(decodeSettingsPayload(encodeJson({ ...settings, rigline }))).toMatchObject({
      problem: '"rigline.from" and "rigline.to" name different blocks',
    });
  });
});

describe("sameValue", () => {
  it("compares what JSON carries, key order ignored", () => {
    expect(sameValue({ a: [1, { b: null }], c: "x" }, { c: "x", a: [1, { b: null }] })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});
