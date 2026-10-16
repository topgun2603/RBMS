import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import { contentChanges, planListing, variantChanges } from "./logic";
import { catalogProducts } from "./schema";
import { CatalogueService, productListQuerySchema, type ListingReviewPort } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const VENDOR = "55555555-5555-4555-8555-555555555555";
const PRODUCT = "22222222-2222-4222-8222-222222222222";

type Op = { m: string; args: unknown[] };

/**
 * Chainable drizzle fake: every builder call returns the chain; awaiting it resolves to `resolve(ops)` for that query.
 * `ops` keeps each awaited query's calls, so tests can read what was inserted or set.
 */
function fakeDb(resolve: (ops: Op[]) => unknown[]) {
  const done: Op[][] = [];
  let current: Op[] = [];
  const settle = () => {
    const ops = current;
    done.push(ops);
    current = [];
    return Promise.resolve(resolve(ops));
  };
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
        if (prop === "transaction") return (cb: (tx: unknown) => unknown) => Promise.resolve().then(() => cb(chain));
        return (...args: unknown[]) => {
          current.push({ m: String(prop), args });
          return chain;
        };
      },
    },
  );
  return { db: chain as Db, done };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  tenantId: TENANT,
  name: "Clay lamp",
  slug: "clay-lamp",
  description: null,
  brand: null,
  categoryId: null,
  hsn: null,
  gstRate: 5,
  unit: "pcs",
  taxInclusive: true,
  status: "draft",
  channels: ["store"],
  tags: [],
  attributes: {},
  options: [],
  images: [{ url: "https://img.example/lamp.jpg", alt: null }],
  seo: null,
  vendorId: VENDOR,
  searchText: "",
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const variant = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: TENANT,
  productId: PRODUCT,
  sku: "LAMP",
  barcode: null,
  title: "",
  optionValues: {},
  price: 50_000,
  mrp: 60_000,
  cost: null,
  weightGrams: null,
  position: 0,
  isDefault: true,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Inserts / updates return the product row (as written); single-row reads return `current`. */
function make(current: ReturnType<typeof row>, review: Partial<ListingReviewPort> & { needs?: boolean } = {}) {
  let written = { ...current };
  const f = fakeDb((ops) => {
    const insert = ops.find((o) => o.m === "insert");
    const values = ops.find((o) => o.m === "values")?.args[0] as Record<string, unknown> | undefined;
    const set = ops.find((o) => o.m === "set")?.args[0] as Record<string, unknown> | undefined;
    if (insert?.args[0] === catalogProducts && values) written = { ...written, ...values };
    if (set && ops.some((o) => o.m === "update" && o.args[0] === catalogProducts)) written = { ...written, ...set };
    if (ops.some((o) => o.m === "innerJoin") && ops.some((o) => o.m === "limit")) return [{ v: variant, p: current }];
    if (ops.some((o) => o.m === "returning")) return ops.some((o) => o.m === "update" && o.args[0] !== catalogProducts) ? [{ ...variant, ...set }] : [written];
    if (ops.some((o) => o.m === "limit")) return [current];
    return [];
  });
  const port: ListingReviewPort = {
    needsReview: review.needsReview ?? vi.fn(async () => review.needs ?? true),
    onListing: review.onListing ?? vi.fn(async () => undefined),
  };
  const service = new CatalogueService({ db: f.db, listingReview: port });
  const productValues = () =>
    f.done.flatMap((ops) => (ops.some((o) => o.m === "insert" && o.args[0] === catalogProducts) ? [ops.find((o) => o.m === "values")!.args[0] as Record<string, unknown>] : []));
  const productSets = () =>
    f.done.flatMap((ops) => (ops.some((o) => o.m === "update" && o.args[0] === catalogProducts) ? [ops.find((o) => o.m === "set")!.args[0] as Record<string, unknown>] : []));
  return { service, port, productValues, productSets };
}

