import { z } from "zod";
import { cartesian, comboKey, orNull, paiseToInput, rupeesToPaise, SLUG_RE, variantTitle } from "../../lib/format";
import type { Channel, Product, ProductCreateInput, ProductFields, ProductStatus, Variant, VariantInput } from "../../lib/types";

/*
 * The editor's form model. Every product has ≥ 1 variant row; a simple product is one row without option values,
 * edited through the Pricing section's single price / SKU / barcode fields. Error messages are message keys
 * (FormMessage translates them).
 */

const money = (required: boolean) =>
  z.string().refine((v) => (v.trim() === "" ? !required : rupeesToPaise(v) !== null), required ? "commerce.validation.price" : "commerce.validation.amount");
const code = z
  .string()
  .trim()
  .max(64, "commerce.validation.tooLong")
  .refine((v) => !/\s/.test(v), "commerce.validation.noSpaces");
const grams = z.string().refine((v) => v.trim() === "" || /^\d{1,7}$/.test(v.trim()), "commerce.validation.weight");
const qty = z.string().refine((v) => v.trim() === "" || /^\d*\.?\d{0,3}$/.test(v.trim()), "commerce.validation.qty");

export const variantRowSchema = z.object({
  /** Saved variant id (edit mode); absent for rows that exist only in the form. */
  id: z.string().optional(),
  key: z.string(),
  title: z.string().trim().max(120, "commerce.validation.tooLong"),
  optionValues: z.record(z.string(), z.string()),
  sku: code,
  barcode: code,
  price: money(true),
  mrp: money(false),
  cost: money(false),
  weight: grams,
  /** Create only: opening stock. */
  openingQty: qty,
});
export type VariantRow = z.infer<typeof variantRowSchema>;

