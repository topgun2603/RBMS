import { describe, expect, it } from "vitest";
import { createSecretBox, decryptSecret, deriveKey, encryptSecret } from "./crypto";

describe("secret encryption", () => {
  const key = deriveKey("any length passphrase");

  it("derives a 32-byte key from any secret", () => {
    expect(key.length).toBe(32);
    expect(deriveKey("x").length).toBe(32);
    expect(deriveKey("x").equals(deriveKey("x"))).toBe(true);
  });

  it("round-trips and uses a fresh IV every time", () => {
    const a = encryptSecret("rzp_secret_ABC123", key);
    const b = encryptSecret("rzp_secret_ABC123", key);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(a).not.toContain("rzp_secret");
    expect(decryptSecret(a, key)).toBe("rzp_secret_ABC123");
    expect(decryptSecret(b, key)).toBe("rzp_secret_ABC123");
  });

  it("round-trips unicode and empty strings", () => {
    const box = createSecretBox("k");
    expect(box.decrypt(box.encrypt("தமிழ் ₹"))).toBe("தமிழ் ₹");
    expect(box.decrypt(box.encrypt(""))).toBe("");
  });

  it("detects tampering with the ciphertext, tag or iv", () => {
    const enc = encryptSecret("hello world", key);
    const [v, iv, tag, ct] = enc.split(":") as [string, string, string, string];
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64url");
      buf[0] = buf[0]! ^ 0x01;
      return buf.toString("base64url");
    };
    expect(() => decryptSecret([v, iv, tag, flip(ct)].join(":"), key)).toThrow();
    expect(() => decryptSecret([v, iv, flip(tag), ct].join(":"), key)).toThrow();
    expect(() => decryptSecret([v, flip(iv), tag, ct].join(":"), key)).toThrow();
  });

  it("rejects the wrong key and malformed values", () => {
    const enc = encryptSecret("hello", key);
    expect(() => decryptSecret(enc, deriveKey("other"))).toThrow();
    expect(() => decryptSecret("hello", key)).toThrow(/format/);
    expect(() => decryptSecret(enc.replace(/^v1/, "v2"), key)).toThrow(/format/);
    expect(() => decryptSecret("v1:AA:AA:AA", key)).toThrow(/format/);
  });
});
