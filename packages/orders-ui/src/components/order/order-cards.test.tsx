import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { renderText } from "../../testkit";
import { LinesCard } from "./lines-card";
import { OrderProgress } from "./progress";
import { OrderStatusPill, PaymentPill, ShipmentPill } from "../pills";
import { TotalRow } from "../bits";
import { DEFAULT_ORDER_SETTINGS, PREFIX_RE, sampleNumber, withDefaults } from "../../lib/order-settings";
import type { Order, OrderLine } from "../../lib/types";

const lang = vi.hoisted(() => ({ current: "en" as "en" | "ta" }));
vi.mock("@rbms/web", async (orig) => {
  const real = await orig<typeof import("@rbms/web")>();
  const { i18nFor: make } = await import("../../testkit");
  return { ...real, useI18n: () => make(lang.current) };
});

const render = (node: React.ReactElement, locale: "en" | "ta" = "en") => {
  lang.current = locale;
  return renderText(node);
};

/** 2 x ₹500 saree at 5% GST (prices include it), ₹50 coupon, ₹40 delivery. */
const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  variantId: "v1",
  productId: "p1",
  name: "Silk saree – M / Red",
  sku: "SS-M",
  image: null,
  qty: 2,
  unit: "pcs",
  price: 50_000,
  rate: 47_619,
  gstRate: 5,
  hsn: "5007",
  taxInclusive: true,
  discount: 0,
  amount: 100_000,
  taxable: 95_238,
  cgst: 2_381,
  sgst: 2_381,
  igst: 0,
  total: 100_000,
  ...over,
});

const order = (over: Partial<Order> = {}, totals: Partial<Order["totals"]> = {}): Order =>
  ({
    id: "o1",
    number: "ORD/26-27/0001",
    status: "placed",
    paymentStatus: "cod",
    paymentMethod: "cod",
    lines: [line()],
    totals: { subtotal: 100_000, discount: 0, shipping: 0, shippingWaived: 0, taxable: 95_238, cgst: 2_381, sgst: 2_381, igst: 0, roundOff: 0, total: 100_000, sellerState: "33", placeOfSupply: "33", interState: false, ...totals },
    total: 100_000,
    couponCode: null,
    events: [],
    placedAt: "2026-11-01T05:00:00Z",
    confirmedAt: null,
    shippedAt: null,
    deliveredAt: null,
    ...over,
  }) as unknown as Order;

describe("order items and totals", () => {
  it("shows each line's quantity, price, GST and total, and splits the variant out of the name", () => {
    const out = render(<LinesCard order={order()} />);
    expect(out).toContain("Silk saree");
    expect(out).toContain("M / Red");
    expect(out).toContain("SKU SS-M");
    expect(out).toContain("2 × ₹500.00");
    expect(out).toContain("GST 5%");
    expect(out).toContain("₹1,000.00");
    expect(out).toContain("2 items");
  });

  it("shows CGST and SGST within the state, IGST between states, and says whether prices include GST", () => {
    const same = render(<LinesCard order={order()} />);
    expect(same).toContain("CGST ₹23.81");
    expect(same).toContain("SGST ₹23.81");
    expect(same).not.toContain("IGST");
    expect(same).toContain("Prices include GST.");
    const inter = render(<LinesCard order={order({ lines: [line({ taxInclusive: false })] }, { interState: true, cgst: 0, sgst: 0, igst: 4_762 })} />);
    expect(inter).toContain("IGST ₹47.62");
    expect(inter).not.toContain("CGST");
    expect(inter).toContain("GST is added on prices that exclude tax.");
  });

  it("shows the coupon, delivery, COD fee and round-off rows only when they apply", () => {
    const plain = render(<LinesCard order={order()} />);
    expect(plain).not.toContain("Coupon");
    expect(plain).not.toContain("COD charges");
    expect(plain).not.toContain("Round off");
    expect(plain).toContain("Delivery charge Free");
    const full = render(<LinesCard order={order({ couponCode: "DIWALI50" }, { discount: 5_000, shipping: 4_000, codFee: 3_000, roundOff: -50, total: 102_000 })} />);
    expect(full).toContain("Coupon DIWALI50 −₹50.00");
    expect(full).toContain("Delivery charge ₹40.00");
    expect(full).toContain("COD charges ₹30.00");
    expect(full).toContain("Round off −₹0.50");
  });

  it("shows waived delivery as the struck-out charge and Free, and a line's coupon share", () => {
    const out = render(<LinesCard order={order({ lines: [line({ discount: 2_500 })] }, { shippingWaived: 6_000 })} />);
    expect(out).toContain("₹60.00 Free");
    expect(out).toContain("Coupon −₹25.00");
  });

  it("leaves out the unit for pieces and shows it for weights", () => {
    expect(render(<LinesCard order={order({ lines: [line({ qty: 1.5, unit: "kg", price: 8_000, total: 12_000 })] })} />)).toContain("1.5 kg × ₹80.00");
  });

  it("is in Tamil with no raw keys when the language is Tamil", () => {
    const out = render(<LinesCard order={order({ couponCode: "X1" }, { discount: 5_000 })} />, "ta");
    expect(out).toContain("பொருட்கள்");
    expect(out).toContain("டெலிவரி கட்டணம்");
    expect(out).toContain("₹1,000.00");
    expect(out).not.toMatch(/orders\.[a-z]+\./);
  });

  it("lays a total row out as label then value", () => {
    expect(render(<TotalRow label="Total" value="₹10.00" />)).toBe("Total ₹10.00");
  });
});

