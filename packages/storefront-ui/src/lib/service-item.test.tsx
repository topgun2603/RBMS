import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Product, ProductSummary } from "../types";
import { translatorFor } from "./messages";
import { stripLeadingHeading } from "./markdown";
import { bookHref, categoryKinds, countLabel, durationLabel, listKind, serviceAction, whatsappHref } from "./service-item";

const t = translatorFor("en");
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

let cardButton = "always";
vi.mock("../client/store-context", async (orig) => ({
  ...(await orig<typeof import("../client/store-context")>()),
  useStore: () => ({
    t,
    shell: { open: true, whatsapp: "+91 98765 00006", contactPhone: "", theme: { card: "standard", cardHover: "none", cardButton, compare: "off" } },
    quickView: { open: () => {} },
    cart: {},
  }),
}));
vi.mock("../client/card-stock", () => ({ useCardStock: () => null }));
vi.mock("../client/wishlist", () => ({ WishlistHeart: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("service=s2,nope"), useRouter: () => ({ push() {} }), usePathname: () => "/book" }));

const { ServicePanel } = await import("../components/service-panel");
const { ProductCardView, ProductRowView } = await import("../client/product-card");
const { preselected } = await import("../client/booking-wizard");

const summary = (over: Partial<ProductSummary> = {}): ProductSummary => ({
  id: "p1",
  name: "Women's haircut & finish",
  slug: "womens-haircut",
  categoryId: "c1",
  categoryName: "Hair cuts",
  image: null,
  priceMin: 90000,
  priceMax: 90000,
  mrp: null,
  variantCount: 1,
  taxInclusive: true,
  variantIds: ["v1"],
  ...over,
});

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Women's haircut & finish",
  slug: "womens-haircut",
  description: null,
  brand: null,
  categoryId: "c1",
  categoryName: "Hair cuts",
  categorySlug: "hair-cuts",
  hsn: "999721",
  gstRate: 18,
  unit: "service",
  taxInclusive: true,
  tags: [],
  attributes: {},
  options: [],
  images: [],
  seo: null,
  priceMin: 90000,
  priceMax: 90000,
  variants: [{ id: "v1", productId: "p1", sku: null, barcode: null, title: "", optionValues: {}, price: 90000, mrp: null, weightGrams: null, position: 0, isDefault: true }] as Product["variants"],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  kind: "service",
  service: { serviceId: "s1", durationMin: 45, bookable: true },
  ...over,
});

describe("service helpers", () => {
  it("books online when bookable, else enquires on WhatsApp / phone / contact", () => {
    expect(serviceAction({ name: "Cut", kind: "service", service: { serviceId: "s 1", durationMin: 30, bookable: true } }, {}, t)).toEqual({ kind: "book", href: "/book?service=s%201" });
    const wa = serviceAction({ name: "Bridal makeup", kind: "service", service: { serviceId: "s1", durationMin: 60, bookable: false } }, { whatsapp: "+91 98765 00006" }, t);
    expect(wa).toMatchObject({ kind: "enquire", external: true });
    expect(wa.href).toMatch(/^https:\/\/wa\.me\/919876500006\?text=.*Bridal%20makeup/);
    expect(serviceAction({ name: "x", kind: "service", service: null }, { phone: "98430 12580" }, t).href).toMatch(/^https:\/\/wa\.me\/919843012580/);
    expect(serviceAction({ name: "x", kind: "service" }, {}, t)).toEqual({ kind: "enquire", href: "/contact", external: false });
    expect(whatsappHref("123", "hi")).toBeNull();
    expect(bookHref(null)).toBe("/book");
  });

  it("formats durations and counts lists by what they hold", () => {
    expect(durationLabel(45, t)).toBe("45 min");
    expect(durationLabel(60, t)).toBe("1 hr");
    expect(durationLabel(90, t)).toBe("1 hr 30 min");
    expect(durationLabel(0, t)).toBeNull();
    const svc = { kind: "service" as const };
    const prod = { kind: "product" as const };
    expect(listKind([svc, svc])).toBe("services");
    expect(listKind([svc, prod])).toBe("items");
    expect(listKind([prod, {}])).toBe("products");
    expect(countLabel(8, "services", t)).toBe("8 services");
    expect(countLabel(1, "services", t)).toBe("1 service");
    expect(countLabel(20, "items", t)).toBe("20 items");
    expect(countLabel(3, "products", t)).toBe("3 products");
    expect([...categoryKinds([{ ...svc, categoryId: "a" }, { ...prod, categoryId: "b" }, { ...svc, categoryId: "b" }, { ...svc, categoryId: null }])]).toEqual([
      ["a", "services"],
      ["b", "items"],
    ]);
  });

  it("the booking wizard preselects ?service= ids the shop offers", () => {
    expect(preselected("s2,nope,s2", [{ id: "s1" }, { id: "s2" }])).toEqual(["s2"]);
    expect(preselected(null, [{ id: "s1" }])).toEqual([]);
  });
});

