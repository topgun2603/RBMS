import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Copied from @rbms/payments (packages never import each other).

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Derives the 32-byte AES key from a configured secret of any length. */
export const deriveKey = (secret: string): Buffer => createHash("sha256").update(secret, "utf8").digest();

/** AES-256-GCM with a random 12-byte IV. Output: `v1:<iv>:<tag>:<ciphertext>`, each part base64url. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

/** Throws when the value is malformed, was encrypted with another key, or was tampered with. */
export function decryptSecret(encoded: string, key: Buffer): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Unsupported secret format");
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ct = Buffer.from(parts[3]!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Convenience wrapper bound to one configured secret. */
export function createSecretBox(secret: string) {
  const key = deriveKey(secret);
  return {
    encrypt: (plain: string) => encryptSecret(plain, key),
    decrypt: (encoded: string) => decryptSecret(encoded, key),
  };
}
export type SecretBox = ReturnType<typeof createSecretBox>;
