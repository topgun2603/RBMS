import { describe, expect, it } from "vitest";
import { idempotencyKeyOf, requestHash } from "./index";

describe("idempotency keys", () => {
  it("accepts UUIDs and similar keys, ignores a missing header, refuses junk", () => {
    expect(idempotencyKeyOf(undefined)).toBeNull();
    expect(idempotencyKeyOf("  ")).toBeNull();
    expect(idempotencyKeyOf("5f0c2a1e-8d4b-4c7e-9a3f-1b2c3d4e5f60")).toBe("5f0c2a1e-8d4b-4c7e-9a3f-1b2c3d4e5f60");
    expect(idempotencyKeyOf(["device-1:bill:42"])).toBe("device-1:bill:42");
    expect(() => idempotencyKeyOf("short")).toThrow(/Idempotency-Key/);
    expect(() => idempotencyKeyOf("has space in it")).toThrow();
  });

  it("hashes method, URL and body together", () => {
    const a = requestHash("POST", "/v1/invoices", { total: 1 });
    expect(requestHash("POST", "/v1/invoices", { total: 1 })).toBe(a);
    expect(requestHash("POST", "/v1/invoices", { total: 2 })).not.toBe(a);
    expect(requestHash("PUT", "/v1/invoices", { total: 1 })).not.toBe(a);
  });
});