describe("planListing", () => {
  const base = { vendorId: VENDOR, byVendor: true, needsReview: true };
  it("holds a seller's submission as a draft when the shop reviews products", () => {
    expect(planListing({ ...base, requested: "active", current: null })).toEqual({ status: "draft", event: "submitted" });
    expect(planListing({ ...base, requested: "active", current: "draft" })).toEqual({ status: "draft", event: "submitted" });
    expect(planListing({ ...base, requested: "active", current: "archived" })).toEqual({ status: "draft", event: "submitted" });
  });
  it("publishes directly when the shop auto-approves, or when staff publish", () => {
    expect(planListing({ ...base, needsReview: false, requested: "active", current: "draft" })).toEqual({ status: "active", event: "published" });
    expect(planListing({ ...base, byVendor: false, requested: "active", current: "draft" })).toEqual({ status: "active", event: "published" });
  });
  it("keeps an approved (active) product live when the seller saves it", () => {
    expect(planListing({ ...base, requested: "active", current: "active" })).toEqual({ status: "active", event: null });
  });
  it("withdraws on draft/archive, and leaves untouched status alone", () => {
    expect(planListing({ ...base, requested: "draft", current: "draft" })).toEqual({ status: "draft", event: "withdrawn" });
    expect(planListing({ ...base, requested: "archived", current: "active" })).toEqual({ status: "archived", event: "withdrawn" });
    expect(planListing({ ...base, requested: undefined, current: "draft" })).toEqual({ status: undefined, event: null });
  });
  it("never touches the shop's own products", () => {
    expect(planListing({ ...base, vendorId: null, requested: "active", current: "draft" })).toEqual({ status: "active", event: null });
  });
});

describe("seller products wait for review (never public before approval)", () => {
  it("a seller creating an active product stores a draft and reports the submission", async () => {
    const { service, port, productValues } = make(row());
    const p = await service.createProduct(TENANT, { name: "Clay lamp", price: 50_000, status: "active", channels: ["store"] }, { vendorId: VENDOR });
    expect(productValues()[0]).toMatchObject({ status: "draft", vendorId: VENDOR });
    expect(p.status).toBe("draft");
    expect(port.needsReview).toHaveBeenCalledWith(TENANT, VENDOR);
    expect(port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "submitted", productId: PRODUCT, vendorId: VENDOR, by: "vendor" }));
  });

  it("goes live at once when the shop auto-approves", async () => {
    const { service, port, productValues } = make(row(), { needs: false });
    await service.createProduct(TENANT, { name: "Clay lamp", price: 50_000 }, { vendorId: VENDOR });
    expect(productValues()[0]).toMatchObject({ status: "active" });
    expect(port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "published", by: "vendor" }));
  });

  it("submitting an existing draft keeps it a draft; saving an approved product doesn't re-ask", async () => {
    const draft = make(row({ status: "draft" }));
    await draft.service.updateProduct(TENANT, PRODUCT, { status: "active", name: "Clay lamp (big)" }, { vendorId: VENDOR });
    expect(draft.productSets()[0]).toMatchObject({ status: "draft", name: "Clay lamp (big)" });
    expect(draft.port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "submitted" }));

    const live = make(row({ status: "active" }));
    await live.service.updateProduct(TENANT, PRODUCT, { status: "active", description: "Hand made" }, { vendorId: VENDOR });
    expect(live.productSets()[0]).toMatchObject({ status: "active" });
    expect(live.port.needsReview).not.toHaveBeenCalled();
    // Still live; only the content change is reported (the marketplace decides on a re-review).
    expect(live.port.onListing).toHaveBeenCalledTimes(1);
    expect(live.port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "changed", fields: ["description"] }));
  });

  it("staff publishing a seller product skips review and reports it published", async () => {
    const { service, port, productSets } = make(row({ status: "draft" }));
    await service.updateProduct(TENANT, PRODUCT, { status: "active" });
    expect(productSets()[0]).toMatchObject({ status: "active" });
    expect(port.needsReview).not.toHaveBeenCalled();
    expect(port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "published", by: "staff" }));
  });

  it("the shop's own products never involve the review port", async () => {
    const { service, port, productValues } = make(row({ vendorId: null, status: "active" }));
    await service.createProduct(TENANT, { name: "Shop saree", price: 90_000 });
    expect(productValues()[0]).toMatchObject({ status: "active", vendorId: null });
    expect(port.needsReview).not.toHaveBeenCalled();
    expect(port.onListing).not.toHaveBeenCalled();
  });

  it("withdraws on delete; a failing review hook never fails the write", async () => {
    const onListing = vi.fn(async () => {
      throw new Error("down");
    });
    const { service } = make(row({ status: "draft" }), { onListing });
    await expect(service.deleteProduct(TENANT, PRODUCT, { vendorId: VENDOR })).resolves.toBeUndefined();
    expect(onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "withdrawn", productId: PRODUCT }));
  });
});

