import { afterEach, describe, expect, it, vi } from "vitest";
import { APPAREL_FOOTWEAR_GST_RULE } from "@rbms/gst";
import { e164, fmtExpiry, mobileDigits, money, moneyShort, paiseToInput, parseQty, rupeesToPaise } from "./format";
import { fromBillingItem, fromLookup, fromVariant, itemName, looksLikeCode, sellableVariants } from "./products";
import { closeDay, dropHold, expectedCash, holdBill, MAX_HOLDS, MAX_RECENT, openDay, pushRecent, recordSale, salesByMethod, storageKey, toggleFavourite, type DayRecord, type LocalSale } from "./storage";
import { migrateLocalDay, tillReportPath, zLabel, type TillSession } from "./till";
import { batchSpill } from "./batches";
import { matchCustomers } from "./offline/customers";
import { failureKey } from "./printing";
import type { CartProduct } from "./cart";

const product = (id: string, over: Partial<CartProduct> = {}): CartProduct => ({ itemId: id, name: `Item ${id}`, unit: "pcs", price: 10_000, taxInclusive: true, gstRate: 5, ...over });

describe("counter money and numbers", () => {
  it("shows whole rupees without .00 and keeps paise when there are some", () => {
    expect(moneyShort(50_000)).toBe("₹500");
    expect(moneyShort(50_050)).toBe("₹500.50");
    expect(moneyShort(123_456_700)).toBe("₹12,34,567");
    expect(money(null)).toBe("₹0.00");
  });

  it("reads typed rupees to at most two decimals", () => {
    expect(rupeesToPaise("₹ 99")).toBe(9900);
    expect(rupeesToPaise("12,500.50")).toBe(1_250_050);
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("-1")).toBeNull();
    expect(paiseToInput(250)).toBe("2.5");
  });

  it("reads a quantity of up to three decimals and refuses zero", () => {
    expect(parseQty("0.250")).toBe(0.25);
    expect(parseQty("0")).toBeNull();
    expect(parseQty("1.2345")).toBeNull();
    expect(parseQty("abc")).toBeNull();
  });

  it("pulls the 10-digit mobile out of the ways people type it", () => {
    expect(mobileDigits("+91 98765 43210")).toBe("9876543210");
    expect(mobileDigits("09876543210")).toBe("9876543210");
    expect(mobileDigits("919876543210")).toBe("9876543210");
    expect(mobileDigits("5876543210")).toBeNull();
    expect(mobileDigits("98765")).toBeNull();
    expect(mobileDigits(null)).toBeNull();
    expect(e164("98765-43210")).toBe("+919876543210");
    expect(e164("12345")).toBeNull();
  });

  it("shows an expiry in the app's date style, a dash for none, and junk as typed", () => {
    expect(fmtExpiry("2027-01-31")).toBe("31 Jan 2027");
    expect(fmtExpiry(null)).toBe("—");
    expect(fmtExpiry("soon")).toBe("soon");
  });
});

