import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./index";
import { handoffLoginUrl } from "./routes";
import { HANDOFF_TTL_SECONDS } from "./service";

describe("login handoff", () => {
  it("lives for 60 seconds", () => {
    expect(HANDOFF_TTL_SECONDS).toBe(60);
  });
  it("builds the shop app's login URL with the code", () => {
    expect(handoffLoginUrl("http://acme.localhost:3001", "abc_DEF-123")).toBe("http://acme.localhost:3001/login?handoff=abc_DEF-123");
    expect(handoffLoginUrl("http://acme.localhost:3002/billing/", "c0de")).toBe("http://acme.localhost:3002/billing/login?handoff=c0de");
    expect(handoffLoginUrl("https://acme.srikit.in/?x=1", "c")).toBe("https://acme.srikit.in/login?x=1&handoff=c");
  });
});

describe("storefront handoff (origin is decided by the shop, not the caller)", () => {
  const shops = {
    anbu: { id: "t-anbu", slug: "anbu", name: "Anbu Fashions", origins: ["http://anbu.localhost:3003", "https://shop.anbu.in"] },
    raja: { id: "t-raja", slug: "raja", name: "Raja", origins: ["http://raja.localhost:3003"] },
  };
  const { service } = createAuth({
    db: {} as Db, // a refused origin never reaches the database
    config: { sessionTtlDays: 30, otpTtlMinutes: 10 },
    otp: { sendOtp: vi.fn() },
    memberships: { rolesFor: async () => [] },
    storeOrigins: { shop: async (slug) => shops[slug as keyof typeof shops] ?? null },
  });
  const user = "00000000-0000-4000-8000-000000000001";

  it("refuses an origin that belongs to another shop, another port, or nobody", async () => {
    for (const origin of ["http://raja.localhost:3003", "http://anbu.localhost:3001", "https://evil.example", "http://anbu.localhost:3003.evil.example", "javascript:1"]) {
      await expect(service.createStoreHandoff(user, { shop: "anbu", origin })).rejects.toMatchObject({ status: 400, code: "invalid_store_origin" });
    }
  });

  it("refuses a return URL off the validated origin, and an unknown shop", async () => {
    await expect(
      service.createStoreHandoff(user, { shop: "anbu", origin: "http://anbu.localhost:3003", returnUrl: "https://evil.example/account" }),
    ).rejects.toMatchObject({ code: "invalid_store_origin" });
    await expect(service.createStoreHandoff(user, { shop: "nobody", origin: "http://anbu.localhost:3003" })).rejects.toMatchObject({ status: 404 });
  });

  it("tells the sign-in page whether the origin is the shop's own", async () => {
    await expect(service.storeSignInContext("Anbu", "http://anbu.localhost:3003/")).resolves.toEqual({
      shop: { slug: "anbu", name: "Anbu Fashions" },
      origin: "http://anbu.localhost:3003",
    });
    await expect(service.storeSignInContext("anbu", "https://shop.anbu.in")).resolves.toMatchObject({ origin: "https://shop.anbu.in" });
    await expect(service.storeSignInContext("anbu", "http://raja.localhost:3003")).resolves.toMatchObject({ origin: null });
  });
});
