import { describe, expect, it } from "vitest";
import { isPlatformHost, isValidDomain, normalizeHost, RESERVED_SLUGS, slugCandidates, slugFromHost, slugify, validateSlug } from "./slug";

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

describe("slugify and slugCandidates", () => {
  it("makes an address from a shop name", () => {
    expect(slugify("Sri Murugan Stores!")).toBe("sri-murugan-stores");
    expect(slugify("  Café & Bakery  ")).toBe("cafe-and-bakery");
    expect(slugify("அன்பு")).toBe("");
    expect(slugify("x".repeat(60)).length).toBe(40);
  });
  it("suggests valid alternatives: city first, then endings and numbers", () => {
    const c = slugCandidates("anbu", { city: "Madurai" });
    expect(c.slice(0, 3)).toEqual(["anbu-madurai", "madurai-anbu", "anbu-shop"]);
    expect(c).toContain("anbu1");
    expect(c).not.toContain("anbu");
    for (const s of c) expect(validateSlug(s)).toEqual({ ok: true });
    for (const s of slugCandidates("x".repeat(40))) expect(s.length).toBeLessThanOrEqual(40);
    expect(slugCandidates("admin").every((s) => validateSlug(s).ok)).toBe(true);
  });
  it("reports why a slug is invalid", () => {
    expect(validateSlug("ab")).toMatchObject({ ok: false, code: "length" });
    expect(validateSlug("a_b")).toMatchObject({ ok: false, code: "format" });
    expect(validateSlug("signup")).toMatchObject({ ok: false, code: "reserved" });
  });
});

describe("slugFromHost", () => {
  it("extracts a direct subdomain", () => {
    expect(slugFromHost("acme.rbms.in", "rbms.in")).toBe("acme");
  });
  it("strips the port", () => {
    expect(slugFromHost("acme.rbms.in:443", "rbms.in")).toBe("acme");
    expect(slugFromHost("acme.localhost:3000", "localhost")).toBe("acme");
  });
  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(slugFromHost("ACME.RBMS.in.", "rbms.in")).toBe("acme");
  });
  it("returns null for the root domain", () => {
    expect(slugFromHost("rbms.in", "rbms.in")).toBeNull();
    expect(slugFromHost("localhost:3000", "localhost")).toBeNull();
  });
  it("returns null for nested subdomains", () => {
    expect(slugFromHost("a.b.rbms.in", "rbms.in")).toBeNull();
  });
  it("returns null for other domains", () => {
    expect(slugFromHost("acme.example.com", "rbms.in")).toBeNull();
    expect(slugFromHost("evilrbms.in", "rbms.in")).toBeNull();
  });
  it("returns null for reserved or invalid subdomains", () => {
    expect(slugFromHost("www.rbms.in", "rbms.in")).toBeNull();
    expect(slugFromHost("ab.rbms.in", "rbms.in")).toBeNull();
  });
  it("handles empty input and IPv6", () => {
    expect(slugFromHost("", "rbms.in")).toBeNull();
    expect(slugFromHost(undefined, "rbms.in")).toBeNull();
    expect(slugFromHost("[::1]:3000", "localhost")).toBeNull();
  });
});

describe("host helpers", () => {
  it("normalizeHost", () => {
    expect(normalizeHost("Shop.Acme.in:8080")).toBe("shop.acme.in");
  });
  it("isPlatformHost", () => {
    expect(isPlatformHost("rbms.in", "rbms.in")).toBe(true);
    expect(isPlatformHost("a.b.rbms.in", "rbms.in")).toBe(true);
    expect(isPlatformHost("shop.acme.in", "rbms.in")).toBe(false);
  });
  it("isValidDomain", () => {
    expect(isValidDomain("shop.acme.in")).toBe(true);
    expect(isValidDomain("acme.co.in")).toBe(true);
    expect(isValidDomain("localhost")).toBe(false);
    expect(isValidDomain("-bad.com")).toBe(false);
    expect(isValidDomain("bad_domain.com")).toBe(false);
  });
});
