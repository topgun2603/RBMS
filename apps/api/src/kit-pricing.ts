import type { CatalogItem, CatalogueService } from "@srirealtime/catalogue";
import { findUnit } from "@srirealtime/catalogue";
import { and, eq, inArray, isNull, type Db } from "@srirealtime/db";
import { lineAmount } from "@srirealtime/gst";
import { pricesExporter, pricesImporter, type CommitResult, type CommitRow, type ImportExportRegistry, type PriceExportRow, type PriceImportRow } from "@srirealtime/importexport";
import { billingCustomers } from "@srirealtime/invoices";
import { createPriceLists, PRICE_LISTS_FEATURE, resolvePrice, type PricingItemRecord, type PriceListsService, type ResolvedPrice } from "@srirealtime/pricelists";
import type { FastifyRequest } from "fastify";

/**
 * Price lists and alternate units on bill lines (docs/price-lists-units.md).
 *
 * - `createPriceListsWiring`: the pricelists module over the catalogue (items with their units) and invoices' customers.
 * - `prepareLines`: for every line of a saved item, the unit is checked against the catalogue and the line gets the
 *   server's `unitFactor` / `baseUnit` (a client can't move stock by sending its own factor); a line sent without a
 *   `rate` is priced from the customer's list (or the `priceListId` in the body), the shop's default list and the
 *   item price, and its description / HSN / GST are filled when missing.
 * - `linePricingGuard`: runs `prepareLines` before the route's other guards, so discount limits judge the price the
 *   bill will really have.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Line = Record<string, unknown>;

export const toPricingItem = (i: CatalogItem): PricingItemRecord => ({
  id: i.id,
  name: i.name,
  sku: i.sku,
  barcode: i.barcode,
  unit: i.unit,
  price: i.price,
  taxInclusive: i.taxInclusive,
  gstRate: i.gstRate,
  gstRule: i.gstRule ?? null,
  units: (i.units ?? []).map((u) => ({ unit: u.unit, factor: u.factor, ownPrice: u.ownPrice })),
});

export interface PricingWiringDeps {
  db: Db;
  catalogue: () => CatalogueService;
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  log?: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

export function createPriceListsWiring(d: PricingWiringDeps) {
  const priceLists = createPriceLists({
    db: d.db,
    log: d.log,
    items: { items: async (tenantId, ids) => (await d.catalogue().getItems(tenantId, ids)).map(toPricingItem) },
    customers: {
      names: async (tenantId, ids) => {
        const valid = [...new Set(ids)].filter((id) => UUID.test(id));
        if (!valid.length) return [];
        return d.db
          .select({ id: billingCustomers.id, name: billingCustomers.name, phone: billingCustomers.phone })
          .from(billingCustomers)
          .where(and(eq(billingCustomers.tenantId, tenantId), inArray(billingCustomers.id, valid), isNull(billingCustomers.deletedAt)));
      },
    },
  });
  const prepare = lineUnitsAndPrices({ catalogue: d.catalogue, priceLists: priceLists.service, isEnabled: d.isEnabled });
  return { ...priceLists, prepareLines: prepare };
}

export interface PrepareOptions {
  customerId?: string | null;
  /** A list picked on the document ("none" = item prices). */
  priceListId?: string | null;
  date?: string | null;
  /** Purchases: units only, never prices (the supplier's rate is typed in). */
  unitsOnly?: boolean;
}

const missing = (v: unknown) => v === undefined || v === null || v === "";