describe("order progress", () => {
  const steps = (o: Order) => {
    lang.current = "en";
    return o;
  };

  it("lists the five steps in order with the dates reached", () => {
    const out = render(<OrderProgress order={steps(order({ status: "shipped", confirmedAt: "2026-11-02T05:00:00Z", shippedAt: "2026-11-03T05:00:00Z" }))} />);
    expect(out).toMatch(/New.*Confirmed.*Packed.*Shipped.*Delivered/);
    expect(out).toContain("1 Nov");
    expect(out).toContain("2 Nov");
    expect(out).toContain("3 Nov");
    expect(out).not.toContain("Delivered 4 Nov");
  });

  it("marks only the current step as the current one", () => {
    lang.current = "en";

    const html = renderToStaticMarkup(<OrderProgress order={order({ status: "packed" })} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    // A cancelled order has no current step.
    expect(renderToStaticMarkup(<OrderProgress order={order({ status: "cancelled" })} />)).not.toContain("aria-current");
  });
});

describe("order pills", () => {
  it("names every order status", () => {
    const words = { placed: "New", confirmed: "Confirmed", packed: "Packed", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", returned: "Returned" } as const;
    for (const [s, w] of Object.entries(words)) expect(render(<OrderStatusPill status={s as never} />), s).toBe(w);
    expect(render(<OrderStatusPill status="placed" />, "ta")).toBe("புதியது");
  });

  it("names every payment state, a partial refund apart from a full one", () => {
    expect(render(<PaymentPill status="paid" />)).toBe("Paid");
    expect(render(<PaymentPill status="cod" />)).toBe("COD");
    expect(render(<PaymentPill status="pending" />)).toBe("Pending");
    expect(render(<PaymentPill status="refunded" />)).toBe("Refunded");
    expect(render(<PaymentPill status="partially_refunded" />)).toBe("Part refunded");
    expect(render(<PaymentPill status={"failed" as never} />)).toBe("Unpaid");
  });

  it("names shipment states", () => {
    expect(render(<ShipmentPill status="in_transit" />)).toBe("In transit");
    expect(render(<ShipmentPill status="rto" />)).toBe("Returning to shop");
  });
});

describe("order settings", () => {
  it("fills missing server settings from the defaults", () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_ORDER_SETTINGS);
    expect(withDefaults({ prefix: "SHOP", autoConfirm: true })).toEqual({ ...DEFAULT_ORDER_SETTINGS, prefix: "SHOP", autoConfirm: true });
  });

  it("allows 1 to 6 capital letters, digits or hyphens as the order prefix", () => {
    for (const ok of ["ORD", "A", "AB-12", "ABCDEF"]) expect(PREFIX_RE.test(ok), ok).toBe(true);
    for (const bad of ["", "abc", "ABCDEFG", "A B", "A/B"]) expect(PREFIX_RE.test(bad), bad).toBe(false);
  });

  it("shows a sample order number with the financial year, which starts in April", () => {
    expect(sampleNumber("ORD", "2026-11-05")).toBe("ORD/26-27/0001");
    expect(sampleNumber("ORD", "2027-03-31")).toBe("ORD/26-27/0001");
    expect(sampleNumber("ORD", "2027-04-01")).toBe("ORD/27-28/0001");
    expect(sampleNumber("", "2099-12-01")).toBe("ORD/99-00/0001");
  });
});
