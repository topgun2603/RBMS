import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "@rbms/i18n/client";
import { ApiError } from "./api";
import { canManageShop, displayName, effectiveRoles, hasShopAccess, isSuperAdmin } from "./auth";
import { branchKey, getStoredBranch, setStoredBranch } from "./branch";
import { describeError, isFeatureDisabled, isPlanLimit, setErrorNamespaces, tOr } from "./i18n";
import { formatPaise, humanizeKey, normalizeTarget } from "./format";
import { webMessages } from "./messages";
import { readStored, writeStored } from "./session";
import { isValidShopSlug, rootDomain, tenantFromHost } from "./tenant";
import type { MeResponse } from "./types";

const t = createTranslator({ ...webMessages.en, "billing.errors.credit_limit": "Credit limit reached." }, webMessages.en, "en");
const tta = createTranslator(webMessages.ta, webMessages.en, "ta");

afterEach(() => {
  vi.unstubAllGlobals();
  setErrorNamespaces([]);
});

describe("which shop a web address belongs to", () => {
  it("takes the label just before the root domain", () => {
    expect(tenantFromHost("raja.localhost:3001", "localhost")).toBe("raja");
    expect(tenantFromHost("raja.rbms.in", "rbms.in")).toBe("raja");
    expect(tenantFromHost("RAJA.rbms.in.", "rbms.in")).toBe("raja");
    // Only the label right before the root names the shop.
    expect(tenantFromHost("x.raja.localhost", "localhost")).toBe("raja");
  });

  it("says no shop for the bare root, www, reserved names, other domains, empty and too-short names", () => {
    expect(tenantFromHost("localhost:3000", "localhost")).toBeNull();
    expect(tenantFromHost("rbms.in", "rbms.in")).toBeNull();
    expect(tenantFromHost("www.rbms.in", "rbms.in")).toBeNull();
    expect(tenantFromHost("api.rbms.in", "rbms.in")).toBeNull();
    expect(tenantFromHost("raja.example.com", "rbms.in")).toBeNull();
    expect(tenantFromHost("notrbms.in", "rbms.in")).toBeNull();
    expect(tenantFromHost("ab.rbms.in", "rbms.in")).toBeNull();
    expect(tenantFromHost("", "rbms.in")).toBeNull();
    expect(tenantFromHost(null, "rbms.in")).toBeNull();
  });

  it("checks a shop address is 3 to 40 lowercase letters, digits or hyphens", () => {
    expect(isValidShopSlug("raja-stores")).toBe(true);
    expect(isValidShopSlug("ab")).toBe(false);
    expect(isValidShopSlug("Raja")).toBe(false);
    expect(isValidShopSlug("-raja")).toBe(false);
    expect(isValidShopSlug("a".repeat(41))).toBe(false);
    expect(isValidShopSlug("admin")).toBe(false);
  });

  it("uses localhost as the root when nothing is configured", () => {
    expect(rootDomain()).toBe("localhost");
  });
});

describe("who may do what in a shop", () => {
  const me = (tenantRoles: string[], platformRoles: string[] = []): MeResponse => ({ user: { id: "u1", platformRoles } as never, tenantRoles });

  it("lets owners, admins and staff in, and only owners and admins manage", () => {
    expect(hasShopAccess(me(["staff"]))).toBe(true);
    expect(canManageShop(me(["staff"]))).toBe(false);
    expect(canManageShop(me(["admin"]))).toBe(true);
    expect(canManageShop(me(["owner"]))).toBe(true);
    expect(hasShopAccess(me(["customer"]))).toBe(false);
    expect(hasShopAccess(null)).toBe(false);
    expect(canManageShop(undefined)).toBe(false);
  });

  it("treats a platform super-admin as an owner of every shop", () => {
    expect(isSuperAdmin({ platformRoles: ["superadmin"] })).toBe(true);
    expect(isSuperAdmin({ platformRoles: [] })).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
    expect(effectiveRoles(me(["staff"], ["superadmin"]))).toEqual(["owner", "staff"]);
    expect(effectiveRoles(me(["owner"], ["superadmin"]))).toEqual(["owner"]);
    expect(canManageShop(me([], ["superadmin"]))).toBe(true);
    expect(effectiveRoles(null)).toEqual([]);
  });

  it("names a person by name, then email, then phone", () => {
    expect(displayName({ name: "Ravi", email: "r@x.in", phone: "1" })).toBe("Ravi");
    expect(displayName({ name: null, email: "r@x.in", phone: "1" })).toBe("r@x.in");
    expect(displayName({ name: "", email: null, phone: "+919876543210" })).toBe("+919876543210");
    expect(displayName(null)).toBe("—");
    expect(displayName(undefined, "Guest")).toBe("Guest");
  });
});