/** See the file comment. Returns new line objects; lines that aren't objects are passed through untouched. */
export function lineUnitsAndPrices(d: { catalogue: () => CatalogueService; priceLists: PriceListsService; isEnabled: (tenantId: string, key: string) => Promise<boolean> }) {
  return async (tenantId: string, lines: unknown[], opts: PrepareOptions = {}): Promise<unknown[]> => {
    const ids = [
      ...new Set(
        lines
          .map((l) => (l && typeof l === "object" ? (l as Line).itemId : null))
          .filter((x): x is string => typeof x === "string" && UUID.test(x)),
      ),
    ];
    const items = new Map(ids.length ? (await d.catalogue().getItems(tenantId, ids)).map((i) => [i.id, i]) : []);
    const out = lines.map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const l: Line = { ...(raw as Line) };
      delete l.unitFactor;
      delete l.baseUnit;
      const item = typeof l.itemId === "string" ? items.get(l.itemId) : undefined;
      if (!item) return l;
      const u = findUnit(item.units, typeof l.unit === "string" ? l.unit : null);
      if (u) {
        l.unit = u.unit;
        l.unitFactor = u.factor;
        l.baseUnit = item.unit;
      }
      return l;
    });
    if (opts.unitsOnly) return out;
    const toPrice = out
      .map((l, i) => ({ l: l as Line, i }))
      .filter(({ l }) => l && typeof l === "object" && typeof l.itemId === "string" && items.has(l.itemId) && missing(l.rate));
    if (toPrice.length === 0) return out;

    const asked = toPrice.map(({ l }) => ({ itemId: l.itemId as string, unit: typeof l.unit === "string" ? l.unit : null, qty: typeof l.qty === "number" && l.qty > 0 ? l.qty : 1 }));
    let resolved: ResolvedPrice[];
    if (await d.isEnabled(tenantId, PRICE_LISTS_FEATURE)) {
      const customerId = typeof opts.customerId === "string" && UUID.test(opts.customerId) ? opts.customerId : null;
      const priceListId = opts.priceListId === "none" || (typeof opts.priceListId === "string" && UUID.test(opts.priceListId)) ? opts.priceListId : null;
      const date = typeof opts.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : undefined;
      resolved = (await d.priceLists.resolve(tenantId, { customerId, priceListId, date, lines: asked })).lines;
    } else {
      // No price lists for this shop: the item's own price for the unit.
      resolved = asked.map((a) => resolvePrice({ item: toPricingItem(items.get(a.itemId)!), unit: a.unit, qty: a.qty, date: "", lists: [] }));
    }
    toPrice.forEach(({ l }, k) => {
      const r = resolved[k];
      const item = items.get(l.itemId as string)!;
      if (!r) return;
      l.rate = r.rate;
      if (missing(l.description)) l.description = item.name;
      if (missing(l.hsn) && item.hsn) l.hsn = item.hsn;
      if (missing(l.unit)) l.unit = r.unit;
      if (missing(l.gstRate)) l.gstRate = r.gstRate;
      if (missing(l.gstRule) && item.gstRule) l.gstRule = item.gstRule;
      // A tax-inclusive (MRP) price is charged exactly: GST comes out of it instead of a rounded rate plus GST.
      if (item.taxInclusive && r.gstRate > 0 && missing(l.discount) && missing(l.inclusiveTotal) && typeof l.qty === "number") {
        l.inclusiveTotal = lineAmount(l.qty, r.price);
      }
    });
    return out;
  };
}

type Prepare = ReturnType<typeof lineUnitsAndPrices>;

/** Fills `req.body.lines` (see `lineUnitsAndPrices`). The body's `customerId`, `priceListId` and `date` steer the price. */
export function linePricingGuard(prepare: () => Prepare, opts: { unitsOnly?: boolean } = {}) {
  return async (req: FastifyRequest): Promise<void> => {
    const tenant = req.ctx.tenant;
    const b = req.body as { lines?: unknown; customerId?: unknown; priceListId?: unknown; date?: unknown } | null;
    if (!tenant || !b || typeof b !== "object" || !Array.isArray(b.lines)) return;
    b.lines = await prepare()(tenant.id, b.lines, {
      customerId: typeof b.customerId === "string" ? b.customerId : null,
      priceListId: typeof b.priceListId === "string" ? b.priceListId : null,
      date: typeof b.date === "string" ? b.date : null,
      unitsOnly: opts.unitsOnly,
    });
  };
}

const BILL = "/v1/invoices/:id([0-9a-fA-F-]{36})";
const QUOTE = "/v1/quotations/:id([0-9a-fA-F-]{36})";
const SD = "/v1/sales-docs";

/** Routes that take document lines: priced and unit-checked. */
export const PRICED_LINE_ROUTES = [
  "POST /v1/invoices/",
  `PATCH ${BILL}`,
  "POST /v1/quotations/",
  `PATCH ${QUOTE}`,
  `POST ${QUOTE}/revise`,
  `POST ${SD}/proformas`,
  `PATCH ${SD}/proformas/:id([0-9a-fA-F-]{36})`,
  `POST ${SD}/sale-orders`,
  `PATCH ${SD}/sale-orders/:id([0-9a-fA-F-]{36})`,
  `POST ${SD}/challans`,
  // Recurring bill profiles (docs/recurring-export-gstin.md): units checked and lines priced when saved.
  "POST /v1/recurring/",
  "PATCH /v1/recurring/:id([0-9a-fA-F-]{36})",
] as const;
/** Purchase documents: units only (the supplier's rate is typed in). */
export const UNIT_LINE_ROUTES = [
  "POST /v1/inventory/purchases",
  "PATCH /v1/inventory/purchases/:id",
  "POST /v1/inventory/purchase-orders",
  "PATCH /v1/inventory/purchase-orders/:id",
] as const;

