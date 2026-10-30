import { sha256, type PermissionDef } from "@rbms/core";
import { describe, expect, it } from "vitest";
import { API_KEY_RE, apiKeyPrefix, generateApiKey, hashApiKey, isApiKeyToken, keyModeFor, looksLikeApiKey, randomBase62, validateScopes } from "./keys";

const def = (key: string): PermissionDef => ({ key, module: key.split(".")[0]!, label: key, description: "" });
const REGISTRY = ["invoices.create", "invoices.cancel", "orders.manage", "catalogue.manage", "developer.manage"].map(def);

describe("api key format", () => {
  it("generates sk_live_/sk_test_ + 32 base62 chars, hashes with sha256 and keeps a 12-char prefix", () => {
    const k = generateApiKey("live");
    expect(k.token).toMatch(/^sk_live_[0-9A-Za-z]{32}$/);
    expect(k.token).toHaveLength(40);
    expect(k.hash).toBe(sha256(k.token));
    expect(k.hash).toBe(hashApiKey(k.token));
    expect(k.prefix).toBe(k.token.slice(0, 12));
    expect(apiKeyPrefix(k.token)).toHaveLength(12);
    expect(generateApiKey("test").token).toMatch(API_KEY_RE);
    expect(generateApiKey("test").token.startsWith("sk_test_")).toBe(true);
    expect(generateApiKey("live").token).not.toBe(k.token);
  });

  it("uses live keys in production and test keys elsewhere", () => {
    expect(keyModeFor(true)).toBe("live");
    expect(keyModeFor(false)).toBe("test");
  });

  it("base62 output covers the alphabet only", () => {
    const s = randomBase62(2000);
    expect(s).toMatch(/^[0-9A-Za-z]{2000}$/);
    expect(new Set(s).size).toBeGreaterThan(55);
  });

  it("accepts only well-formed keys, test keys only outside production", () => {
    const live = generateApiKey("live").token;
    const test = generateApiKey("test").token;
    expect(isApiKeyToken(live, true)).toBe(true);
    expect(isApiKeyToken(test, true)).toBe(false);
    expect(isApiKeyToken(test, false)).toBe(true);
    expect(isApiKeyToken(live.slice(0, -1), false)).toBe(false);
    expect(isApiKeyToken(live + "x", false)).toBe(false);
    expect(isApiKeyToken("sk_live_" + "-".repeat(32), false)).toBe(false);
    expect(looksLikeApiKey(live)).toBe(true);
    expect(looksLikeApiKey("sk_abc")).toBe(false);
    expect(looksLikeApiKey("abc")).toBe(false);
    expect(looksLikeApiKey(null)).toBe(false);
  });
});

describe("scope validation", () => {
  it("accepts registered keys and patterns that cover one, de-duplicated", () => {
    expect(validateScopes(["invoices.create", "invoices.create", "orders.*"], REGISTRY)).toEqual({
      ok: true,
      scopes: ["invoices.create", "orders.*"],
    });
    expect(validateScopes(["*"], REGISTRY).ok).toBe(true);
  });

  it("rejects unknown keys and patterns that cover nothing", () => {
    expect(validateScopes(["invoices.delete", "reports.*", "INVOICES.create", "a b"], REGISTRY)).toEqual({
      ok: false,
      invalid: ["invoices.delete", "reports.*", "INVOICES.create", "a b"],
      notHeld: [],
    });
  });

  it("a grantor without full access can only grant what they hold", () => {
    const grantor = { fullAccess: false, permissions: ["invoices.*"] };
    expect(validateScopes(["invoices.cancel", "invoices.*"], REGISTRY, grantor).ok).toBe(true);
    expect(validateScopes(["invoices.create", "orders.manage", "*"], REGISTRY, grantor)).toEqual({
      ok: false,
      invalid: [],
      notHeld: ["orders.manage", "*"],
    });
    expect(validateScopes(["*"], REGISTRY, { fullAccess: true, permissions: [] }).ok).toBe(true);
  });
});
