import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { swatchProducts } from "./home-layouts";
import type { HomeSectionOf, Product, ProductSummary, Variant } from "../types";

const summary = (id: string): ProductSummary => ({ id, name: `Case ${id}`, slug: `case-${id}`, image: null } as ProductSummary);
const variant = (id: string, optionValues: Record<string, string>, price: number, position: number): Variant => ({ id, productId: "p1", sku: null, barcode: null, title: id, optionValues, price, mrp: null, weightGrams: null, position, isDefault: position === 0 });

// A silicone case: Phone model × Colour (the model is the first option, so the first variant per colour is model A's).
const caseProduct = {
  id: "p1",
  options: [
    { name: "Phone model", values: ["6.1-inch", "6.6-inch"] },
    { name: "Colour", values: ["Black", "Mint"] },
  ],
  variants: [
    variant("a-black", { "Phone model": "6.1-inch", Colour: "Black" }, 39900, 0),
    variant("a-mint", { "Phone model": "6.1-inch", Colour: "Mint" }, 39900, 1),
    variant("b-black", { "Phone model": "6.6-inch", Colour: "Black" }, 44900, 2),
  ],
} as unknown as Product;

const section = (extra: Partial<HomeSectionOf<"swatches">> = {}): HomeSectionOf<"swatches"> => ({
  type: "swatches",
  optionName: "Colour",
  shades: [
    { value: "Black", hex: "#111111" },
    { value: "Mint", hex: "#98ff98" },
  ],
  products: [summary("p1")],
  ...extra,
});

describe("swatches over a second option (case colour × phone model)", () => {
  it("one option: the first variant per shade, no picker", () => {
    const [p] = swatchProducts(section(), new Map([["p1", caseProduct]]));
    expect(p!.also).toBeUndefined();
    expect(p!.shades.map((s) => [s.value, s.variantId])).toEqual([
      ["Black", "a-black"],
      ["Mint", "a-mint"],
    ]);
  });

  it("with alsoOption: every shade knows its variant per phone model, and the product lists the models", () => {
    const [p] = swatchProducts(section({ alsoOption: "Phone model" }), new Map([["p1", caseProduct]]), "Your phone");
    expect(p!.also).toEqual({ name: "Phone model", label: "Your phone", values: ["6.1-inch", "6.6-inch"] });
    const black = p!.shades.find((s) => s.value === "Black")!;
    expect(black.byAlso).toEqual({ "6.1-inch": { variantId: "a-black", price: 39900, mrp: null }, "6.6-inch": { variantId: "b-black", price: 44900, mrp: null } });
    // Mint exists only for the 6.1-inch model.
    expect(Object.keys(p!.shades.find((s) => s.value === "Mint")!.byAlso!)).toEqual(["6.1-inch"]);
  });

  it("a product without that option falls back to plain swatches", () => {
    const single = { ...caseProduct, options: [{ name: "Colour", values: ["Black"] }], variants: [variant("x", { Colour: "Black" }, 9900, 0)] } as unknown as Product;
    const [p] = swatchProducts(section({ alsoOption: "Phone model" }), new Map([["p1", single]]));
    expect(p!.also).toBeUndefined();
    expect(p!.shades[0]!.byAlso).toBeUndefined();
    expect(renderToStaticMarkup(<>{p!.shades.length}</>)).toBe("1");
  });
});