describe("error messages a shopkeeper reads", () => {
  it("says the network is down for status 0", () => {
    expect(describeError(new ApiError(0, "network_error", "Failed to fetch"), t)).toBe("Can't reach the server. Check your internet connection.");
  });

  it("explains plan limits: with a count, for a feature, for a module, or plain", () => {
    expect(describeError(new ApiError(402, "plan_limit", "x", { limit: 50 }), t)).toBe("Monthly limit reached for your plan (50)");
    expect(describeError(new ApiError(402, "plan_limit", "x"), t)).toBe("Monthly limit reached for your plan");
    expect(describeError(new ApiError(402, "plan_limit", "x", { feature: "gst-reports" }), t)).toBe("This feature isn't included in your shop's plan.");
    expect(describeError(new ApiError(402, "plan_limit", "x", { module: "pos" }), t)).toBe("This isn't included in your shop's plan. Ask the owner to upgrade.");
    // A 402 is a plan limit whatever its code.
    expect(isPlanLimit(new ApiError(402, "other", "x"))).toBe(true);
    expect(isPlanLimit(new ApiError(400, "plan_limit", "x"))).toBe(true);
    expect(isPlanLimit(new ApiError(400, "bad", "x"))).toBe(false);
    expect(isPlanLimit(new Error("x"))).toBe(false);
  });

  it("tells a feature turned off by the shop from one the plan lacks", () => {
    const off = (reason?: string) => new ApiError(403, "feature_disabled", "x", reason ? { reason } : undefined);
    expect(isFeatureDisabled(off())).toBe(true);
    expect(describeError(off("shop"), t)).toBe("This feature is turned off for your shop. The owner can turn it on in Settings → Features.");
    expect(describeError(off("plan"), t)).toBe("This feature isn't available for your shop.");
  });

  it("uses the module's own message for a known error code, before the server's text", () => {
    setErrorNamespaces(["billing"]);
    expect(describeError(new ApiError(409, "credit_limit", "Server says no"), t)).toBe("Credit limit reached.");
    expect(describeError(new ApiError(409, "unknown_code", "Server says no"), t)).toBe("Server says no");
  });

  it("falls back to the permission message for 403, the server's words, then a generic line", () => {
    expect(describeError(new ApiError(403, "forbidden", ""), t)).toBe("You don't have permission to do this.");
    expect(describeError(new ApiError(500, "boom", ""), t)).toBe("Something went wrong. Please try again.");
    expect(describeError(new Error("Disk full"), t)).toBe("Disk full");
    expect(describeError("weird", t)).toBe("Something went wrong. Please try again.");
    expect(describeError(new ApiError(0, "network_error", ""), tta)).toBe(webMessages.ta["web.errors.network"]);
  });

  it("translates a key when it exists and uses the fallback when not", () => {
    expect(tOr(t, "web.errors.generic", "x")).toBe("Something went wrong. Please try again.");
    expect(tOr(t, "no.such.key", "Fallback")).toBe("Fallback");
  });
});

describe("text helpers", () => {
  it("shows paise as rupees without .00 for whole rupees", () => {
    expect(formatPaise(149_900)).toBe("₹1,499");
    expect(formatPaise(10_000_000)).toBe("₹1,00,000");
    expect(formatPaise(null)).toBe("₹0");
  });

  // BUG: format.ts:22 drops the trailing zero, so ₹1,499.50 shows as "₹1,499.5" (plan prices in upgrade dialog, invoices, add-ons).
  it.fails("shows half-rupee paise with two digits, ₹1,499.50", () => {
    expect(formatPaise(149_950)).toBe("₹1,499.50");
  });

  it("turns a feature key into a readable label", () => {
    expect(humanizeKey("invoices.credit-book")).toBe("Invoices credit book");
    expect(humanizeKey("gst_reports")).toBe("Gst reports");
    expect(humanizeKey("___")).toBe("___");
  });

  it("normalises sign-in targets: Indian mobile with +91, email lowercased, else invalid", () => {
    expect(normalizeTarget("98765 43210")).toEqual({ target: "+919876543210", kind: "phone" });
    expect(normalizeTarget("Ravi@Shop.IN")).toEqual({ target: "ravi@shop.in", kind: "email" });
    expect(normalizeTarget("1234567890").kind).toBe("invalid");
  });
});

describe("remembered choices on this device", () => {
  function fakeBrowser(initial: Record<string, string> = {}, host = "raja.localhost:3001") {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal("window", {
      location: { host },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    return store;
  }

  it("reads, writes and clears a stored value, and survives blocked storage", () => {
    const store = fakeBrowser();
    writeStored("sr_locale", "ta");
    expect(readStored("sr_locale")).toBe("ta");
    expect(store.get("sr_locale")).toBe("ta");
    writeStored("sr_locale", null);
    expect(readStored("sr_locale")).toBeNull();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => undefined,
      },
    });
    expect(readStored("sr_locale")).toBeNull();
    expect(() => writeStored("sr_locale", "en")).not.toThrow();
  });

  it("remembers the branch per shop, and ignores an odd stored value", () => {
    const store = fakeBrowser({}, "raja.localhost:3001");
    setStoredBranch("br_1", "raja");
    expect(store.get(branchKey("raja"))).toBe("br_1");
    expect(getStoredBranch("raja")).toBe("br_1");
    expect(getStoredBranch("kumar")).toBeNull();
    // With no slug given the current address names the shop.
    expect(getStoredBranch()).toBe("br_1");
    store.set(branchKey("raja"), "bad value!");
    expect(getStoredBranch("raja")).toBeNull();
    setStoredBranch(null, "raja");
    expect(store.has(branchKey("raja"))).toBe(false);
    expect(getStoredBranch(null)).toBeNull();
  });
});
