import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en, ta, translatorFor } from "./messages";
import { offersEn, offersTa } from "./messages-offers";
import { freeDeliveryState, goodsTotal, nudgeText, offerText, sortNudges } from "./offers";
import { isProxyAllowed } from "../server/proxy";
import type { BundleView, CartNudge, PricedCart } from "../types";
import { OfferBadgeList } from "../components/offer-badges";

const t = translatorFor("en");
const tta = translatorFor("ta");
const cartApi = { add: vi.fn(), addBundle: vi.fn(), setMiniOpen: vi.fn() };
vi.mock("../client/store-context", async (orig) => ({
  ...(await orig<typeof import("../client/store-context")>()),
  useStore: () => ({ t, cart: cartApi, shell: { open: true }, locale: "en" }),
}));
vi.mock("@srirealtime/ui/motion", async (orig) => {
  const React = await import("react");
  const pass = ({ children, initial: _i, animate: _a, exit: _e, layout: _l, transition: _t, ...rest }: Record<string, unknown>) => React.createElement("div", rest, children as React.ReactNode);
  return {
    ...(await orig<typeof import("@srirealtime/ui/motion")>()),
    motion: new Proxy({}, { get: () => pass }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    Reveal: ({ children, as: _as, ...rest }: Record<string, unknown>) => React.createElement("section", rest, children as React.ReactNode),
  };
});

const { BundleCard, CartOfferRows, GiftPrompt, LineOfferTag, OfferNudges } = await import("../client/offers");

const cart = (over: Partial<PricedCart> = {}): PricedCart => ({
  token: "t",
  lines: [],
  itemCount: 3,
  subtotal: 159800,
  discount: 0,
  coupon: null,
  offerDiscount: 59900,
  offers: [{ id: "o1", kind: "bxgy", name: "Buy 2 get 1 free", label: "Buy 2 get 1 free", discount: 59900, applications: 1 }],
  nudges: [],
  gifts: [],
  freeShipping: { threshold: 99900, remaining: 0, unlocked: true, scope: "zone" },
  pincode: "600001",
  delivery: null,
  total: 99900,
  warnings: [],
  ...over,
});

describe("offer texts (EN/TA)", () => {
  it("summaries from kind + numbers", () => {
    expect(offerText(t, { kind: "bxgy", label: "", config: { buyQty: 2, getQty: 1, getPercent: 100 } })).toBe("Buy 2 get 1 free");
    expect(offerText(t, { kind: "bxgy", label: "", config: { buyQty: 1, getQty: 1, getPercent: 50 } })).toBe("Buy 1 get 1 at 50% off");
    expect(offerText(t, { kind: "tiered", label: "", config: { basis: "qty", tiers: [{ min: 3, type: "percent", value: 10 }] } })).toBe("Buy 3+ get 10% off");
    expect(offerText(t, { kind: "tiered", label: "", config: { basis: "amount", tiers: [{ min: 99900, type: "flat", value: 10000 }] } })).toBe("Spend ₹999 get ₹100 off");
    expect(offerText(t, { kind: "free_gift", label: "", config: { minAmount: 99900 } })).toBe("Free gift on orders above ₹999");
    expect(offerText(t, { kind: "bundle", label: "", config: { priceType: "fixed", value: 139900, items: [] } })).toBe("Combo for ₹1,399");
    expect(offerText(t, { kind: "mystery", label: "Fallback", config: {} })).toBe("Fallback");
    expect(offerText(tta, { kind: "bxgy", label: "", config: { buyQty: 2, getQty: 1, getPercent: 100 } })).toBe("2 வாங்கினால் 1 இலவசம்");
  });

  it("nudges", () => {
    const n = (over: Partial<CartNudge>): CartNudge => ({ offerId: "x", kind: "bxgy", name: "B2G1", label: "", reward: { type: "units", qty: 1, percent: 100 }, ...over });
    expect(nudgeText(t, n({ addQty: 1 }))).toBe("Add 1 more item to get 1 free");
    expect(nudgeText(t, n({ addQty: 2 }))).toBe("Add 2 more items to get 1 free");
    expect(nudgeText(t, n({ kind: "tiered", addAmount: 20000, reward: { type: "percent", value: 10 } }))).toBe("You're ₹200 away from 10% off");
    expect(nudgeText(t, n({ kind: "tiered", addQty: 1, reward: { type: "percent", value: 15 } }))).toBe("Add 1 more item for 15% off");
    expect(nudgeText(t, n({ kind: "free_gift", addAmount: 15000, reward: { type: "gift", productId: "p", variantId: "v", qty: 1 } }))).toBe("You're ₹150 away from a free gift");
    expect(nudgeText(t, n({ kind: "bundle", name: "Pooja combo", reward: { type: "bundle" } }))).toBe("Complete the Pooja combo and save");
    expect(nudgeText(tta, n({ addQty: 1 }))).toContain("இலவசமாகப்");
    expect(sortNudges([n({ offerId: "a", addAmount: 50000, reward: { type: "percent", value: 5 } }), n({ offerId: "b", addQty: 1 })]).map((x) => x.offerId)).toEqual(["b", "a"]);
  });

  it("keeps EN and TA keys in step", () => {
    expect(Object.keys(offersTa).sort()).toEqual(Object.keys(offersEn).sort());
    for (const k of Object.keys(offersEn)) {
      expect(en[k], k).toBeDefined();
      expect(ta[k], k).toBeDefined();
    }
  });

  it("goods total and free delivery: server state first, older quote rule as fallback", () => {
    expect(goodsTotal(cart())).toBe(99900);
    expect(freeDeliveryState(cart({ freeShipping: { threshold: 149900, remaining: 50000, unlocked: false, scope: "shop" } }))).toEqual({ unlocked: false, remaining: 50000, threshold: 149900, area: false });
    expect(freeDeliveryState(cart({ freeShipping: null }))).toBeNull();
    const old = cart({ freeShipping: undefined, offerDiscount: undefined, offers: undefined, subtotal: 50000, total: 50000, delivery: { serviceable: true, options: [{ id: "s", name: "S", amount: 4000, etaDays: [2, 4], codAllowed: true, codFee: 0, freeAbove: 99900 }] } });
    expect(freeDeliveryState(old)).toMatchObject({ unlocked: false, remaining: 49900 });
  });

  it("the store proxy already lets the cart, promotions and bundles routes through", () => {
    expect(isProxyAllowed("/v1/store/cart/abc/bundle", "POST")).toBe(true);
    expect(isProxyAllowed("/v1/store/promotions")).toBe(true);
    expect(isProxyAllowed("/v1/store/bundles/pooja-combo")).toBe(true);
    // Staff offer CRUD stays off the shop's domain.
    expect(isProxyAllowed("/v1/coupons/offers", "POST")).toBe(false);
  });
});

describe("offer components", () => {
  const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

  it("applied offer rows and the line tag (FREE when the whole line is free)", () => {
    const rows = html(
      <dl>
        <CartOfferRows cart={cart()} />
      </dl>,
    );
    expect(rows).toContain("Buy 2 get 1 free");
    expect(rows).toContain("−₹599");
    expect(html(<LineOfferTag discount={59900} lineTotal={59900} />)).toContain("FREE");
    expect(html(<LineOfferTag discount={12441} lineTotal={99900} />)).toContain("−₹124.41");
    expect(html(<LineOfferTag discount={0} lineTotal={99900} />)).toBe("");
  });

  it("nudges with one-tap add chips, accessible status", () => {
    const c = cart({
      nudges: [
        { offerId: "n1", kind: "bxgy", name: "Buy 2 get 1 free", label: "Buy 2 get 1 free", addQty: 1, reward: { type: "units", qty: 1, percent: 100 }, scope: "products", products: [{ id: "p1", name: "Cotton Palazzo", slug: "cotton-palazzo", image: null, price: 59900, variantId: "v1" }] },
      ],
    });
    const out = html(<OfferNudges cart={c} />);
    expect(out).toContain("Add 1 more item to get 1 free");
    expect(out).toContain('role="status"');
    expect(out).toContain("Cotton Palazzo");
    expect(out).toContain('aria-label="Add to cart: Cotton Palazzo"');
    // Store-wide nudges without products are left to the suggestions row in the mini cart.
    const storeWide = cart({ nudges: [{ offerId: "n2", kind: "bxgy", name: "B2G1", label: "", addQty: 1, reward: { type: "units", qty: 1, percent: 100 }, scope: "all" }] });
    expect(html(<OfferNudges cart={storeWide} skipStoreWide />)).toBe("");
  });

  it("free gift prompt only when unlocked and not in the cart", () => {
    const gift = { offerId: "g", name: "Gift", productId: "p9", variantId: "v9", qty: 1, unlocked: true, inCart: false, remaining: 0, product: { id: "p9", name: "Brass diya", slug: "brass-diya", image: null, price: 15000, variantId: "v9" } };
    expect(html(<GiftPrompt cart={cart({ gifts: [gift] })} />)).toContain("You&#x27;ve unlocked a free gift: Brass diya");
    expect(html(<GiftPrompt cart={cart({ gifts: [{ ...gift, inCart: true }] })} />)).toBe("");
    expect(html(<GiftPrompt cart={cart({ gifts: [{ ...gift, unlocked: false }] })} />)).toBe("");
  });

  it("bundle card: items, option picker, combo price vs separately, saving", () => {
    const b: BundleView = {
      id: "b1",
      slug: "kurti-palazzo",
      name: "Kurti + palazzo combo",
      description: null,
      imageUrl: null,
      label: "Combo for ₹1,399",
      priceType: "fixed",
      value: 139900,
      endsAt: null,
      regular: 159800,
      price: 139900,
      save: 19900,
      available: true,
      items: [
        { productId: "p1", variantId: null, qty: 1, name: "Anarkali Kurti", slug: "anarkali-kurti", image: null, variantTitle: "", price: 99900, options: [{ variantId: "s", title: "S", price: 99900 }, { variantId: "m", title: "M", price: 99900 }], available: true },
        { productId: "p2", variantId: "x", qty: 1, name: "Cotton Palazzo", slug: "cotton-palazzo", image: null, variantTitle: "M", price: 59900, options: [{ variantId: "x", title: "M", price: 59900 }], available: true },
      ],
    };
    const out = html(<BundleCard bundle={b} />);
    expect(out).toContain("Kurti + palazzo combo");
    expect(out).toContain("<select");
    expect(out).toContain("Choose Anarkali Kurti");
    expect(out).toContain("₹1,598");
    expect(out).toContain("₹1,399");
    expect(out).toContain("Save ₹199");
    expect(out).toContain("Add combo to cart");
    // The pick is labelled with the product's option name when the API sends it.
    expect(out).toMatch(/<option value="" disabled=""[^>]*>Option<\/option>/);
    const named = html(<BundleCard bundle={{ ...b, items: b.items.map((i, k) => (k === 0 ? { ...i, optionLabel: "Size" } : i)) }} />);
    expect(named).toMatch(/<option value="" disabled=""[^>]*>Size<\/option>/);
    expect(named).toContain("Choose Size for Anarkali Kurti");
    expect(named).not.toContain(">Option<");
  });

  it("product badges (server-rendered)", () => {
    const out = html(<OfferBadgeList t={t} locale="en" offers={[{ id: "o", kind: "bxgy", name: "B2G1", label: "Buy 2 get 1 free", description: null, config: { buyQty: 2, getQty: 1, getPercent: 100 }, endsAt: "2026-10-31T18:29:59.999Z" }]} />);
    expect(out).toContain("Buy 2 get 1 free");
    expect(out).toContain("Ends 31 Oct");
    expect(out).toContain("Offers on this item");
    expect(html(<OfferBadgeList t={t} locale="en" offers={[]} />)).toBe("");
  });
});
