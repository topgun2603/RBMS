import { describe, expect, it } from "vitest";
import { isReservedSlug, RESERVED_SLUGS, slugify, slugProblem, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("makes URL-safe slugs from titles", () => {
    expect(slugify("About Us")).toBe("about-us");
    expect(slugify("  Shipping & Returns!! ")).toBe("shipping-and-returns");
    expect(slugify("Café Crème's Story")).toBe("cafe-cremes-story");
    expect(slugify("x".repeat(200)).length).toBe(80);
  });
  it("falls back to prefix + short id for non-Latin titles", () => {
    expect(slugify("எங்களை பற்றி", "page", () => "abc123")).toBe("page-abc123");
    expect(slugify("!!!", "post", () => "zz")).toBe("post-zz");
  });
});

describe("reserved and unique slugs", () => {
  it("reserves storefront paths", () => {
    for (const s of ["cart", "checkout", "account", "search", "products", "p", "c", "collections", "blog", "track", "compare", "i", "s", "api"])
      expect(isReservedSlug(s)).toBe(true);
    expect(RESERVED_SLUGS.size).toBe(14);
    expect(isReservedSlug("about")).toBe(false);
  });
  it("suffixes taken or reserved generated slugs", () => {
    expect(uniqueSlug("about", new Set())).toBe("about");
    expect(uniqueSlug("about", new Set(["about", "about-2"]))).toBe("about-3");
    expect(uniqueSlug("blog", new Set())).toBe("blog-2");
    expect(uniqueSlug("cart", new Set(["cart-2"]))).toBe("cart-3");
  });
  it("explains why an owner-chosen slug can't be used", () => {
    expect(slugProblem("about", new Set())).toBeNull();
    expect(slugProblem("checkout", new Set())).toBe("reserved");
    expect(slugProblem("about", new Set(["about"]))).toBe("taken");
    expect(slugProblem("About Us", new Set())).toBe("invalid");
    expect(slugProblem("a--b", new Set())).toBe("invalid");
  });
});