describe("products into the cart", () => {
  it("names a variant after its product, or just the product when the variant is unnamed", () => {
    expect(itemName("Kurta", "M / Red")).toBe("Kurta – M / Red");
    expect(itemName("Kurta", "  ")).toBe("Kurta");
  });

  it("keeps the catalogue price, tax mode and GST rate from a scanned barcode", () => {
    const p = fromLookup({ id: "v1", productId: "p1", name: "", productName: "Kurta", title: "M", sku: "K-M", barcode: "8901", hsn: "6104", unit: "", rate: 47_619, price: 50_000, taxInclusive: true, gstRate: 5, image: null, mrp: 60_000, optionValues: {}, isDefault: true, status: "active" });
    expect(p).toMatchObject({ itemId: "v1", productId: "p1", name: "Kurta – M", unit: "pcs", price: 50_000, taxInclusive: true, gstRate: 5, hsn: "6104" });
    expect(p).not.toHaveProperty("units");
  });

  it("sells a box as one box at the box price when the box's barcode was scanned", () => {
    const base = { id: "v1", productId: "p1", name: "Biscuits", productName: "Biscuits", title: "", sku: null, barcode: null, hsn: null, unit: "pcs", rate: 1000, price: 1000, taxInclusive: false, gstRate: 18, image: null, mrp: null, optionValues: {}, isDefault: true, status: "active" };
    const units = [{ unit: "box", factor: 12, barcode: "890BOX", ownPrice: 11_000, price: 11_000, rate: 11_000, mrp: null }];
    const loose = fromLookup({ ...base, units });
    expect(loose).toMatchObject({ unit: "pcs", price: 1000, baseUnit: "pcs", basePrice: 1000 });
    const box = fromLookup({ ...base, units, scannedUnit: "box" });
    expect(box).toMatchObject({ unit: "box", price: 11_000, baseUnit: "pcs" });
  });

  it("re-bands a price-band product by the price it is sold at, as exclusive or inclusive", () => {
    const base = { id: "p1", name: "Kurta", hsn: "6104", unit: "pcs", gstRate: 5, taxInclusive: false, gstRule: APPAREL_FOOTWEAR_GST_RULE, images: [{ url: "/a.jpg" }] };
    const v = (price: number) => ({ id: "v", title: "M", sku: null, barcode: null, price, isDefault: true }) as never;
    expect(fromVariant(base as never, v(250_000)).gstRate).toBe(5);
    expect(fromVariant(base as never, v(250_001)).gstRate).toBe(18);
    // Inclusive: up to ₹2,625 is 5%, above ₹2,950 is 18%, the band between charges the higher rate.
    const inc = { ...base, taxInclusive: true };
    expect(fromVariant(inc as never, v(262_500)).gstRate).toBe(5);
    expect(fromVariant(inc as never, v(280_000)).gstRate).toBe(18);
    expect(fromVariant(inc as never, v(295_001)).gstRate).toBe(18);
    expect(fromVariant(inc as never, v(250_000))).toMatchObject({ name: "Kurta – M", image: "/a.jpg" });
    // A flat-rate product keeps its own rate.
    expect(fromVariant({ ...base, gstRule: null, gstRate: 12 } as never, v(900_000)).gstRate).toBe(12);
  });

  it("treats a billing item's rate as GST-exclusive", () => {
    expect(fromBillingItem({ id: "i1", name: "Bolt", hsn: "7318", unit: "", rate: 1250, gstRate: 18 } as never)).toEqual({ itemId: "i1", name: "Bolt", hsn: "7318", unit: "pcs", price: 1250, taxInclusive: false, gstRate: 18 });
  });

  it("lists the default variant first and recognises a code typed into search", () => {
    expect(sellableVariants({ variants: [{ id: "a", isDefault: false }, { id: "b", isDefault: true }, { id: "c", isDefault: false }] } as never).map((v) => v.id)).toEqual(["b", "a", "c"]);
    expect(looksLikeCode("8901234567890")).toBe(true);
    expect(looksLikeCode("SKU-1234")).toBe(true);
    expect(looksLikeCode("red kurta")).toBe(false);
    expect(looksLikeCode("rice")).toBe(false);
    expect(looksLikeCode("a1")).toBe(false);
  });
});

