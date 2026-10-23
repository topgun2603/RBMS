import { describe, expect, it, vi } from "vitest";
import { addProduct, toLineInput } from "./cart";
import type { Product } from "./types";
import {
  buildOpeningStock,
  buildProductInput,
  emptyQuickAdd,
  isBarcodeTaken,
  isOpenItem,
  quickAdd,
  shouldOfferQuickAdd,
  validateOpenItem,
  validateQuickAdd,
  type QuickAddDeps,
  type QuickAddForm,
} from "./quick-add";

const form = (o: Partial<QuickAddForm> = {}): QuickAddForm => ({ ...emptyQuickAdd("8901234567890"), name: "Parle-G 80g", price: "10", gstRate: 18, ...o });
const ok = (o: Partial<QuickAddForm> = {}) => {
  const r = validateQuickAdd(form(o));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.values;
};

const created = (id = "v1"): Product => ({
  id: "p1",
  name: "Parle-G 80g",
  hsn: null,
  gstRate: 18,
  unit: "pcs",
  taxInclusive: true,
  status: "active",
  images: [],
  options: [],
  variants: [{ id, sku: null, barcode: "8901234567890", title: "", optionValues: {}, price: 1000, mrp: null, isDefault: true }],
});

describe("quick add form", () => {
  it("defaults to the remembered GST rate, falling back to 18", () => {
    expect(emptyQuickAdd(" 123456 ", { gstRate: 5 })).toMatchObject({ barcode: "123456", gstRate: 5, taxInclusive: true });
    expect(emptyQuickAdd("123456").gstRate).toBe(18);
    expect(emptyQuickAdd("123456", { gstRate: 7 }).gstRate).toBe(18);
  });
  it("converts rupees to paise and reads blanks as none", () => {
    expect(ok({ price: "10.5", mrp: "12", cost: "7.25", qty: "24" })).toMatchObject({ price: 1050, mrp: 1200, cost: 725, qty: 24, categoryId: null });
    expect(ok()).toMatchObject({ mrp: null, cost: null, qty: 0 });
  });
  it("flags bad fields", () => {
    const r = validateQuickAdd(form({ name: " ", price: "10", mrp: "5", qty: "-2", unit: "", gstRate: 7 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["gstRate", "mrp", "name", "qty", "unit"]);
    expect(validateQuickAdd(form({ price: "abc" })).ok).toBe(false);
    expect(validateQuickAdd(form({ barcode: "a b" })).ok).toBe(false);
  });
  it("builds the catalogue and stock bodies", () => {
    const v = ok({ price: "10", mrp: "12", cost: "7", qty: "5", categoryId: "c1" });
    expect(buildProductInput(v)).toEqual({ name: "Parle-G 80g", unit: "pcs", gstRate: 18, taxInclusive: true, status: "active", categoryId: "c1", price: 1000, barcode: "8901234567890", mrp: 1200, cost: 700 });
    expect(buildProductInput(ok())).not.toHaveProperty("mrp");
    expect(buildOpeningStock(v)).toMatchObject({ mode: "add", qty: 5, unitCost: 700 });
  });
});

describe("quickAdd", () => {
  const deps = (o: Partial<QuickAddDeps> = {}): QuickAddDeps => ({
    createProduct: vi.fn(async () => created()),
    lookup: vi.fn(async () => null),
    adjustStock: vi.fn(async () => ({})),
    ...o,
  });

  it("creates the item, records opening stock and returns the cart product", async () => {
    const d = deps();
    const r = await quickAdd(ok({ qty: "12" }), d);
    expect(r).toMatchObject({ existing: false, stockFailed: false, product: { itemId: "v1", barcode: "8901234567890", price: 1000 } });
    expect(d.adjustStock).toHaveBeenCalledWith("v1", expect.objectContaining({ mode: "add", qty: 12 }));
  });
  it("skips stock when none is given or inventory is off", async () => {
    const d = deps();
    await quickAdd(ok(), d);
    expect(d.adjustStock).not.toHaveBeenCalled();
    const d2 = deps({ adjustStock: null });
    expect((await quickAdd(ok({ qty: "3" }), d2)).stockFailed).toBe(false);
  });
  it("still returns the saved item when the stock call fails", async () => {
    const r = await quickAdd(ok({ qty: "3" }), deps({ adjustStock: vi.fn(async () => Promise.reject(new Error("boom"))) }));
    expect(r.stockFailed).toBe(true);
    expect(r.product.itemId).toBe("v1");
  });
  it("shares one call for a double submit of the same barcode", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const d = deps({
      createProduct: vi.fn(async () => {
        await gate;
        return created();
      }),
    });
    const a = quickAdd(ok(), d);
    const b = quickAdd(ok(), d);
    release();
    expect((await a).product.itemId).toBe((await b).product.itemId);
    expect(d.createProduct).toHaveBeenCalledTimes(1);
    await quickAdd(ok(), d);
    expect(d.createProduct).toHaveBeenCalledTimes(2);
  });
  it("adds the existing item when the barcode is already taken", async () => {
    const existing = { itemId: "old", name: "Parle-G", unit: "pcs", price: 1000, taxInclusive: true, gstRate: 18 };
    const d = deps({
      createProduct: vi.fn(async () => Promise.reject({ status: 409, message: "This barcode is already used by another variant" })),
      lookup: vi.fn(async () => existing),
    });
    const r = await quickAdd(ok({ qty: "4" }), d);
    expect(r).toMatchObject({ existing: true, product: { itemId: "old" } });
    expect(d.adjustStock).not.toHaveBeenCalled();
  });
  it("rethrows other errors, and a taken barcode that cannot be found", async () => {
    await expect(quickAdd(ok(), deps({ createProduct: vi.fn(async () => Promise.reject({ status: 500, message: "x" })) }))).rejects.toMatchObject({ status: 500 });
    await expect(quickAdd(ok(), deps({ createProduct: vi.fn(async () => Promise.reject({ status: 409, message: "barcode taken" })) }))).rejects.toMatchObject({ status: 409 });
  });
  it("recognises the barcode conflict only", () => {
    expect(isBarcodeTaken({ status: 409, message: "This barcode is already used by another variant" })).toBe(true);
    expect(isBarcodeTaken({ status: 409, message: "This SKU is already used" })).toBe(false);
    expect(isBarcodeTaken(new Error("barcode"))).toBe(false);
    expect(isBarcodeTaken(null)).toBe(false);
  });
});

describe("open item", () => {
  it("makes a one-off cart product that bills without an item id", () => {
    const r = validateOpenItem({ name: " Repair charge ", price: "250", gstRate: 18, taxInclusive: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isOpenItem(r.product.itemId)).toBe(true);
    expect(r.product).toMatchObject({ name: "Repair charge", price: 25_000, gstRate: 18, taxInclusive: false });
    const { lines } = addProduct([], r.product);
    const input = toLineInput(lines[0]!);
    expect(input).not.toHaveProperty("itemId");
    expect(input).toMatchObject({ description: "Repair charge", qty: 1, rate: 25_000, gstRate: 18 });
  });
  it("two open items never merge", () => {
    const a = validateOpenItem({ name: "A", price: "10", gstRate: 0, taxInclusive: true });
    const b = validateOpenItem({ name: "A", price: "10", gstRate: 0, taxInclusive: true });
    if (!a.ok || !b.ok) throw new Error("invalid");
    expect(addProduct(addProduct([], a.product).lines, b.product).lines).toHaveLength(2);
  });
  it("rejects a blank name, a zero price or a bad rate", () => {
    expect(validateOpenItem({ name: "", price: "5", gstRate: 5, taxInclusive: true }).ok).toBe(false);
    expect(validateOpenItem({ name: "x", price: "0", gstRate: 5, taxInclusive: true }).ok).toBe(false);
    expect(validateOpenItem({ name: "x", price: "5", gstRate: 9, taxInclusive: true }).ok).toBe(false);
  });
});

describe("shouldOfferQuickAdd", () => {
  const base = { code: "8901234567890", looksLikeCode: true, online: true, canCreate: true, canOpenItem: false };
  it("offers on an online code miss for staff who can create or bill open items", () => {
    expect(shouldOfferQuickAdd(base)).toBe(true);
    expect(shouldOfferQuickAdd({ ...base, canCreate: false, canOpenItem: true })).toBe(true);
  });
  it("does not offer offline, for plain text, or without any permission", () => {
    expect(shouldOfferQuickAdd({ ...base, online: false })).toBe(false);
    expect(shouldOfferQuickAdd({ ...base, looksLikeCode: false })).toBe(false);
    expect(shouldOfferQuickAdd({ ...base, canCreate: false })).toBe(false);
    expect(shouldOfferQuickAdd({ ...base, code: "  " })).toBe(false);
  });
});
