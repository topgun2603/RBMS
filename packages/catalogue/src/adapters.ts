import { AppError } from "@srirealtime/core";
import type { Channel } from "./schema";
import type { BillingItemListQuery, CatalogueService } from "./service";
import type { CatalogItem } from "./types";

/** Billing's saved-item shape (`rate` = GST-exclusive paise). Structurally equal to invoices' item-source record. */
export interface BillingItemRecord {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
  /** Price-band GST rule of the product (apparel / footwear); `gstRate`/`rate` are its band at the variant's price. */
  gstRule?: CatalogItem["gstRule"];
  createdAt: Date;
  categoryId?: string | null;
  /** False for draft/archived products. */
  active?: boolean;
  /** With stock wired: quantity on hand over all locations, and its status. */
  stockQty?: number | null;
  stockStatus?: "in" | "low" | "out" | "untracked" | null;
}

export interface BillingItemInput {
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}

/** Same shape as `ItemSourcePort` in @srirealtime/invoices (declared here too; packages don't import each other). */
export interface BillingItemSource {
  list(
    tenantId: string,
    query: Omit<BillingItemListQuery, "channel" | "stock"> & { stock?: string[] },
  ): Promise<{ items: BillingItemRecord[]; total: number; facets?: Record<string, Record<string, number>>; categories?: { id: string; name: string }[] }>;
  get(tenantId: string, id: string): Promise<BillingItemRecord | null>;
  create(tenantId: string, input: BillingItemInput): Promise<BillingItemRecord>;
  update(tenantId: string, id: string, patch: Partial<BillingItemInput>): Promise<BillingItemRecord | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
}

const is404 = (e: unknown) => e instanceof AppError && e.status === 404;
const nullOn404 = (e: unknown): null => {
  if (is404(e)) return null;
  throw e;
};

export const toBillingItem = (i: CatalogItem): BillingItemRecord => ({
  id: i.id,
  name: i.name,
  hsn: i.hsn,
  unit: i.unit,
  rate: i.rate,
  gstRate: i.gstRate,
  ...(i.gstRule ? { gstRule: i.gstRule } : {}),
  createdAt: i.createdAt,
});

/**
 * invoices' ItemSourcePort over the catalogue: lists variants sold on `channel` (default "billing"), sorted and
 * filtered (stock through the catalogue's `stock` port when the shop tracks stock); creates simple
 * products (one default variant, channels billing + store); edits write name/hsn/unit/gst to the product and the rate to
 * the variant; deletes remove the variant (or the product when it is the only one).
 */
export function billingItemSource(service: CatalogueService, opts: { channel?: Channel } = {}): BillingItemSource {
  const channel = opts.channel ?? "billing";
  return {
    // Sort (name / price / stock / gstRate) and filters (category, GST rate, stock status when stock is wired, active).
    list: async (tenantId, query) => {
      const page = await service.listBillingItems(tenantId, { ...query, channel });
      return {
        items: page.items.map((i) => ({ ...toBillingItem(i), categoryId: i.categoryId ?? null, active: i.active, stockQty: i.stockQty, stockStatus: i.stockStatus })),
        total: page.total,
        facets: page.facets,
        categories: page.categories,
      };
    },
    get: (tenantId, id) => service.getItem(tenantId, id).then(toBillingItem, nullOn404),
    create: async (tenantId, input) =>
      toBillingItem(await service.createSimpleProduct(tenantId, { ...input, channels: ["billing", "store"] })),
    update: (tenantId, id, patch) => service.updateSimpleItem(tenantId, id, patch).then(toBillingItem, nullOn404),
    remove: (tenantId, id) =>
      service.removeItem(tenantId, id).then(
        () => true,
        (e: unknown) => {
          if (is404(e)) return false;
          throw e;
        },
      ),
  };
}

/** inventory's ItemCatalogPort over the catalogue (every channel; stock lists page through all variants). */
export function inventoryItemCatalog(service: CatalogueService) {
  return {
    getItems: (tenantId: string, ids: string[]): Promise<CatalogItem[]> => service.getItems(tenantId, ids),
    /** Every item, with its category's name (stock lists filter by category). */
    listItems: async (tenantId: string, q?: string): Promise<(CatalogItem & { categoryName: string | null })[]> => {
      const all: CatalogItem[] = [];
      const [cats] = await Promise.all([
        service.listCategories(tenantId),
        (async () => {
          for (let offset = 0; ; offset += 500) {
            const page = await service.listItems(tenantId, { q, limit: 500, offset });
            all.push(...page.items);
            if (page.items.length < 500 || all.length >= page.total) return;
          }
        })(),
      ]);
      const names = new Map(cats.items.map((c) => [c.id, c.name]));
      return all.map((i) => ({ ...i, categoryName: i.categoryId ? (names.get(i.categoryId) ?? null) : null }));
    },
  };
}
