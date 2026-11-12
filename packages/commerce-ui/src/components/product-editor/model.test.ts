import { describe, expect, it } from "vitest";
import { APPAREL_FOOTWEAR_GST_RULE } from "@rbms/gst";
import { createPayload, emptyVariant, fingerprint, optionsKey, productFields, productFormSchema, productPatch, toFormValues, usesVariants, variantInput, variantPatch, variantToRow, type ProductFormValues } from "./model";
import type { Product, Variant } from "../../lib/types";

const variant = (over: Partial<Variant> = {}): Variant => ({
  id: "v1",
  productId: "p1",
  sku: "KUR-M",
  barcode: null,
  title: "",
  optionValues: {},
  price: 49_900,
  mrp: 79_900,
  cost: 30_000,
  weightGrams: 250,
  position: 0,
  isDefault: true,
  ...over,
});

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Cotton Kurta",
  slug: "cotton-kurta",
  description: null,
  brand: "Murugan",
  categoryId: "c1",
  hsn: "6104",
  gstRate: 5,
  gstRule: null,
  unit: "pcs",
  taxInclusive: true,
  status: "active",
  channels: ["store", "billing"],
  tags: ["cotton"],
  attributes: { Fabric: "Cotton" },
  options: [],
  images: [{ url: "/u/a.jpg", alt: null }],
  seo: null,
  variants: [variant()],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...over,
});

/** A valid new-product form: name and one price. */
const form = (over: Partial<ProductFormValues> = {}): ProductFormValues => ({ ...toFormValues(null), name: "Kurta", variants: [emptyVariant({ price: "499" })], ...over });