/** `rules` with the line guard put first on the line routes (it must run before discount limits look at the rates). */
export function withLinePricing(
  rules: Record<string, (req: FastifyRequest) => Promise<void>>,
  prepare: () => Prepare,
): Record<string, (req: FastifyRequest) => Promise<void>> {
  const out = { ...rules };
  const add = (key: string, guard: (req: FastifyRequest) => Promise<void>) => {
    const next = out[key];
    out[key] = next
      ? async (req) => {
          await guard(req);
          await next(req);
        }
      : guard;
  };
  const priced = linePricingGuard(prepare);
  const units = linePricingGuard(prepare, { unitsOnly: true });
  for (const k of PRICED_LINE_ROUTES) add(k, priced);
  for (const k of UNIT_LINE_ROUTES) add(k, units);
  return out;
}

// ================================================================ import / export of list prices

/**
 * `pricelists.prices` importer and exporter (packages/importexport specs). Lists are matched by name (created when
 * missing); items by SKU, barcode or exact name; a row for the same list + item + unit + slab replaces the price.
 */
export function registerPriceImportExport(registry: ImportExportRegistry, d: { priceLists: PriceListsService; catalogue: () => CatalogueService }) {
  registry.registerImporter(
    pricesImporter({
      upsert: async (tenantId, rows: CommitRow<PriceImportRow>[]): Promise<CommitResult> => {
        const result: Required<CommitResult> = { created: 0, updated: 0, errors: [], records: [] };
        const lists = new Map<string, string>();
        const items = new Map<string, CatalogItem | null>();
        const findItem = async (ref: string): Promise<CatalogItem | null> => {
          const k = ref.trim().toLowerCase();
          if (items.has(k)) return items.get(k)!;
          let hit: CatalogItem | null = await d.catalogue().lookupCode(tenantId, ref.trim()).catch(() => null);
          if (!hit) {
            const page = await d.catalogue().listItems(tenantId, { q: ref.trim().slice(0, 100), limit: 20 });
            hit = page.items.find((i) => i.name.trim().toLowerCase() === k) ?? null;
          }
          if (hit) hit = (await d.catalogue().getItems(tenantId, [hit.id]))[0] ?? null;
          items.set(k, hit);
          return hit;
        };
        const byList = new Map<string, { row: number; itemId: string; unit: string | null; minQty: number; price: number }[]>();
        for (const { row, data } of rows) {
          try {
            const lk = data.list.trim().toLowerCase();
            let listId = lists.get(lk);
            if (!listId) {
              listId = (await d.priceLists.listByName(tenantId, data.list))?.id ?? (await d.priceLists.createList(tenantId, { name: data.list.trim() })).id;
              lists.set(lk, listId);
            }
            const item = await findItem(data.item);
            if (!item) throw new Error(`No item with SKU, barcode or name "${data.item}"`);
            const isBase = !data.unit || data.unit.trim().toLowerCase() === item.unit.trim().toLowerCase();
            const u = isBase ? null : findUnit(item.units, data.unit);
            if (!isBase && !u) throw new Error(`${item.name} has no unit "${data.unit}"`);
            byList.set(listId, [...(byList.get(listId) ?? []), { row, itemId: item.id, unit: u?.unit ?? null, minQty: data.minQty, price: data.price }]);
          } catch (e) {
            result.errors.push({ row, message: e instanceof Error ? e.message : String(e) });
          }
        }
        for (const [listId, entries] of byList) {
          try {
            result.updated += await d.priceLists.upsertEntries(tenantId, listId, entries);
          } catch (e) {
            for (const x of entries) result.errors.push({ row: x.row, message: e instanceof Error ? e.message : String(e) });
          }
        }
        return result;
      },
    }),
  );
  registry.registerExporter(
    pricesExporter({
      rows: async (tenantId) => {
        const all = await d.priceLists.allEntries(tenantId);
        const items = new Map((await d.catalogue().getItems(tenantId, [...new Set(all.map((x) => x.entry.itemId))])).map((i) => [i.id, i]));
        return all.map(({ list, entry }): PriceExportRow => ({
          list: list.name,
          item: items.get(entry.itemId)?.name ?? entry.itemId,
          sku: items.get(entry.itemId)?.sku ?? null,
          unit: entry.unit,
          minQty: Number(entry.minQty),
          price: entry.price,
        }));
      },
    }),
  );
}
