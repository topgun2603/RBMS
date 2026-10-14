import { describe, expect, it } from "vitest";
import { isPlatformHost, isValidDomain, normalizeHost, RESERVED_SLUGS, slugFromHost, validateSlug } from "./slug";

describe("validateSlug", () => {
  it.each(["acme", "abc", "my-shop", "shop123", "a1b", "x".repeat(40)])("accepts %s", (s) => {
    expect(validateSlug(s)).toEqual({ ok: true });
  });

  it.each([
    ["ab", "too short"],
    ["x".repeat(41), "too long"],
    ["Acme", "uppercase"],
    ["-acme", "leading hyphen"],
    ["acme-", "trailing hyphen"],
    ["ac_me", "underscore"],
    ["ac.me", "dot"],
    ["ac me", "space"],
    ["", "empty"],
  ])("rejects %s (%s)", (s) => {
    expect(validateSlug(s).ok).toBe(false);
  });

  it("rejects every reserved slug", () => {
    for (const s of RESERVED_SLUGS) {
      const r = validateSlug(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("reserved");
    }
  });
});

describe("slugFromHost", () => {
  it("extracts a direct subdomain", () => {
    expect(slugFromHost("acme.srikit.com", "srikit.com")).toBe("acme");
  });
  it("strips the port", () => {
    expect(slugFromHost("acme.srikit.com:443", "srikit.com")).toBe("acme");
    expect(slugFromHost("acme.localhost:3000", "localhost")).toBe("acme");
  });
  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(slugFromHost("ACME.Srikit.com.", "srikit.com")).toBe("acme");
  });
  it("returns null for the root domain", () => {
    expect(slugFromHost("srikit.com", "srikit.com")).toBeNull();
    expect(slugFromHost("localhost:3000", "localhost")).toBeNull();
  });
  it("returns null for nested subdomains", () => {
    expect(slugFromHost("a.b.srikit.com", "srikit.com")).toBeNull();
  });
  it("returns null for other domains", () => {
    expect(slugFromHost("acme.example.com", "srikit.com")).toBeNull();
    expect(slugFromHost("evilsrikit.com", "srikit.com")).toBeNull();
  });
  it("returns null for reserved or invalid subdomains", () => {
    expect(slugFromHost("www.srikit.com", "srikit.com")).toBeNull();
    expect(slugFromHost("ab.srikit.com", "srikit.com")).toBeNull();
  });
  it("handles empty input and IPv6", () => {
    expect(slugFromHost("", "srikit.com")).toBeNull();
    expect(slugFromHost(undefined, "srikit.com")).toBeNull();
    expect(slugFromHost("[::1]:3000", "localhost")).toBeNull();
  });
});

describe("host helpers", () => {
  it("normalizeHost", () => {
    expect(normalizeHost("Shop.Acme.in:8080")).toBe("shop.acme.in");
  });
  it("isPlatformHost", () => {
    expect(isPlatformHost("srikit.com", "srikit.com")).toBe(true);
    expect(isPlatformHost("a.b.srikit.com", "srikit.com")).toBe(true);
    expect(isPlatformHost("shop.acme.in", "srikit.com")).toBe(false);
  });
  it("isValidDomain", () => {
    expect(isValidDomain("shop.acme.in")).toBe(true);
    expect(isValidDomain("acme.co.in")).toBe(true);
    expect(isValidDomain("localhost")).toBe(false);
    expect(isValidDomain("-bad.com")).toBe(false);
    expect(isValidDomain("bad_domain.com")).toBe(false);
  });
});
