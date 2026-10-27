import { describe, expect, it } from "vitest";
import { cartTotals, productToLine, type CartProduct } from "./cart";
import { buildDisplayState, createSseParser, DISPLAY_MAX_LINES, DISPLAY_TEXT, displayChannelName, readDisplayState, sameDisplay, savingsOf, type BuildDisplayInput } from "./display";

const product = (over: Partial<CartProduct> = {}): CartProduct => ({ itemId: "i1", name: "Tea powder 250g", unit: "pcs", price: 10_500, taxInclusive: true, gstRate: 5, ...over });
const tax = { sellerState: "33", placeOfSupply: "33" };

const input = (over: Partial<BuildDisplayInput> = {}): BuildDisplayInput => {
  const lines = [productToLine(product(), 2), productToLine(product({ itemId: "i2", name: "Sugar 1kg", price: 5_000, gstRate: 0 }), 1)];
  const totals = cartTotals(lines, tax);
  return {
    lines,
    totals,
    payable: totals.total,
    customerName: null,
    paying: false,
    upiAmount: 0,
    upiLink: null,
    sale: null,
    locale: "en",
    shop: { name: "Raja Stores", logoUrl: null },
    now: 1000,
    ...over,
  };
};

describe("buildDisplayState", () => {
  it("shows the lines, the total and the item count while the cashier rings up", () => {
    const s = buildDisplayState(input());
    expect(s.phase).toBe("cart");
    expect(s.lines.map((l) => [l.name, l.qty, l.price])).toEqual([
      ["Tea powder 250g", 2, 10_500],
      ["Sugar 1kg", 1, 5_000],
    ]);
    expect(s.lines[0]!.total).toBe(21_000);
    expect(s.total).toBe(26_000);
    expect(s.itemCount).toBe(3);
    expect(s.upi).toBeNull();
    expect(s.paid).toBeNull();
  });

  it("is idle with an empty cart, and thanks the customer after a sale until the next item", () => {
    expect(buildDisplayState(input({ lines: [], totals: cartTotals([], tax), payable: 0 })).phase).toBe("idle");
    const thanks = buildDisplayState(input({ lines: [], totals: cartTotals([], tax), payable: 0, sale: { total: 26_000, change: 4_000 } }));
    expect(thanks).toMatchObject({ phase: "thanks", total: 26_000, paid: { total: 26_000, change: 4_000 }, lines: [] });
    // The next scanned item takes the screen back to the bill.
    expect(buildDisplayState(input({ sale: { total: 26_000, change: 4_000 } })).phase).toBe("cart");
  });

  it("adds the UPI QR link only while paying by UPI with an amount and a UPI id", () => {
    const link = "upi://pay?pa=raja@upi&pn=Raja&am=260.00&cu=INR";
    expect(buildDisplayState(input({ paying: true, upiAmount: 26_000, upiLink: link }))).toMatchObject({ phase: "pay", upi: { link, amount: 26_000 } });
    expect(buildDisplayState(input({ paying: true, upiAmount: 0, upiLink: link })).upi).toBeNull();
    expect(buildDisplayState(input({ paying: true, upiAmount: 26_000, upiLink: null })).upi).toBeNull();
    expect(buildDisplayState(input({ paying: false, upiAmount: 26_000, upiLink: link })).upi).toBeNull();
  });

  it("carries a saved customer's name only, nothing else about them", () => {
    const s = buildDisplayState(input({ customerName: "  Meena   Kumari " }));
    expect(s.customerName).toBe("Meena Kumari");
    expect(JSON.stringify(s)).not.toMatch(/phone|gstin|address|email/i);
  });

  it("keeps the newest lines when the bill is long and counts the rest", () => {
    const lines = Array.from({ length: DISPLAY_MAX_LINES + 5 }, (_, n) => productToLine(product({ itemId: `i${n}`, name: `Item ${n}` })));
    const s = buildDisplayState(input({ lines, totals: cartTotals(lines, tax) }));
    expect(s.lines).toHaveLength(DISPLAY_MAX_LINES);
    expect(s.more).toBe(5);
    expect(s.lines.at(-1)!.name).toBe(`Item ${DISPLAY_MAX_LINES + 4}`);
  });
});