describe("service page panel", () => {
  it("bookable: duration, price and Book now → /book?service=, how booking works, no cart / delivery", () => {
    const out = html(<ServicePanel product={product()} t={t} contact={{ whatsapp: "+919876500006" }} />);
    expect(out).toContain('href="/book?service=s1"');
    expect(out).toContain("Book now");
    expect(out).toContain("Takes about 45 min");
    expect(out).toContain("How booking works");
    expect(out).toContain("₹900");
    expect(out).not.toMatch(/Add to cart|Buy now|In stock|PIN|pincode|Shipping/i);
  });

  it("varying price says from; consultation-only shows Enquire on WhatsApp; falls back to the Duration detail", () => {
    const out = html(
      <ServicePanel product={product({ priceMax: 150000, service: { serviceId: "s1", durationMin: null, bookable: false }, attributes: { Duration: "1 hr" } })} t={t} contact={{ whatsapp: "+919876500006" }} />,
    );
    expect(out).toContain("from ₹900");
    expect(out).toContain("Enquire on WhatsApp");
    expect(out).toContain('href="https://wa.me/919876500006');
    expect(out).toContain("Takes about 1 hr");
    expect(out).not.toContain("/book");
  });
});

describe("service cards", () => {
  it("show Book (a link, no quick add / quick view) for bookable services", () => {
    const out = html(<ProductCardView product={summary({ kind: "service", service: { serviceId: "s1", durationMin: 45, bookable: true } })} />);
    expect(out).toContain('href="/book?service=s1"');
    expect(out).toContain(">Book<");
    expect(out).not.toContain('data-testid="quick-add"');
    expect(out).not.toContain("quick-view-button");
  });

  it("show Enquire for services that can't be booked online; products keep Add to cart", () => {
    const out = html(<ProductRowView product={summary({ kind: "service", service: { serviceId: null, durationMin: null, bookable: false } })} />);
    expect(out).toContain('data-service-action="enquire"');
    expect(out).toContain("https://wa.me/919876500006");
    const prod = html(<ProductCardView product={summary({ kind: "product" })} />);
    expect(prod).toContain('data-testid="quick-add"');
    expect(prod).toContain("Add to cart");
    cardButton = "hover";
    const hover = html(<ProductCardView product={summary({ kind: "service", service: { serviceId: "s1", durationMin: 45, bookable: true } })} />);
    expect(hover.match(/href="\/book\?service=s1"/g)?.length).toBe(2); // the hover bar and the touch button
    cardButton = "always";
  });
});

describe("policy headings", () => {
  it("drops a leading heading that repeats the section title", () => {
    expect(stripLeadingHeading("## Shipping\n\nEvery order is packed by hand.", ["Shipping policy"])).toBe("Every order is packed by hand.");
    expect(stripLeadingHeading("## Returns & exchanges\n\nWe want you to love it.", ["Returns & refunds"])).toBe("We want you to love it.");
    expect(stripLeadingHeading("**Shipping policy**\nWithin 2 days.", ["Shipping policy"])).toBe("Within 2 days.");
    expect(stripLeadingHeading("# Our Privacy Policy\nWe collect…", ["Privacy policy"])).toBe("We collect…");
  });

  it("keeps other headings and inline bold starts", () => {
    expect(stripLeadingHeading("## Delivery areas\n\nCoimbatore only.", ["Returns & refunds"])).toBe("## Delivery areas\n\nCoimbatore only.");
    expect(stripLeadingHeading("**Products:** unopened products can be returned.", ["Returns & refunds", "returns"])).toBe("**Products:** unopened products can be returned.");
    expect(stripLeadingHeading("Plain text.", ["Shipping"])).toBe("Plain text.");
    expect(stripLeadingHeading(null, ["Shipping"])).toBe("");
  });
});
