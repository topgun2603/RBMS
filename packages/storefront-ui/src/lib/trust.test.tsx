import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrustBadges, PaymentIcons } from "../components/trust";
import { translatorFor } from "./messages";
import { paymentMarks, paymentMode, returnsMode, trustAnnouncements, trustItems } from "./trust";
import type { StoreConfig } from "../types";

const en = translatorFor("en");
const ta = translatorFor("ta");

function cfg(businessType: string, returns = "Returns within 7 days.", extra: Partial<StoreConfig> = {}) {
  return { shop: { businessType }, codEnabled: true, policies: { returns }, ...extra } as Pick<StoreConfig, "codEnabled" | "policies" | "trust"> & { shop: { businessType: string } };
}

describe("trade-aware trust badges", () => {
  it("a plain shop with a returns policy: secure payments, COD, easy returns", () => {
    const items = trustItems(cfg("hardware"), en, "en");
    expect(items.map((i) => i.title)).toEqual(["Secure payments", "Cash on delivery", "Easy returns"]);
  });

  it("crackers: pay on confirmation and damaged-replaced, never easy returns", () => {
    const items = trustItems(cfg("crackers", "We can't take back goods once opened."), en, "en");
    const titles = items.map((i) => i.title);
    expect(titles).toContain("Pay on confirmation");
    expect(titles).toContain("Damaged? Replaced");
    expect(titles).not.toContain("Easy returns");
    expect(titles).not.toContain("Secure payments");
    expect(items).toHaveLength(4);
    const lines = trustAnnouncements(cfg("crackers", "x"), en, "en").map((a) => a.text);
    expect(lines.join("|")).toContain("pay after we confirm");
    expect(lines.join("|")).not.toContain("Easy returns");
  });

  it("florist: 'Fresh every morning' first, in Tamil for Tamil shoppers", () => {
    expect(trustItems(cfg("florist_pooja"), en, "en")[0]!.title).toBe("Fresh every morning");
    expect(trustItems(cfg("florist_pooja"), ta, "ta")[0]!.title).toBe("தினமும் காலையில் புதிதாக");
    expect(trustAnnouncements(cfg("florist_pooja"), en, "en")[0]!.text).toMatch(/^Fresh every morning · /);
  });

  it("reads 'no returns' from the policy of a trade without a default", () => {
    expect(returnsMode(cfg("fashion", "Sale items are non-returnable."))).toBe("replace");
    expect(returnsMode(cfg("fashion", "Opened items can't be returned. Sealed, unused items can be exchanged in 7 days."))).toBe("exchange");
    expect(returnsMode(cfg("fashion", "இந்தப் பொருட்களைத் திருப்பித் தர இயலாது."))).toBe("replace");
    expect(returnsMode(cfg("fashion", "Return within 10 days for a refund."))).toBe("easy");
    // A returns policy with exceptions is still a returns policy (Murugan Hardwares).
    expect(returnsMode(cfg("hardware", "Unopened bags can be returned within 7 days with the bill. Cut pipes and tinted paint cannot be returned."))).toBe("easy");
    expect(returnsMode(cfg("fashion", ""))).toBe("none");
  });

  it("booking-only trades: pay at the shop, no COD or returns badges, cash in the payment marks", () => {
    const c = cfg("salon");
    expect(paymentMode(c)).toBe("visit");
    expect(trustItems(c, en, "en").map((i) => i.title)).toEqual(["Pay at the shop"]);
    expect(paymentMarks(c)).toMatchObject({ netbanking: false, cash: true, cod: false });
    const html = renderToStaticMarkup(<PaymentIcons t={en} cod config={c} />);
    expect(html).toContain("Cash");
    expect(html).not.toContain("Net banking");
    expect(html).not.toContain("COD");
  });

  it("website-only trades (school): no payment, COD or returns badges, so no row; the owner's own badges still show", () => {
    expect(trustItems(cfg("school"), en, "en")).toEqual([]);
    expect(trustAnnouncements(cfg("school"), en, "en")).toEqual([]);
    expect(renderToStaticMarkup(<TrustBadges t={en} config={cfg("school")} locale="en" />)).toBe("");
    const own = cfg("school", "x", { trust: { badges: [{ title: "CBSE affiliated", text: "", titleTa: "", textTa: "" }] } });
    expect(trustItems(own, en, "en").map((i) => i.title)).toEqual(["CBSE affiliated"]);
  });

  it("the owner overrides: modes, or their own badges (Tamil when given)", () => {
    const own = cfg("crackers", "x", { trust: { returns: "easy", payment: "online" } });
    expect(trustItems(own, en, "en").map((i) => i.title)).toContain("Easy returns");
    const badges = cfg("hardware", "x", { trust: { badges: [{ title: "Delivery in 2 hours", text: "Within the city", titleTa: "2 மணி நேரத்தில் டெலிவரி", textTa: "" }] } });
    expect(trustItems(badges, en, "en")).toEqual([{ key: "own-0", icon: "check", title: "Delivery in 2 hours", text: "Within the city" }]);
    expect(trustItems(badges, ta, "ta")[0]).toMatchObject({ title: "2 மணி நேரத்தில் டெலிவரி", text: "Within the city" });
    expect(trustAnnouncements(badges, en, "en")).toEqual([{ text: "Delivery in 2 hours · Within the city" }]);
  });

  it("renders in a width-aware grid (no fixed four columns that squeeze words in a narrow buy column)", () => {
    const html = renderToStaticMarkup(<TrustBadges t={en} config={cfg("hardware")} locale="en" compact />);
    expect(html).toContain('class="sf-trust-box"');
    expect(html).toContain('class="sf-trust"');
    expect(html).toContain("--n:3");
    expect(html).toContain("data-compact");
    expect(html).not.toContain("grid-cols-4");
  });
});