describe("staff product list by seller", () => {
  it("accepts a vendorId filter (uuid only)", () => {
    expect(productListQuerySchema.parse({ vendorId: VENDOR })).toMatchObject({ vendorId: VENDOR });
    expect(() => productListQuerySchema.parse({ vendorId: "nope" })).toThrow();
  });
});

describe("edits to a live seller product (re-review)", () => {
  it("contentChanges / variantChanges list only real customer-facing changes", () => {
    const cur = { name: "Lamp", description: null, images: [{ url: "a", alt: null }], gstRate: 5, hsn: "6913", taxInclusive: true, options: [] };
    expect(contentChanges(cur, { name: "Lamp", description: "", images: [{ url: "a", alt: null }], gstRate: 5, hsn: "6913", taxInclusive: true, options: [] })).toEqual(["description"]);
    expect(contentChanges(cur, { ...cur })).toEqual([]);
    expect(contentChanges(cur, { name: "Big lamp", hsn: "6914", images: [] }).sort()).toEqual(["gst", "images", "name"]);
    expect(contentChanges(cur, { options: [{ name: "Size", values: ["S"] }] })).toEqual(["variants"]);
    const v = { price: 100, mrp: 120, title: "", optionValues: {} };
    expect(variantChanges(v, { price: 100, mrp: 120, title: "" })).toEqual([]);
    expect(variantChanges(v, { mrp: null })).toEqual(["price"]);
    expect(variantChanges(v, { optionValues: { Size: "M" } })).toEqual(["variants"]);
  });

  it("a seller renaming their live product reports what changed; a same-value save reports nothing", async () => {
    const live = make(row({ status: "active", description: "Old" }));
    await live.service.updateProduct(TENANT, PRODUCT, { status: "active", name: "Clay lamp", description: "New text" }, { vendorId: VENDOR });
    expect(live.port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "changed", fields: ["description"], by: "vendor" }));

    const same = make(row({ status: "active" }));
    await same.service.updateProduct(TENANT, PRODUCT, { status: "active", name: "Clay lamp", gstRate: 5, images: [{ url: "https://img.example/lamp.jpg" }] }, { vendorId: VENDOR });
    expect(same.port.onListing).not.toHaveBeenCalled();
  });

  it("drafts, staff edits and moving to draft never report a change", async () => {
    const draft = make(row({ status: "draft" }));
    await draft.service.updateProduct(TENANT, PRODUCT, { name: "New name" }, { vendorId: VENDOR });
    expect(draft.port.onListing).not.toHaveBeenCalled();
    const staff = make(row({ status: "active" }));
    await staff.service.updateProduct(TENANT, PRODUCT, { name: "New name" });
    expect(staff.port.onListing).not.toHaveBeenCalled();
    const off = make(row({ status: "active" }));
    await off.service.updateProduct(TENANT, PRODUCT, { status: "draft", name: "New name" }, { vendorId: VENDOR });
    expect(off.port.onListing).toHaveBeenCalledTimes(1);
    expect(off.port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "withdrawn" }));
  });

  it("a seller changing a live variant's price reports price; SKU alone reports nothing", async () => {
    const price = make(row({ status: "active" }));
    await price.service.updateVariant(TENANT, variant.id, { price: 55_000, sku: "LAMP" }, { vendorId: VENDOR });
    expect(price.port.onListing).toHaveBeenCalledWith(TENANT, expect.objectContaining({ type: "changed", fields: ["price"] }));
    const sku = make(row({ status: "active" }));
    await sku.service.updateVariant(TENANT, variant.id, { sku: "LAMP-2", price: 50_000 }, { vendorId: VENDOR });
    expect(sku.port.onListing).not.toHaveBeenCalled();
  });
});
