import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeSignature, parseSignatureHeader, signatureHeader, verifySignature } from "./signature";

const SECRET = "whsec_test123";
const BODY = '{"id":"e1","type":"order.created","data":{"total":125000}}';
const T = 1_760_000_000;

describe("webhook signatures", () => {
  it("signs t.body with HMAC-SHA256 in the t=,v1= header", () => {
    const expected = createHmac("sha256", SECRET).update(`${T}.${BODY}`).digest("hex");
    expect(computeSignature(SECRET, T, BODY)).toBe(expected);
    expect(signatureHeader(SECRET, BODY, T)).toBe(`t=${T},v1=${expected}`);
  });

  it("verifies a valid signature within the tolerance", () => {
    const h = signatureHeader(SECRET, BODY, T);
    expect(verifySignature(SECRET, h, BODY, 300, T)).toBe(true);
    expect(verifySignature(SECRET, h, Buffer.from(BODY), 300, T + 300)).toBe(true);
    expect(verifySignature(SECRET, h, BODY, 300, T - 300)).toBe(true);
  });

  it("rejects old or future timestamps, unless tolerance is 0", () => {
    const h = signatureHeader(SECRET, BODY, T);
    expect(verifySignature(SECRET, h, BODY, 300, T + 301)).toBe(false);
    expect(verifySignature(SECRET, h, BODY, 300, T - 301)).toBe(false);
    expect(verifySignature(SECRET, h, BODY, 0, T + 10_000)).toBe(true);
  });

  it("rejects a wrong secret, a changed body, a changed timestamp and junk headers", () => {
    const h = signatureHeader(SECRET, BODY, T);
    expect(verifySignature("whsec_other", h, BODY, 300, T)).toBe(false);
    expect(verifySignature(SECRET, h, BODY + " ", 300, T)).toBe(false);
    expect(verifySignature(SECRET, h.replace(`t=${T}`, `t=${T + 1}`), BODY, 300, T)).toBe(false);
    for (const bad of ["", "garbage", `t=${T}`, `v1=${"a".repeat(64)}`, `t=abc,v1=${"a".repeat(64)}`, `t=${T},v1=zz`])
      expect(verifySignature(SECRET, bad, BODY, 300, T)).toBe(false);
    expect(verifySignature(SECRET, null, BODY)).toBe(false);
    expect(verifySignature("", h, BODY, 300, T)).toBe(false);
  });

  it("accepts any matching v1 (secret rotation) and uppercase hex", () => {
    const good = computeSignature(SECRET, T, BODY);
    expect(verifySignature(SECRET, `t=${T},v1=${"0".repeat(64)},v1=${good.toUpperCase()}`, BODY, 300, T)).toBe(true);
    expect(parseSignatureHeader(`t=${T}, v1=${good}`)).toEqual({ timestamp: T, signatures: [good] });
  });
});
