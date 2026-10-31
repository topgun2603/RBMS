import { createAggregators, drizzleStore, fetchHttp, type KitchenPort, type MenuPort } from "@rbms/aggregators";
import type { CatalogueService } from "@rbms/catalogue";
import type { FeatureGatePort } from "@rbms/core";
import type { Db } from "@rbms/db";
import type { createDining } from "@rbms/dining";
import type { Logger } from "pino";

/**
 * Zomato / Swiggy / ONDC orders (packages/aggregators) wired to the restaurant's kitchen (dining) and menu (catalogue
 * + dining's veg / sold-out flags). Webhook URLs are built on API_PUBLIC_URL; secrets are encrypted with APP_SECRET.
 */
export function createAggregatorsWiring(deps: {
  db: Db;
  dining: ReturnType<typeof createDining>;
  catalogue: { service: Pick<CatalogueService, "listItems" | "listCategories" | "getItems"> };
  features: FeatureGatePort;
  encryptionKey: string;
  publicBaseUrl: string;
  log: Logger;
}) {
  const dining = deps.dining.service;

  const kitchen: KitchenPort = {
    open: async (tenantId, i) => {
      const o = await dining.openExternal(tenantId, {
        ref: i.ref,
        type: i.type,
        platform: i.platform,
        customerName: i.customerName,
        customerPhone: i.customerPhone,
        note: i.note,
        dueAt: i.dueAt,
        taxByOperator: i.taxByOperator,
        lines: i.lines,
        send: i.send,
      });
      return { id: o.id, number: o.number };
    },
    send: async (tenantId, id) => {
      await dining.sendKot(tenantId, id, null);
    },
    setDue: (tenantId, id, dueAt) => dining.setDue(tenantId, id, dueAt),
    cancel: async (tenantId, id, reason) => {
      await dining.cancel(tenantId, id, { reason });
    },
    settle: async (tenantId, id) => {
      await dining.settleWithoutBill(tenantId, id);
    },
    state: async (tenantId, id) => {
      const o = await dining.get(tenantId, id).catch(() => null);
      return o ? { status: o.status, number: o.number, kots: o.kots.map((k) => ({ status: k.status })) } : null;
    },
    orderOfKot: (tenantId, kotId) => dining.orderOfKot(tenantId, kotId),
  };

  const menu: MenuPort = {
    list: async (tenantId) => {
      const [items, flags] = await Promise.all([deps.catalogue.service.listItems(tenantId, { limit: 500 }), dining.menuItems(tenantId)]);
      const byItem = new Map(flags.map((f) => [f.itemId, f]));
      return items.items.map((i) => ({
        id: i.id,
        name: i.name,
        rate: i.rate,
        gstRate: i.gstRate,
        categoryId: i.categoryId ?? null,
        image: i.image,
        veg: byItem.get(i.id)?.veg ?? null,
        available: byItem.get(i.id)?.available ?? true,
      }));
    },
    categories: async (tenantId) => (await deps.catalogue.service.listCategories(tenantId)).items.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, sort: c.sort })),
    existing: async (tenantId, ids) => (ids.length ? (await deps.catalogue.service.getItems(tenantId, ids)).map((i) => i.id) : []),
  };

  return createAggregators({
    store: drizzleStore(deps.db),
    kitchen,
    menu,
    http: fetchHttp(10_000),
    features: deps.features,
    config: { encryptionKey: deps.encryptionKey, publicBaseUrl: deps.publicBaseUrl },
    log: deps.log,
  });
}
