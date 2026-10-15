import { AppError } from "@srirealtime/core";
import type { Channel } from "./schema";
import type { CatalogueService } from "./service";
import type { CatalogItem } from "./types";

/** Billing's saved-item shape (`rate` = GST-exclusive paise). Structurally equal to invoices' item-source record. */
export interface BillingItemRecord {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
  createdAt: Date;
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
  list(tenantId: string, query: { q?: string; limit: number; offset: number }): Promise<{ items: BillingItemRecord[]; total: number }>;
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
  createdAt: i.createdAt,
});

/**
 * invoices' ItemSourcePort over the catalogue: lists variants sold on `channel` (default "billing"); creates simple
 * products (one default variant, channels billing + store); edits write name/hsn/unit/gst to the product and the rate to
 * the variant; deletes remove the variant (or the product when it is the only one).
 */
export function billingItemSource(service: CatalogueService, opts: { channel?: Channel } = {}): BillingItemSource {
  const channel = opts.channel ?? "billing";
  return {
    list: async (tenantId, { q, limit, offset }) => {
      const page = await service.listItems(tenantId, { q, limit, offset, channel });
      return { items: page.items.map(toBillingItem), total: page.total };
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
    listItems: async (tenantId: string, q?: string): Promise<CatalogItem[]> => {
      const all: CatalogItem[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await service.listItems(tenantId, { q, limit: 500, offset });
        all.push(...page.items);
        if (page.items.length < 500 || all.length >= page.total) return all;
      }
    },
  };
}
