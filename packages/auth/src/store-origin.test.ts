import { describe, expect, it } from "vitest";
import { matchStoreOrigin, matchStoreReturn, normalizeOrigin, storeOriginsFor } from "./store-origin";

describe("storefront origins of one shop", () => {
  const dev = storeOriginsFor("http://{slug}.localhost:3003", "anbu", []);
  const prod = storeOriginsFor("EC=https://{slug}.rbms.in,BL=https://{slug}.billing.rbms.in/x", "raja", ["shop.raja.in", " www.raja.in "]);

  it("builds them from the store host templates and verified custom domains", () => {
    expect(dev).toEqual(["http://anbu.localhost:3003"]);
    expect(prod).toEqual(["https://raja.rbms.in", "https://raja.billing.rbms.in", "https://shop.raja.in", "https://www.raja.in"]);
  });

  it("accepts only an exact origin of that shop", () => {
    expect(matchStoreOrigin("http://ANBU.localhost:3003/", dev)).toBe("http://anbu.localhost:3003");
    for (const bad of [
      "http://raja.localhost:3003", // another shop
      "http://anbu.localhost:3001", // another port
      "https://anbu.localhost:3003", // another scheme
      "http://anbu.localhost:3003.evil.com",
      "http://evil.com/?http://anbu.localhost:3003",
      "http://anbu.localhost:3003@evil.com",
      "http://user:pw@anbu.localhost:3003",
      "javascript:alert(1)",
      "http://localhost:3003",
      "",
      null,
      undefined,
    ]) {
      expect(matchStoreOrigin(bad as string, dev)).toBeNull();
    }
    expect(matchStoreOrigin("https://shop.raja.in", prod)).toBe("https://shop.raja.in");
    expect(matchStoreOrigin("https://evil.raja.in", prod)).toBeNull();
    expect(matchStoreOrigin("http://shop.raja.in", prod)).toBeNull();
  });

  it("keeps a redirect return on the validated origin", () => {
    const o = "http://anbu.localhost:3003";
    expect(matchStoreReturn("http://anbu.localhost:3003/checkout?x=1&handoff=old#h", o)).toBe("http://anbu.localhost:3003/checkout?x=1");
    expect(matchStoreReturn("http://evil.com/checkout", o)).toBeNull();
    expect(matchStoreReturn("//evil.com", o)).toBeNull();
    expect(matchStoreReturn("/checkout", o)).toBeNull();
    expect(matchStoreReturn("http://u:p@anbu.localhost:3003/", o)).toBeNull();
    expect(normalizeOrigin("ftp://anbu.localhost")).toBeNull();
  });
});