export const optionRowSchema = z.object({
  name: z.string().trim().min(1, "commerce.validation.optionName").max(40, "commerce.validation.tooLong"),
  values: z.array(z.string().trim().min(1).max(60)).min(1, "commerce.validation.optionValues").max(50),
});

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, "commerce.validation.name").max(200, "commerce.validation.tooLong"),
    description: z.string().max(20_000, "commerce.validation.tooLong"),
    brand: z.string().trim().max(120, "commerce.validation.tooLong"),
    categoryId: z.string().nullable(),
    images: z.array(z.object({ url: z.string(), alt: z.string().nullable().optional() })).max(20),
    gstRate: z.string(),
    hsn: z
      .string()
      .trim()
      .regex(/^$|^[0-9]{2,8}$/, "commerce.validation.hsn"),
    unit: z.string().trim().min(1, "commerce.validation.required").max(16, "commerce.validation.tooLong"),
    taxInclusive: z.boolean(),
    options: z.array(optionRowSchema).max(3, "commerce.validation.maxOptions"),
    variants: z.array(variantRowSchema).min(1),
    status: z.enum(["active", "draft", "archived"]),
    channels: z.array(z.string()),
    tags: z.array(z.string()),
    attributes: z.array(z.object({ key: z.string().trim().max(60, "commerce.validation.tooLong"), value: z.string().trim().max(500, "commerce.validation.tooLong") })),
    slug: z
      .string()
      .trim()
      .max(80, "commerce.validation.tooLong")
      .refine((v) => v === "" || SLUG_RE.test(v), "commerce.validation.slug"),
    seoTitle: z.string().trim().max(120, "commerce.validation.tooLong"),
    seoDescription: z.string().trim().max(320, "commerce.validation.tooLong"),
  })
  .superRefine((v, ctx) => {
    const names = v.options.map((o) => o.name.trim().toLowerCase());
    names.forEach((n, i) => {
      if (n && names.indexOf(n) !== i) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options", i, "name"], message: "commerce.validation.optionUnique" });
    });
    const seen = new Map<string, number>();
    v.variants.forEach((row, i) => {
      const sku = row.sku.trim().toLowerCase();
      if (!sku) return;
      if (seen.has(sku)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variants", i, "sku"], message: "commerce.validation.skuDuplicate" });
      else seen.set(sku, i);
    });
    v.attributes.forEach((a, i) => {
      if (!a.key && a.value) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attributes", i, "key"], message: "commerce.validation.attributeName" });
    });
  });

export type ProductFormValues = z.infer<typeof productFormSchema>;

export const emptyVariant = (over: Partial<VariantRow> = {}): VariantRow => ({
  key: comboKey(over.optionValues ?? {}),
  title: "",
  optionValues: {},
  sku: "",
  barcode: "",
  price: "",
  mrp: "",
  cost: "",
  weight: "",
  openingQty: "",
  ...over,
});

export function variantToRow(v: Variant): VariantRow {
  return {
    id: v.id,
    key: comboKey(v.optionValues ?? {}),
    title: v.title ?? "",
    optionValues: v.optionValues ?? {},
    sku: v.sku ?? "",
    barcode: v.barcode ?? "",
    price: paiseToInput(v.price),
    mrp: paiseToInput(v.mrp),
    cost: paiseToInput(v.cost),
    weight: v.weightGrams === null || v.weightGrams === undefined ? "" : String(v.weightGrams),
    openingQty: "",
  };
}

export function toFormValues(p?: Product | null): ProductFormValues {
  if (!p) {
    return {
      name: "",
      description: "",
      brand: "",
      categoryId: null,
      images: [],
      gstRate: "5",
      hsn: "",
      unit: "pcs",
      taxInclusive: true,
      options: [],
      variants: [emptyVariant()],
      status: "active",
      channels: ["store", "billing"],
      tags: [],
      attributes: [],
      slug: "",
      seoTitle: "",
      seoDescription: "",
    };
  }
  const variants = [...p.variants].sort((a, b) => a.position - b.position).map(variantToRow);
  return {
    name: p.name,
    description: p.description ?? "",
    brand: p.brand ?? "",
    categoryId: p.categoryId,
    images: p.images.map((i) => ({ url: i.url, alt: i.alt ?? "" })),
    gstRate: String(p.gstRate),
    hsn: p.hsn ?? "",
    unit: p.unit || "pcs",
    taxInclusive: p.taxInclusive,
    options: p.options.map((o) => ({ name: o.name, values: [...o.values] })),
    variants: variants.length ? variants : [emptyVariant()],
    status: p.status,
    channels: [...p.channels],
    tags: [...p.tags],
    attributes: Object.entries(p.attributes ?? {}).map(([key, value]) => ({ key, value })),
    slug: p.slug,
    seoTitle: p.seo?.title ?? "",
    seoDescription: p.seo?.description ?? "",
  };
}

/** Whether the form describes a product with options (several variants or option values). */
export const usesVariants = (v: Pick<ProductFormValues, "options" | "variants">) =>
  v.options.length > 0 || v.variants.length > 1 || v.variants.some((r) => Object.keys(r.optionValues).length > 0);

const paiseOrNull = (s: string) => (s.trim() === "" ? null : rupeesToPaise(s));

/** Product-level fields (POST and PATCH). `options` is applied through variant generation in edit mode. */
export function productFields(v: ProductFormValues): ProductFields {
  const attributes: Record<string, string> = {};
  for (const a of v.attributes) if (a.key.trim()) attributes[a.key.trim()] = a.value.trim();
  const seo = v.seoTitle.trim() || v.seoDescription.trim() ? { ...(v.seoTitle.trim() ? { title: v.seoTitle.trim() } : {}), ...(v.seoDescription.trim() ? { description: v.seoDescription.trim() } : {}) } : null;
  return {
    name: v.name.trim(),
    slug: orNull(v.slug),
    description: orNull(v.description),
    brand: orNull(v.brand),
    categoryId: v.categoryId,
    hsn: orNull(v.hsn),
    gstRate: Number(v.gstRate),
    unit: v.unit.trim() || "pcs",
    taxInclusive: v.taxInclusive,
    status: v.status as ProductStatus,
    channels: v.channels as Channel[],
    tags: v.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
    attributes,
    images: v.images.map((i) => ({ url: i.url, alt: orNull(i.alt ?? "") })),
    seo,
  };
}

export function variantInput(row: VariantRow, i: number, options: ProductFormValues["options"], includeCost: boolean): VariantInput {
  const hasOptions = Object.keys(row.optionValues).length > 0;
  const autoTitle = variantTitle(row.optionValues, options);
  return {
    sku: orNull(row.sku),
    barcode: orNull(row.barcode),
    optionValues: row.optionValues,
    title: hasOptions ? (row.title.trim() && row.title.trim() !== autoTitle ? row.title.trim() : null) : null,
    price: rupeesToPaise(row.price) ?? 0,
    mrp: paiseOrNull(row.mrp),
    ...(includeCost ? { cost: paiseOrNull(row.cost) } : {}),
    weightGrams: row.weight.trim() ? Number(row.weight.trim()) : null,
    position: i,
  };
}

export function createPayload(v: ProductFormValues, opts: { variantsOn: boolean; includeCost: boolean }): ProductCreateInput {
  const fields = productFields(v);
  const multi = opts.variantsOn && usesVariants(v);
  let rows = multi ? v.variants : v.variants.slice(0, 1).map((r) => ({ ...r, optionValues: {}, title: "" }));
  // Options defined but "Generate" never pressed: create one variant per combination from the single row.
  if (multi && v.options.length > 0 && rows.every((r) => Object.keys(r.optionValues).length === 0)) {
    const base = rows[0]!;
    rows = cartesian(v.options).map((c) => ({ ...base, key: comboKey(c), optionValues: c, title: variantTitle(c, v.options), sku: "", barcode: "" }));
    if (rows[0]) rows[0] = { ...rows[0], sku: base.sku, barcode: base.barcode };
  }
  return {
    ...fields,
    ...(multi ? { options: v.options.map((o) => ({ name: o.name.trim(), values: o.values })) } : {}),
    variants: rows.map((r, i) => variantInput(r, i, v.options, opts.includeCost)),
  };
}

/** The PATCH body for a saved variant: only fields that differ from the server copy. */
export function variantPatch(row: VariantRow, server: Variant, i: number, options: ProductFormValues["options"], includeCost: boolean): Partial<VariantInput> {
  const next = variantInput(row, i, options, includeCost);
  const out: Partial<VariantInput> = {};
  if ((next.sku ?? null) !== (server.sku ?? null)) out.sku = next.sku ?? null;
  if ((next.barcode ?? null) !== (server.barcode ?? null)) out.barcode = next.barcode ?? null;
  if (next.price !== server.price) out.price = next.price;
  if ((next.mrp ?? null) !== (server.mrp ?? null)) out.mrp = next.mrp ?? null;
  if (includeCost && (next.cost ?? null) !== (server.cost ?? null)) out.cost = next.cost ?? null;
  if ((next.weightGrams ?? null) !== (server.weightGrams ?? null)) out.weightGrams = next.weightGrams ?? null;
  const title = row.title.trim();
  if (Object.keys(row.optionValues).length > 0 && title && title !== server.title) out.title = title;
  return out;
}

/** PATCH body for the product: only changed fields. */
export function productPatch(v: ProductFormValues, server: Product): Partial<ProductFields> {
  const next = productFields(v);
  const base = productFields(toFormValues(server));
  const out: Partial<ProductFields> = {};
  for (const k of Object.keys(next) as (keyof ProductFields)[]) {
    if (JSON.stringify(next[k]) !== JSON.stringify(base[k])) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

/** Order-insensitive comparison of option definitions. */
export const optionsKey = (o: ProductFormValues["options"]) => JSON.stringify(o.map((x) => ({ n: x.name.trim(), v: x.values })));

/** Stable fingerprint of the form for the unsaved-changes check (opening stock excluded once saved). */
export const fingerprint = (v: ProductFormValues) =>
  JSON.stringify({ ...v, variants: v.variants.map(({ openingQty: _q, ...r }) => r) });
