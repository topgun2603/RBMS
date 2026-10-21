import { describe, expect, it } from "vitest";
import { money } from "./format";
import { ordersMessages } from "./messages";
import { bundlePreview, draftToInput, offerState, offerSummary, offerToDraft } from "./offers";
import type { Offer } from "./types";

const t = (key: string, vars: Record<string, string | number> = {}) => {
  const msg = (ordersMessages.en as Record<string, string>)[key] ?? key;
  return msg.replace(/\{(\w+)(, plural, one \{# (\w+)\} other \{# (\w+)\})?\}/g, (_m, k: string, plural?: string, one?: string, other?: string) =>
    plural ? `${vars[k]} ${Number(vars[k]) === 1 ? one : other}` : String(vars[k] ?? ""),
  );
};
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";

const offer = (patch: Partial<Offer>): Offer => ({
  id: "o1",
  kind: "bxgy",
  name: "B2G1",
  description: null,
  slug: null,
  imageUrl: null,
  appliesTo: "all",
  targetIds: [],
  config: { buyQty: 2, getQty: 1, getPercent: 100 },
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  channels: ["store"],
  stackable: false,
  combinesWithCoupons: false,
  active: true,
  label: "Buy 2 get 1 free",
  usedCount: 0,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...patch,
});

describe("offer editor draft", () => {
  it("defaults per kind and round-trips an offer", () => {
    const d = offerToDraft(null, "bxgy");
    expect(d).toMatchObject({ buyQty: "2", getQty: "1", getPercent: "100", channels: ["store"], active: true });
    const r = draftToInput({ ...d, name: "Buy 2 get 1" });
    expect(r).toEqual({ ok: true, input: expect.objectContaining({ kind: "bxgy", name: "Buy 2 get 1", config: { buyQty: 2, getQty: 1, getPercent: 100, maxApplications: null }, appliesTo: "all", targetIds: [] }) });
    const back = offerToDraft(offer({ kind: "tiered", config: { basis: "amount", tiers: [{ min: 99900, type: "flat", value: 10000 }] } }));
    expect(back.tiers).toEqual([{ min: "999", type: "flat", value: "100" }]);
  });

  it("converts rupees, sorts tiers, refuses duplicates and bad numbers", () => {
    const d = { ...offerToDraft(null, "tiered"), name: "Bulk", basis: "amount" as const, tiers: [{ min: "1999", type: "percent" as const, value: "10" }, { min: "999", type: "flat" as const, value: "100" }] };
    const r = draftToInput(d);
    expect(r.ok && r.input.config).toEqual({ basis: "amount", tiers: [{ min: 99900, type: "flat", value: 10000 }, { min: 199900, type: "percent", value: 10 }] });
    const dup = draftToInput({ ...d, tiers: [d.tiers[0]!, { ...d.tiers[0]! }] });
    expect(dup.ok === false && dup.errors.tiers).toBe("orders.offers.validation.tierMins");
    const pct = draftToInput({ ...d, tiers: [{ min: "999", type: "percent", value: "150" }] });
    expect(pct.ok === false && pct.errors["tiers.0.value"]).toBe("orders.offers.validation.percent");
  });

  it("free gift and bundle need their items; scope needs targets", () => {
    const g = draftToInput({ ...offerToDraft(null, "free_gift"), name: "Gift", minAmount: "999" });
    expect(g.ok === false && g.errors.gift).toBe("orders.offers.validation.gift");
    const b = draftToInput({ ...offerToDraft(null, "bundle"), name: "Combo", bundleValue: "1399", items: [{ productId: P1, variantId: null, qty: 1, pinned: null }] });
    expect(b.ok === false && b.errors.items).toBe("orders.offers.validation.items");
    const ok = draftToInput({ ...offerToDraft(null, "bundle"), name: "Combo", bundleValue: "1399", items: [{ productId: P1, variantId: null, qty: 1, pinned: null }, { productId: P2, variantId: V1, qty: 2, pinned: V1 }] });
    expect(ok.ok && ok.input.config).toEqual({ priceType: "fixed", value: 139900, items: [{ productId: P1, variantId: null, qty: 1 }, { productId: P2, variantId: V1, qty: 2 }] });
    const scoped = draftToInput({ ...offerToDraft(null, "bxgy"), name: "X", appliesTo: "categories" });
    expect(scoped.ok === false && scoped.errors.targetIds).toBe("orders.offers.validation.targets");
  });

  it("summaries, preview and state", () => {
    expect(offerSummary(t, offer({}))).toBe("Buy 2 get 1 free");
    expect(offerSummary(t, offer({ kind: "tiered", config: { basis: "qty", tiers: [{ min: 3, type: "percent", value: 10 }, { min: 5, type: "percent", value: 15 }] } }))).toBe("3+ items: 10% off · 5+ items: 15% off");
    expect(offerSummary(t, offer({ kind: "bundle", config: { priceType: "fixed", value: 139900, items: [{ productId: P1, variantId: null, qty: 1 }, { productId: P2, variantId: null, qty: 1 }] } }))).toBe(`2 items for ${money(139900)}`);
    expect(bundlePreview({ priceType: "fixed", bundleValue: "1399", items: [{ productId: P1, variantId: null, qty: 1, pinned: null, price: 99900 }, { productId: P2, variantId: null, qty: 1, pinned: null, price: 59900 }] })).toEqual({ regular: 159800, price: 139900, save: 19900 });
    expect(bundlePreview({ priceType: "percent", bundleValue: "10", items: [{ productId: P1, variantId: null, qty: 2, pinned: null, price: 10000 }, { productId: P2, variantId: null, qty: 1, pinned: null }] })).toBeNull();
    expect(offerState(offer({ usageLimit: 1, usedCount: 1 }))).toBe("used_up");
    expect(offerState(offer({ active: false }))).toBe("off");
  });
});
