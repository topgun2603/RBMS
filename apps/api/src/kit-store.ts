import { resolveCname, resolveTxt } from "node:dns/promises";
import { AppError, type FeatureGatePort } from "@rbms/core";
import { isPublicRef, type BookableServicesPort, type createCatalogue, type ProductRef, type StockSqlPort } from "@rbms/catalogue";
import { sql } from "@rbms/db";
import { stockItems } from "@rbms/inventory";
import type { CatalogPort as CmsCatalogPort, PublicProductSummary as CmsProductSummary } from "@rbms/cms";
import type { FulfillmentOrder, OrderFulfillmentPort } from "@rbms/delivery";
import type { createInventory } from "@rbms/inventory";
import type { createOrders, Order } from "@rbms/orders";
import type { AvailabilityPort, CatalogPort as StoreCatalogPort, OrdersPort as StoreOrdersPort, StoreOrder, VariantAvailability } from "@rbms/storefront";
import { VERIFY_RECORD_PREFIX, type DomainVerifier } from "@rbms/tenancy";

/**
 * Ports of the batch-2 store modules (storefront, delivery, cms, reviews, catalogue search) implemented over the
 * catalogue, inventory and orders services. Kept out of kit.ts so the composition root stays readable.
 */
type Catalogue = ReturnType<typeof createCatalogue>["service"];
type Inventory = ReturnType<typeof createInventory>["service"];
type Orders = ReturnType<typeof createOrders>["service"];

const is404 = (e: unknown) => e instanceof AppError && e.status === 404;
const nullOn404 = (e: unknown): null => {
  if (is404(e)) return null;
  throw e;
};

/** inventory's availability endpoints take at most 200 item ids per call. */
const AVAILABILITY_CHUNK = 200;
async function chunked<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += AVAILABILITY_CHUNK) out.push(...(await fetch(ids.slice(i, i + AVAILABILITY_CHUNK))));
  return out;
}

// ================================================================ catalogue (search ports)

/**
 * Catalogue search `inStock` filter: inventory's public availability. Shops without the inventory feature don't track
 * stock, so everything is in stock there.
 */
export function catalogueAvailability(inventory: () => Inventory, isEnabled: FeatureGatePort["isEnabled"]) {
  return {
    inStock: async (tenantId: string, variantIds: string[]): Promise<string[]> => {
      if (!(await isEnabled(tenantId, "inventory"))) return variantIds;
      const rows = await chunked(variantIds, async (itemIds) => (await inventory().publicAvailability(tenantId, { itemIds })).items);
      return rows.filter((r) => r.inStock).map((r) => r.itemId);
    },
  };
}

/**
 * Catalogue staff list stock column / filter / sort: one variant's `stock_items` rows summed over locations (inventory's
 * own aggregation: qty and reorder level are sums; untracked anywhere = untracked). Off without the inventory feature.
 */
export function catalogueStockSql(isEnabled: FeatureGatePort["isEnabled"]): StockSqlPort {
  return {
    variantLevels: (tenantId, variantId) =>
      sql`select sum(${stockItems.qty}) as qty, sum(${stockItems.reorderLevel}) as reorder, bool_and(${stockItems.track}) as track
        from ${stockItems} where ${stockItems.tenantId} = ${tenantId} and ${stockItems.itemId} = ${variantId}`,
    enabled: (tenantId) => isEnabled(tenantId, "inventory"),
  };
}

/**
 * Catalogue's bookable-services port over bookings: which variants are appointment services (active ones), their
 * duration, and whether they can be booked online (`bookings.online` on and the service online-bookable). Nothing
 * without the bookings feature.
 */
export function catalogueServicesPort(
  services: () => (tenantId: string) => Promise<{ id: string; itemId: string; durationMin: number; active: boolean; onlineBookable: boolean }[]>,
  isEnabled: FeatureGatePort["isEnabled"],
): BookableServicesPort {
  return {
    forVariants: async (tenantId, variantIds) => {
      if (!variantIds.length || !(await isEnabled(tenantId, "bookings"))) return [];
      const [rows, online] = await Promise.all([services()(tenantId), isEnabled(tenantId, "bookings.online")]);
      const wanted = new Set(variantIds);
      return rows
        .filter((s) => s.active && wanted.has(s.itemId))
        .map((s) => ({ variantId: s.itemId, serviceId: s.id, durationMin: s.durationMin, online: online && s.onlineBookable }));
    },
  };
}

// ================================================================ storefront