describe("savingsOf", () => {
  it("adds line discounts, price-list prices under the catalogue price, and points", () => {
    const a = { ...productToLine(product(), 2), price: 9_500, listPrice: 10_500 };
    const b = productToLine(product({ itemId: "i2" }), 1);
    expect(savingsOf([a, b], 1_000, 500)).toBe(1_000 + 2 * 1_000 + 500);
    expect(savingsOf([b], 0)).toBe(0);
  });

  it("is never negative", () => {
    expect(savingsOf([], -50)).toBe(0);
  });
});

describe("sameDisplay", () => {
  it("ignores the clock", () => {
    const a = buildDisplayState(input({ now: 1 }));
    expect(sameDisplay(a, buildDisplayState(input({ now: 2 })))).toBe(true);
    expect(sameDisplay(a, buildDisplayState(input({ now: 2, customerName: "Raja" })))).toBe(false);
    expect(sameDisplay(null, a)).toBe(false);
  });
});

describe("readDisplayState", () => {
  it("round-trips a state through JSON", () => {
    const s = buildDisplayState(input({ paying: true, upiAmount: 26_000, upiLink: "upi://pay?pa=a@b&am=260.00" }));
    expect(readDisplayState(JSON.stringify(s))).toEqual(s);
  });

  it("drops what is not a state and any QR that is not a UPI link", () => {
    expect(readDisplayState("nope")).toBeNull();
    expect(readDisplayState({ phase: "weird", lines: [], total: 0, at: 1 })).toBeNull();
    const s = buildDisplayState(input({ paying: true, upiAmount: 26_000, upiLink: "upi://pay?pa=a@b&am=260.00" }));
    expect(readDisplayState({ ...s, upi: { link: "https://evil.example/pay", amount: 26_000 } })!.upi).toBeNull();
  });
});

describe("createSseParser", () => {
  it("reads messages split across chunks and skips comments", () => {
    const parse = createSseParser();
    expect(parse("retry: 3000\n\nevent: ready\ndata: {\"a\":1}\n\n: pi")).toEqual([{ event: "ready", data: '{"a":1}' }]);
    expect(parse("ng\n\nevent: state\ndata: {\"x\"")).toEqual([]);
    expect(parse(":2}\n\n")).toEqual([{ event: "state", data: '{"x":2}' }]);
  });

  it("joins multi-line data and handles CRLF", () => {
    const parse = createSseParser();
    expect(parse("event: state\r\ndata: a\r\ndata: b\r\n\r\n")).toEqual([{ event: "state", data: "a\nb" }]);
  });
});

describe("display words and channel", () => {
  it("has the same entries in English and Tamil, with plurals", () => {
    expect(Object.keys(DISPLAY_TEXT.ta).sort()).toEqual(Object.keys(DISPLAY_TEXT.en).sort());
    expect(DISPLAY_TEXT.en.items(1)).toBe("1 item");
    expect(DISPLAY_TEXT.en.items(3)).toBe("3 items");
    expect(DISPLAY_TEXT.ta.thankYou).toContain("நன்றி");
  });

  it("names the same-PC channel by shop and register, case-insensitively", () => {
    expect(displayChannelName("t1", " Counter 1 ")).toBe(displayChannelName("t1", "counter 1"));
    expect(displayChannelName("t1", "Counter 1")).not.toBe(displayChannelName("t2", "Counter 1"));
  });
});

describe("displayPath", () => {
  it("finds the display page next to the counter, with or without terminal mode", async () => {
    const { displayPath } = await import("./display");
    expect(displayPath("/pos")).toBe("/pos/display");
    expect(displayPath("/pos/")).toBe("/pos/display");
    expect(displayPath("/pos/terminal")).toBe("/pos/display");
    expect(displayPath("/pos", "Counter 1")).toBe("/pos/display?local=Counter%201");
  });
});