describe("held bills, recent items and the legacy day", () => {
  it("keeps the newest 30 held bills and drops one by id", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    let holds = holdBill([], { name: "A", note: "", lines: [], customer: { kind: "none" } as never, total: 100 }, now);
    expect(holds[0]).toMatchObject({ name: "A", createdAt: "2026-11-05T10:00:00.000Z" });
    for (let i = 0; i < 35; i++) holds = holdBill(holds, { name: `H${i}`, note: "", lines: [], customer: { kind: "none" } as never, total: 1 }, now);
    expect(holds).toHaveLength(MAX_HOLDS);
    expect(holds[0]!.name).toBe("H34");
    expect(dropHold(holds, holds[0]!.id)).toHaveLength(MAX_HOLDS - 1);
  });

  it("puts the latest item first without a repeat, up to 24", () => {
    const out = pushRecent([product("a"), product("b"), product("c")], product("b", { price: 99 }));
    expect(out.map((p) => p.itemId)).toEqual(["b", "a", "c"]);
    expect(out[0]!.price).toBe(99);
    const many = Array.from({ length: 30 }, (_, i) => product(`i${i}`));
    expect(pushRecent(many, product("new"))).toHaveLength(MAX_RECENT);
  });

  it("adds an item to favourites, and taps it off again", () => {
    expect(toggleFavourite([product("a")], product("b")).map((p) => p.itemId)).toEqual(["a", "b"]);
    expect(toggleFavourite([product("a"), product("b")], product("a")).map((p) => p.itemId)).toEqual(["b"]);
  });

  const sale = (id: string, payments: [string, number][], credit = 0): LocalSale => ({ id, number: id, total: 0, at: "", payments: payments.map(([method, amount]) => ({ method, amount })), credit, customer: "" });

  it("adds up the day's takings by method, with credit sales counted as credit", () => {
    const day = { sales: [sale("1", [["cash", 50_000], ["upi", 20_000]]), sale("2", [["cash", 10_000]], 5_000), sale("3", [], 7_000)] };
    expect(salesByMethod(day)).toEqual({ cash: 60_000, upi: 20_000, credit: 12_000 });
  });

  it("works out cash that should be in the drawer: float, cash sales, then cash in and out", () => {
    const day = { openingCash: 200_000, sales: [sale("1", [["cash", 50_000], ["upi", 99_000]])], cashMoves: [{ at: "", amount: -15_000, note: "tea" }, { at: "", amount: 30_000, note: "float" }] };
    // 2000 + 500 - 150 + 300 = 2650
    expect(expectedCash(day)).toBe(265_000);
  });

  it("opens a day with a non-negative whole-paise float and ignores sales on a closed day", () => {
    const now = new Date("2026-11-05T03:00:00Z");
    expect(openDay("2026-11-05", -500, "Ravi", now).openingCash).toBe(0);
    expect(openDay("2026-11-05", 1000.4, "Ravi", now)).toMatchObject({ openingCash: 1000, openedBy: "Ravi", sales: [], cashMoves: [] });
    const day = openDay("2026-11-05", 100_000, "Ravi", now);
    expect(recordSale(day, sale("1", [["cash", 5_000]]))!.sales).toHaveLength(1);
    const closed = closeDay(day, { 500: 2 }, "ok", now);
    expect(recordSale(closed, sale("2", [["cash", 1]]))).toBe(closed);
    expect(recordSale(null, sale("3", []))).toBeNull();
  });

  it("closes the day with the counted cash against what was expected", () => {
    const day: DayRecord = { ...openDay("2026-11-05", 100_000, "Ravi"), sales: [sale("1", [["cash", 50_000]])] };
    const closed = closeDay(day, { 500: 2, 100: 4, 10: 3 }, "short by 20");
    // Counted: 1000 + 400 + 30 = ₹1,430; expected ₹1,000 + ₹500 = ₹1,500.
    expect(closed).toMatchObject({ closingCash: 143_000, expectedCash: 150_000, note: "short by 20" });
    expect(closed.closedAt).toBeTruthy();
  });

  it("namespaces device storage by kind, shop and cashier", () => {
    expect(storageKey("holds", "murugan", "ravi")).toBe("sr_pos:holds:murugan:ravi");
    expect(storageKey("register", null)).toBe("sr_pos:register:-");
    expect(storageKey("till", "murugan", null)).toBe("sr_pos:till:murugan:-");
  });
});