export function storeCatalogPort(catalogue: Catalogue): StoreCatalogPort {
  return {
    getVariants: async (tenantId, ids) =>
      (await catalogue.storeVariants(tenantId, ids)).map((v) => ({
        id: v.id,
        productId: v.productId,
        productSlug: v.productSlug,
        productName: v.productName,
        title: v.title,
        categoryId: v.categoryId,
        price: v.price,
        mrp: v.mrp,
        image: v.image,
        weightGrams: v.weightGrams,
        taxInclusive: v.taxInclusive,
        gstRate: v.gstRate,
        gstRule: v.gstRule ?? null,
        status: v.status,
        channels: v.channels,
      })),
    getProducts: async (tenantId, ids) =>
      (await catalogue.productRefs(tenantId, ids)).map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        image: p.image,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        mrp: p.mrp,
        status: p.status,
        channels: p.channels,
        categoryId: p.categoryId,
        variantIds: p.variantIds,
        optionNames: p.optionNames,
      })),
  };
}

/**
 * The store's stock check: inventory availability (qty − reserved). Untracked when the shop has no inventory feature
 * or allows backorders (orders then never refuses for stock either).
 */
export function storeAvailabilityPort(
  inventory: Inventory,
  isEnabled: FeatureGatePort["isEnabled"],
  allowBackorder: (tenantId: string) => Promise<boolean>,
  soldOut: SoldOutPort = async () => new Set(),
): AvailabilityPort {
  return {
    availability: async (tenantId, variantIds): Promise<VariantAvailability[]> => {
      if (variantIds.length === 0) return [];
      // Dishes the kitchen marked "sold out today" (made-to-order food has no stock, only this switch).
      const out = await soldOut(tenantId, variantIds);
      const gone = (itemId: string): VariantAvailability => ({ itemId, available: 0, tracked: true });
      if (!(await isEnabled(tenantId, "inventory")) || (await allowBackorder(tenantId))) {
        return variantIds.map((itemId) => (out.has(itemId) ? gone(itemId) : { itemId, available: 0, tracked: false }));
      }
      const rows = await chunked(variantIds, async (itemIds) => (await inventory.availability(tenantId, { itemIds })).items);
      return rows.map((r) => (out.has(r.itemId) ? gone(r.itemId) : r));
    },
  };
}

/** Variant ids the shop marked sold out today (restaurants: dining menu); empty without the dining feature. */
export type SoldOutPort = (tenantId: string, variantIds: string[]) => Promise<Set<string>>;

/**
 * `GET /store/availability`: what the storefront shows as "in stock" / "low stock". Inventory's flags for shops that
 * track stock; for the others everything is in stock except the dishes marked sold out today. Never a 403: shops without
 * stock tracking (restaurants, services) simply have nothing to report.
 */
export function storePublicAvailability(inventory: Inventory, isEnabled: FeatureGatePort["isEnabled"], soldOut: SoldOutPort) {
  return async (tenantId: string, variantIds: string[]): Promise<{ itemId: string; inStock: boolean; lowStock: boolean }[]> => {
    if (variantIds.length === 0) return [];
    const out = await soldOut(tenantId, variantIds);
    if (await isEnabled(tenantId, "inventory")) {
      const rows = await chunked(variantIds, async (itemIds) => (await inventory.publicAvailability(tenantId, { itemIds })).items);
      return rows.map((r) => (out.has(r.itemId) ? { itemId: r.itemId, inStock: false, lowStock: false } : r));
    }
    return variantIds.map((itemId) => ({ itemId, inStock: !out.has(itemId), lowStock: false }));
  };
}

/**
 * orders → the store's OrdersPort; `cancelForCustomer` = ownership check + the normal cancel transition. Store orders
 * go to the shop's default branch (`defaultBranch`, null when the shop doesn't use branches): its id and stock location.
 */
export function storeOrdersPort(
  orders: Orders,
  defaultBranch: (tenantId: string) => Promise<{ id: string; locationId: string | null } | null> = async () => null,
): StoreOrdersPort {
  return {
    createFromCheckout: async (tenant, input) => {
      const branch = await defaultBranch(tenant.id);
      return (await orders.createFromCheckout(tenant, { ...input, branchId: branch?.id ?? null, locationId: branch?.locationId ?? null })) as StoreOrder;
    },
    listForCustomer: (tenantId, accountId, query) => orders.listForCustomer(tenantId, accountId, query),
    getForCustomer: async (tenantId, accountId, orderId) => (await orders.getForCustomer(tenantId, accountId, orderId)) as StoreOrder,
    getByToken: async (token, tenantId) => (await orders.getByToken(token, tenantId)) as StoreOrder,
    cancelForCustomer: async (tenantId, accountId, orderId, reason) => {
      await orders.getForCustomer(tenantId, accountId, orderId);
      await orders.updateStatus(tenantId, orderId, { status: "cancelled", note: `Cancelled by the customer: ${reason}`.slice(0, 500) }, null);
      return (await orders.getForCustomer(tenantId, accountId, orderId)) as StoreOrder;
    },
  };
}

// ================================================================ delivery

const toFulfillmentOrder = (o: Order): FulfillmentOrder => ({
  id: o.id,
  number: o.number,
  status: o.status,
  customer: { name: o.customer.name, phone: o.customer.phone, email: o.customer.email },
  shippingAddress: o.shippingAddress,
  lines: o.lines.map((l) => ({ name: l.name, sku: l.sku, qty: l.qty, price: l.price })),
  total: o.total,
  paymentMethod: o.paymentMethod,
  balance: o.balance,
});

