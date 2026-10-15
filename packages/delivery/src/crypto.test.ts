import { describe, expect, it } from "vitest";
import { createSecretBox, decryptSecret, deriveKey, encryptSecret } from "./crypto";

describe("secret box", () => {
  it("round-trips with a fresh IV and hides the plaintext", () => {
    const box = createSecretBox("k");
    const a = box.encrypt('{"password":"pw"}');
    expect(a).not.toBe(box.encrypt('{"password":"pw"}'));
    expect(a).not.toContain("password");
    expect(box.decrypt(a)).toBe('{"password":"pw"}');
  });

  it("rejects tampering, other keys and bad formats", () => {
    const key = deriveKey("k");
    const enc = encryptSecret("hello", key);
    const [v, iv, tag, ct] = enc.split(":") as [string, string, string, string];
    const buf = Buffer.from(ct, "base64url");
    buf[0] = buf[0]! ^ 1;
    expect(() => decryptSecret([v, iv, tag, buf.toString("base64url")].join(":"), key)).toThrow();
    expect(() => decryptSecret(enc, deriveKey("other"))).toThrow();
    expect(() => decryptSecret("nope", key)).toThrow(/format/);
  });
});