describe("till labels and the one-time move to server tills", () => {
  const sess = (over: Partial<TillSession> = {}) => ({ id: "s1", status: "open", zNumber: null, ...over }) as TillSession;

  afterEach(() => vi.unstubAllGlobals());

  it("calls a closed session by its Z number and anything else X", () => {
    expect(zLabel({ status: "closed", zNumber: 7 })).toBe("Z7");
    expect(zLabel({ status: "open", zNumber: null })).toBe("X");
    expect(zLabel({ status: "closed", zNumber: null })).toBe("X");
  });

  it("points the report PDF at the paper width", () => {
    expect(tillReportPath("s1")).toBe("/documents/till-z/s1.pdf");
    expect(tillReportPath("s1", "58")).toBe("/documents/till-z-58/s1.pdf");
    expect(tillReportPath("s1", "a4")).toBe("/documents/till-z-a4/s1.pdf");
  });

  /** A localStorage that lives in a Map, so the device-only day can be read like on a counter. */
  function fakeBrowser(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      dispatchEvent: () => true,
    });
    return store;
  }
  const dayKey = storageKey("day", "murugan", "BR1");
  const opts = (over: object = {}) => {
    const calls: string[] = [];
    return {
      calls,
      o: {
        tenant: "murugan",
        branchCode: "BR1",
        register: "Counter 1",
        today: "2026-11-05",
        actorName: "Ravi",
        hasServerSession: false,
        open: vi.fn(async (b: { openingCash?: number; actorName: string }) => (calls.push(`open ${b.openingCash} ${b.actorName}`), sess())),
        cash: vi.fn(async (b: { amount: number; reason: string }) => (calls.push(`cash ${b.amount} ${b.reason}`), sess())),
        ...over,
      },
    };
  };

  it("does nothing when the counter kept no old day", async () => {
    fakeBrowser();
    const { o, calls } = opts();
    expect(await migrateLocalDay(o)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("carries today's open day to the server with its float and cash moves, then forgets it", async () => {
    const day: DayRecord = { ...openDay("2026-11-05", 150_000, "Meena"), cashMoves: [{ at: "", amount: -5_000, note: "tea" }, { at: "", amount: 0, note: "nothing" }, { at: "", amount: 20_000, note: "" }] };
    const store = fakeBrowser({ [dayKey]: JSON.stringify(day) });
    const { o, calls } = opts();
    expect(await migrateLocalDay(o)).toBe("migrated");
    expect(calls).toEqual(["open 150000 Meena", "cash -5000 tea", "cash 20000 "]);
    expect(store.has(dayKey)).toBe(false);
  });

  it("drops an old day (other date, already closed, or the server already has one) without opening anything", async () => {
    for (const [day, hasServerSession] of [
      [openDay("2026-11-04", 100, "x"), false],
      [{ ...openDay("2026-11-05", 100, "x"), closedAt: "2026-11-05T12:00:00Z" }, false],
      [openDay("2026-11-05", 100, "x"), true],
    ] as const) {
      const store = fakeBrowser({ [dayKey]: JSON.stringify(day) });
      const { o, calls } = opts({ hasServerSession });
      expect(await migrateLocalDay(o)).toBe("dropped");
      expect(calls).toEqual([]);
      expect(store.has(dayKey)).toBe(false);
    }
  });
});

describe("batches, offline customers and printer errors", () => {
  it("says how much of a line the chosen batch can't cover", () => {
    expect(batchSpill({ qty: 5, batch: { qty: 3 } } as never)).toBe(2);
    expect(batchSpill({ qty: 2.5, batch: { qty: 1.2 } } as never)).toBe(1.3);
    expect(batchSpill({ qty: 3, batch: { qty: 3 } } as never)).toBe(0);
    expect(batchSpill({ qty: 3, batch: { qty: 0 } } as never)).toBe(3);
    // No batch chosen, or its stock is unknown.
    expect(batchSpill({ qty: 3 } as never)).toBe(0);
    expect(batchSpill({ qty: 3, batch: {} } as never)).toBe(0);
  });

  const cached = (id: string, name: string, phone: string | null) => ({ id, name, phone, email: null, gstin: null, stateCode: null, creditLimit: null, outstanding: 0, advance: 0, seenAt: 1 });
  const all = [cached("1", "Ravi Kumar", "+91 98765 43210"), cached("2", "Meena Stores", "9123456780"), cached("3", "José", null)];

  it("finds a remembered customer by name part or by 3+ digits of the mobile, without the cache's bookkeeping field", () => {
    expect(matchCustomers(all, "ravi").map((c) => c.id)).toEqual(["1"]);
    expect(matchCustomers(all, "STORES").map((c) => c.id)).toEqual(["2"]);
    expect(matchCustomers(all, "43210").map((c) => c.id)).toEqual(["1"]);
    expect(matchCustomers(all, "jose").map((c) => c.id)).toEqual(["3"]);
    expect(matchCustomers(all, "98")).toEqual([]);
    expect(matchCustomers(all, "  ")).toEqual([]);
    expect(matchCustomers(all, "ravi")[0]).not.toHaveProperty("seenAt");
    expect(matchCustomers(all, "9", 1)).toEqual([]);
    expect(matchCustomers(Array.from({ length: 10 }, (_, i) => cached(`${i}`, `Ravi ${i}`, null)), "ravi", 3)).toHaveLength(3);
  });

  it("gives each printer failure its own message key and a generic one for the rest", () => {
    expect(failureKey("not_paired")).toBe("pos.printing.err.notPaired");
    expect(failureKey("unsupported")).toBe("pos.printing.err.unsupported");
    expect(failureKey("unsupported_url")).toBe("pos.printing.err.unsupported");
    expect(failureKey("cancelled")).toBe("pos.printing.err.cancelled");
    expect(failureKey("bridge_unreachable")).toBe("pos.printing.err.bridgeDown");
    expect(failureKey("bridge_rejected")).toBe("pos.printing.err.bridgeRejected");
    expect(failureKey("no_endpoint")).toBe("pos.printing.err.noEndpoint");
    expect(failureKey("io" as never)).toBe("pos.printing.err.io");
  });
});