/** Shipment status → order status. Idempotent: an order already at (or past) the status is left alone. */
export function fulfillmentPort(orders: Orders): OrderFulfillmentPort {
  const advance = async (tenantId: string, orderId: string, to: "shipped" | "delivered", skip: readonly string[]) => {
    const o = await orders.get(tenantId, orderId).catch(nullOn404);
    if (!o || skip.includes(o.status)) return;
    // updateStatus walks the skipped steps (placed → confirmed → packed → shipped → delivered) with their effects.
    await orders.updateStatus(tenantId, orderId, { status: to, note: to === "shipped" ? "Shipped (courier update)" : "Delivered (courier update)" }, null);
  };
  return {
    getOrder: async (tenantId, orderId) => {
      const o = await orders.get(tenantId, orderId).catch(nullOn404);
      return o ? toFulfillmentOrder(o) : null;
    },
    // All-null fields (after a cancelled shipment) clear the tracking details.
    setFulfillment: async (tenantId, orderId, f) => {
      await orders.updateFulfillment(tenantId, orderId, {
        carrier: f.carrier,
        trackingNumber: f.trackingNumber,
        trackingUrl: f.trackingUrl,
        shipmentId: f.shipmentId,
      });
    },
    markShipped: (tenantId, orderId) => advance(tenantId, orderId, "shipped", ["shipped", "delivered", "returned", "cancelled"]),
    markDelivered: (tenantId, orderId) => advance(tenantId, orderId, "delivered", ["delivered", "returned", "cancelled"]),
  };
}

// ================================================================ cms

const toCmsSummary = (p: ProductRef | CmsProductSummary): CmsProductSummary => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  categoryId: p.categoryId,
  categoryName: p.categoryName,
  image: p.image,
  priceMin: p.priceMin,
  priceMax: p.priceMax,
  mrp: p.mrp,
  variantCount: p.variantCount,
  taxInclusive: p.taxInclusive,
  ...(p.kind ? { kind: p.kind } : {}),
  ...(p.service ? { service: p.service } : {}),
});

export function cmsCatalogPort(catalogue: Catalogue): CmsCatalogPort {
  return {
    categories: async (tenantId, ids) => {
      const all = (await catalogue.publicCategories(tenantId)).items;
      const wanted = ids ? all.filter((c) => ids.includes(c.id)) : all;
      return wanted.map((c) => ({ id: c.id, name: c.name, slug: c.slug, image: c.imageUrl }));
    },
    collection: async (tenantId, slug, limit) => {
      const page = await catalogue.publicCollection(tenantId, slug, { limit, offset: 0 }).catch(nullOn404);
      return page ? { name: page.collection.name, slug: page.collection.slug, products: page.items.map(toCmsSummary) } : null;
    },
    productsByIds: async (tenantId, ids) => (await catalogue.withServices(tenantId, (await catalogue.productRefs(tenantId, ids)).filter(isPublicRef))).map(toCmsSummary),
    newest: async (tenantId, limit) => (await catalogue.publicProducts(tenantId, { sort: "new", limit })).items.map(toCmsSummary),
  };
}

/**
 * STORE_PUBLIC_URL is one template ("http://{slug}.localhost:3003") or per-app templates ("EC=…,BL=…"), like
 * BILLING_PUBLIC_URL. A verified custom domain wins (https).
 */
export function storeBaseUrl(template: (appId: string | null) => string, tenant: { slug: string; appId: string | null }, customDomain: string | null): string {
  if (customDomain) return `https://${customDomain}`;
  return template(tenant.appId).replace("{slug}", tenant.slug).replace(/\/+$/, "");
}

// ================================================================ tenancy custom domains

type TxtResolver = (host: string) => Promise<string[][]>;
type CnameResolver = (host: string) => Promise<string[]>;

/**
 * DNS check with node:dns/promises: TXT `_rbms-verify.<domain>` (chunks joined) equals the token; CNAME includes the
 * platform target. Lookup errors (NXDOMAIN, timeouts) count as "not found".
 */
export function dnsDomainVerifier(cnameTarget: string, dns: { resolveTxt: TxtResolver; resolveCname: CnameResolver } = { resolveTxt, resolveCname }): DomainVerifier {
  const target = cnameTarget.toLowerCase().replace(/\.$/, "");
  return async (domain, { token }) => {
    const txt = await dns
      .resolveTxt(`${VERIFY_RECORD_PREFIX}.${domain}`)
      .then((records) => records.some((chunks) => chunks.join("").trim() === token))
      .catch(() => false);
    const cname = await dns
      .resolveCname(domain)
      .then((names) => names.some((n) => n.toLowerCase().replace(/\.$/, "") === target))
      .catch(() => false);
    return { txt, cname };
  };
}