const issues = (v: ProductFormValues) => {
  const r = productFormSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("product form rules", () => {
  it("accepts a named product with a price, and starts new products on store and billing at 5%", () => {
    expect(issues(form())).toEqual([]);
    const blank = toFormValues(null);
    expect(blank).toMatchObject({ gstRate: "5", unit: "pcs", taxInclusive: true, status: "active", channels: ["store", "billing"] });
  });

  it("asks for a name and a price", () => {
    expect(issues(toFormValues(null))).toEqual(["name: commerce.validation.name", "variants.0.price: commerce.validation.price"]);
  });

  it("checks money, weight, quantity and HSN fields", () => {
    const row = (over: object) => form({ variants: [emptyVariant({ price: "499", ...over })] });
    expect(issues(row({ price: "12x" }))).toEqual(["variants.0.price: commerce.validation.price"]);
    expect(issues(row({ mrp: "abc" }))).toEqual(["variants.0.mrp: commerce.validation.amount"]);
    expect(issues(row({ cost: "" }))).toEqual([]);
    expect(issues(row({ weight: "2.5" }))).toEqual(["variants.0.weight: commerce.validation.weight"]);
    expect(issues(row({ openingQty: "1.2345" }))).toEqual(["variants.0.openingQty: commerce.validation.qty"]);
    expect(issues(row({ openingQty: "12.5" }))).toEqual([]);
    expect(issues(row({ sku: "A B" }))).toEqual(["variants.0.sku: commerce.validation.noSpaces"]);
    expect(issues(form({ hsn: "123" }))).toEqual(["hsn: commerce.validation.hsn"]);
    for (const ok of ["", "6104", "610410", "61041000"]) expect(issues(form({ hsn: ok })), ok).toEqual([]);
    expect(issues(form({ slug: "Bad Slug" }))).toEqual(["slug: commerce.validation.slug"]);
    expect(issues(form({ slug: "good-slug-2" }))).toEqual([]);
    expect(issues(form({ unit: " " }))).toEqual(["unit: commerce.validation.required"]);
  });

  it("flags a repeated SKU without caring about case, and repeated option names", () => {
    const v = form({
      options: [
        { name: "Size", values: ["S"] },
        { name: " size ", values: ["M"] },
      ],
      variants: [emptyVariant({ price: "1", sku: "ABC" }), emptyVariant({ price: "1", sku: "abc", optionValues: { Size: "S" } }), emptyVariant({ price: "1", sku: "", optionValues: { Size: "M" } }), emptyVariant({ price: "1", sku: "", optionValues: { Size: "L" } })],
    });
    expect(issues(v)).toEqual(["options.1.name: commerce.validation.optionUnique", "variants.1.sku: commerce.validation.skuDuplicate"]);
  });

  it("wants an attribute name when there is an attribute value, and at most three options", () => {
    expect(issues(form({ attributes: [{ key: "", value: "Cotton" }] }))).toEqual(["attributes.0.key: commerce.validation.attributeName"]);
    expect(issues(form({ attributes: [{ key: "", value: "" }] }))).toEqual([]);
    const opt = (n: string) => ({ name: n, values: ["a"] });
    expect(issues(form({ options: [opt("A"), opt("B"), opt("C"), opt("D")] }))).toContain("options: commerce.validation.maxOptions");
    expect(issues(form({ options: [{ name: "Size", values: [] }] }))).toContain("options.0.values: commerce.validation.optionValues");
  });
});

describe("product to form and back", () => {
  it("fills the form from a saved product, rupees not paise, variants in position order", () => {
    const p = product({ variants: [variant({ id: "v2", position: 1, price: 59_900, mrp: null, cost: null, weightGrams: null, sku: null }), variant()] });
    const f = toFormValues(p);
    expect(f).toMatchObject({ name: "Cotton Kurta", gstRate: "5", gstBand: false, hsn: "6104", brand: "Murugan", attributes: [{ key: "Fabric", value: "Cotton" }], images: [{ url: "/u/a.jpg", alt: "" }] });
    expect(f.variants.map((r) => [r.id, r.price, r.mrp, r.cost, r.weight, r.sku])).toEqual([
      ["v1", "499", "799", "300", "250", "KUR-M"],
      ["v2", "599", "", "", "", ""],
    ]);
  });

  it("switches price-band GST on when the product has a rule", () => {
    expect(toFormValues(product({ gstRule: APPAREL_FOOTWEAR_GST_RULE })).gstBand).toBe(true);
    expect(toFormValues(product()).gstBand).toBe(false);
  });

  it("falls back to one empty variant row and to pieces when the saved product lacks them", () => {
    const f = toFormValues(product({ variants: [], unit: "" }));
    expect(f.variants).toHaveLength(1);
    expect(f.unit).toBe("pcs");
  });

  it("sends API fields: trimmed text, nulls for blanks, lower-case tags, the band's lower rate as listed rate", () => {
    const fields = productFields(form({ name: " Kurta ", slug: " ", brand: " Murugan ", tags: [" Cotton ", " "], attributes: [{ key: " Fabric ", value: " Cotton " }, { key: " ", value: "x" }], seoTitle: "Best", seoDescription: "" }));
    expect(fields).toMatchObject({ name: "Kurta", slug: null, brand: "Murugan", tags: ["cotton"], attributes: { Fabric: "Cotton" }, seo: { title: "Best" }, gstRate: 5, gstRule: null });
    const band = productFields(form({ gstBand: true, gstRate: "12" }));
    expect(band.gstRate).toBe(APPAREL_FOOTWEAR_GST_RULE.below);
    expect(band.gstRule).toEqual(APPAREL_FOOTWEAR_GST_RULE);
    expect(productFields(form({ seoTitle: "", seoDescription: "" })).seo).toBeNull();
  });

  it("turns a variant into API money: price in paise, optional MRP and cost null when blank", () => {
    const row = emptyVariant({ price: "1,299.50", mrp: "", cost: "700", weight: " 400 ", sku: " A1 " });
    expect(variantInput(row, 2, [], true)).toEqual({ sku: "A1", barcode: null, optionValues: {}, title: null, price: 129_950, mrp: null, cost: 70_000, weightGrams: 400, position: 2 });
    // A role that may not see costs never sends one.
    expect(variantInput(row, 0, [], false)).not.toHaveProperty("cost");
  });

  it("keeps a typed variant title only when it differs from the one made from the options", () => {
    const options = [{ name: "Size", values: ["S"] }];
    const auto = emptyVariant({ price: "1", optionValues: { Size: "S" }, title: "S" });
    const custom = emptyVariant({ price: "1", optionValues: { Size: "S" }, title: "Small cotton" });
    expect(variantInput(auto, 0, options, false).title).toBeNull();
    expect(variantInput(custom, 0, options, false).title).toBe("Small cotton");
    // A product without options has no variant title.
    expect(variantInput(emptyVariant({ price: "1", title: "ignored" }), 0, [], false).title).toBeNull();
  });
});

describe("saving a new product", () => {
  it("creates a simple product from the first row, ignoring option values left over", () => {
    const f = form({ variants: [emptyVariant({ price: "499", mrp: "799", optionValues: { Size: "S" }, title: "S" }), emptyVariant({ price: "999" })] });
    const out = createPayload(f, { variantsOn: false, includeCost: false });
    expect(out.variants).toEqual([{ sku: null, barcode: null, optionValues: {}, title: null, price: 49_900, mrp: 79_900, weightGrams: null, position: 0 }]);
    expect(out).not.toHaveProperty("options");
  });

  it("makes one variant per option combination when options were set but Generate was never pressed", () => {
    const f = form({
      options: [
        { name: "Size", values: ["S", "M"] },
        { name: "Colour", values: ["Red"] },
      ],
      variants: [emptyVariant({ price: "499", sku: "K1", barcode: "8901" })],
    });
    const out = createPayload(f, { variantsOn: true, includeCost: false });
    expect(out.options).toEqual([
      { name: "Size", values: ["S", "M"] },
      { name: "Colour", values: ["Red"] },
    ]);
    expect(out.variants?.map((v) => [v.optionValues, v.price, v.sku, v.barcode, v.position])).toEqual([
      [{ Size: "S", Colour: "Red" }, 49_900, "K1", "8901", 0],
      [{ Size: "M", Colour: "Red" }, 49_900, null, null, 1],
    ]);
  });

  it("ignores variants when the shop's plan has them off", () => {
    const f = form({ options: [{ name: "Size", values: ["S", "M"] }], variants: [emptyVariant({ price: "499" })] });
    expect(createPayload(f, { variantsOn: false, includeCost: false }).variants).toHaveLength(1);
  });

  it("knows when a form uses variants", () => {
    expect(usesVariants(form())).toBe(false);
    expect(usesVariants(form({ options: [{ name: "Size", values: ["S"] }] }))).toBe(true);
    expect(usesVariants(form({ variants: [emptyVariant({ price: "1" }), emptyVariant({ price: "2" })] }))).toBe(true);
    expect(usesVariants(form({ variants: [emptyVariant({ price: "1", optionValues: { Size: "S" } })] }))).toBe(true);
  });
});

describe("saving changes to a product", () => {
  it("sends only the product fields that changed", () => {
    const p = product();
    expect(productPatch(toFormValues(p), p)).toEqual({});
    const f = { ...toFormValues(p), name: "Cotton Kurta XL", tags: ["cotton", "summer"], gstRate: "12" };
    expect(productPatch(f, p)).toEqual({ name: "Cotton Kurta XL", tags: ["cotton", "summer"], gstRate: 12 });
  });

  it("sends only the variant fields that changed, and clears an MRP that was emptied", () => {
    const server = variant();
    const row = variantToRow(server);
    expect(variantPatch(row, server, 0, [], true)).toEqual({});
    expect(variantPatch({ ...row, price: "549", mrp: "", sku: "KUR-L" }, server, 0, [], true)).toEqual({ price: 54_900, mrp: null, sku: "KUR-L" });
    // Cost is left alone when the member may not see it.
    expect(variantPatch({ ...row, cost: "999" }, server, 0, [], false)).toEqual({});
    expect(variantPatch({ ...row, cost: "999" }, server, 0, [], true)).toEqual({ cost: 99_900 });
  });

  it("only saves a variant title when the variant has options", () => {
    const server = variant({ optionValues: { Size: "S" }, title: "S" });
    expect(variantPatch({ ...variantToRow(server), title: "Small" }, server, 0, [{ name: "Size", values: ["S"] }], false)).toEqual({ title: "Small" });
    const plain = variant();
    expect(variantPatch({ ...variantToRow(plain), title: "Anything" }, plain, 0, [], false)).toEqual({});
  });

  it("fingerprints the form without opening stock, so typing opening stock is not an unsaved change", () => {
    const a = form();
    const b = { ...a, variants: [{ ...a.variants[0]!, openingQty: "10" }] };
    expect(fingerprint(b)).toBe(fingerprint(a));
    expect(fingerprint({ ...a, name: "Other" })).not.toBe(fingerprint(a));
  });

  it("compares option definitions ignoring spaces around names", () => {
    expect(optionsKey([{ name: " Size ", values: ["S"] }])).toBe(optionsKey([{ name: "Size", values: ["S"] }]));
    expect(optionsKey([{ name: "Size", values: ["S", "M"] }])).not.toBe(optionsKey([{ name: "Size", values: ["M", "S"] }]));
  });
});
