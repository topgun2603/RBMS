import { describe, expect, it } from "vitest";
import { appUrlFor, signupBillingDefaults, signupSubscriptionStart } from "./kit-batch5";

describe("appUrlFor", () => {
  const setting = "BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002/";
  it("picks the app's template and fills the slug", () => {
    expect(appUrlFor(setting, "BL", "anbu")).toBe("http://anbu.localhost:3001");
    expect(appUrlFor(setting, "EC", "anbu")).toBe("http://anbu.localhost:3002");
  });
  it("falls back to the first entry, or a single template", () => {
    expect(appUrlFor(setting, null, "x-shop")).toBe("http://x-shop.localhost:3001");
    expect(appUrlFor("https://{slug}.srikit.in", "EC", "anbu")).toBe("https://anbu.srikit.in");
  });
});

describe("signupBillingDefaults", () => {
  it("gives a new shop a bill prefix from its name, not INV", () => {
    expect(signupBillingDefaults("ByteFix Computers", { state: "33", gstin: null, phone: "+919840012345" })).toEqual({
      legalName: "ByteFix Computers",
      invoicePrefix: "BFC",
      stateCode: "33",
      phone: "+919840012345",
    });
    expect(signupBillingDefaults("Glow Salon & Spa", null)).toEqual({ legalName: "Glow Salon & Spa", invoicePrefix: "GSS" });
    expect(signupBillingDefaults("ஸ்ரீ", null).invoicePrefix).toBe("INV");
  });
});

describe("signupSubscriptionStart", () => {
  it("starts the plan a sign-up chose", () => {
    expect(signupSubscriptionStart("t1", "u1", { planId: "EC-starter", interval: "yearly" })).toEqual({ tenantId: "t1", ownerUserId: "u1", planId: "EC-starter", interval: "yearly" });
    expect(signupSubscriptionStart("t1", "u1", { planId: "EC-starter" })?.interval).toBe("monthly");
  });
  it("skips a shop created without a plan (seed / admin: the plan and its subscription come right after)", () => {
    expect(signupSubscriptionStart("t1", "u1", null)).toBeNull();
    expect(signupSubscriptionStart("t1", "u1", {})).toBeNull();
    expect(signupSubscriptionStart("t1", "u1", { planId: "  " })).toBeNull();
    expect(signupSubscriptionStart("t1", "u1", { businessType: "organic" } as never)).toBeNull();
  });
});
