import { AppError, badRequest, defineSort, facetCounts, listFilter, listQuerySchema, notFound, searchAny, type ListPage } from "@rbms/core";
import type { Db, Tx } from "@rbms/db";
import { and, asc, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { buildScaleBarcode, maxPlu, parseScaleBarcode, scaleFormatProblem } from "./barcode";
import { formatOf, lineFromLabel, nextFreePlu, pluCsv, resolveScalesSettings, roundQty, SCALES_SETTINGS_SCHEMA, type ScalesSettings } from "./logic";
import { noopLogger, type CatalogPort, type LoggerPort, type ScaleCatalogVariant, type ScalesSettingsPort } from "./ports";
import { SCALE_SOLD_BY, scaleItems, type ScaleItemRow, type ScaleSoldBy } from "./schema";

export interface ScalesDeps {
  db: Db;
  /** Catalogue variants: names and prices. */
  catalog: CatalogPort;
  /** Settings namespace `scales`. Without it the default format applies and `PUT /settings` is refused. */
  settings?: ScalesSettingsPort;
  log?: LoggerPort;
}

const MAX_PAISE = 2_000_000_000;
const CHUNK = 500;

export const scaleItemInput = z
  .object({
    /** Omit (or null) for the next free PLU; an existing item keeps its PLU. */
    plu: z.number().int().min(1).max(99_999).nullish(),
    soldBy: z.enum(SCALE_SOLD_BY).default("weight"),
    tareGrams: z.number().int().min(0).max(100_000).default(0),
    unitLabel: z.string().trim().min(1).max(20).optional(),
    active: z.boolean().default(true),
    /** Also set the catalogue price (paise per unit). */
    price: z.number().int().min(0).max(MAX_PAISE).optional(),
  })
  .strict();
export type ScaleItemInput = z.input<typeof scaleItemInput>;

export const priceListInput = z
  .object({
    items: z
      .array(z.object({ itemId: z.string().uuid(), price: z.number().int().min(0).max(MAX_PAISE) }).strict())
      .min(1)
      .max(CHUNK),
  })
  .strict();
export type PriceListInput = z.input<typeof priceListInput>;

export const scaleItemListQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 500 }).extend({
  soldBy: listFilter.oneOf(SCALE_SOLD_BY),
  active: listFilter.bool(),
});
export type ScaleItemListQuery = z.input<typeof scaleItemListQuery>;

export const SCALE_ITEM_SORT = defineSort(
  { plu: scaleItems.plu, name: sql`lower(${scaleItems.name})`, updated: scaleItems.updatedAt, priced: scaleItems.priceUpdatedAt },
  { default: "plu", tieBreaker: [scaleItems.id] },
);

export const labelQuery = z.object({ weight: z.coerce.number().positive().max(100_000) });

/** A scale item with the catalogue's current price (null fields when the variant is gone). */
export interface ScaleItemView extends ScaleItemRow {
  /** Paise per unit (per kg for weighed items), incl. GST when `taxInclusive`; null when the catalogue item is missing. */
  price: number | null;
  taxInclusive: boolean | null;
  gstRate: number | null;
  /** The catalogue unit ("kg", "pcs"). */
  unit: string | null;
  sku: string | null;
  /** The catalogue item no longer exists. */
  missing: boolean;
}

/** What the POS adds to the bill for a scanned scale label. */
export interface ResolvedScaleCode {
  itemId: string;
  /** kg for weighed items (net of tare), pieces for counted ones. */
  qty: number;
  /** Price labels only: the label's amount in paise (incl. GST when the item's price is) — bill exactly this. */
  price?: number;
  plu: number;
  name: string;
  soldBy: ScaleSoldBy;
  /** The catalogue price per unit (paise). */
  unitPrice: number;
}

export interface ScaleLabelPreview {
  code: string;
  plu: number;
  weightKg: number;
  /** The amount printed on price labels (paise); null for weight labels. */
  pricePaise: number | null;
  format: ScalesSettings;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export class ScalesService {
  private readonly db: Db;
  private readonly log: LoggerPort;

  constructor(private readonly deps: ScalesDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<ScalesSettings> {
    if (!this.deps.settings) return resolveScalesSettings(null);
    try {
      return resolveScalesSettings(await this.deps.settings.get(tenantId));
    } catch (err) {
      this.log.warn({ err, tenantId }, "scales: settings unavailable, using defaults");
      return resolveScalesSettings(null);
    }
  }

  /** Validates a patch (the merged format must work as a whole) and stores it on the tenant layer. */
  async updateSettings(tenantId: string, patch: unknown): Promise<ScalesSettings> {
    const port = this.deps.settings;
    if (!port?.set) throw badRequest("Scale settings can't be changed here");
    const p = SCALES_SETTINGS_SCHEMA.partial().strict().parse(patch ?? {});
    if (p.prefixes) p.prefixes = [...new Set(p.prefixes)].sort();
    const merged = SCALES_SETTINGS_SCHEMA.parse({ ...(await this.getSettings(tenantId)), ...p });
    const problem = scaleFormatProblem(merged);
    if (problem) throw badRequest(problem, { field: "format" });
    const [over] = await this.db
      .select({ n: count() })
      .from(scaleItems)
      .where(and(eq(scaleItems.tenantId, tenantId), sql`${scaleItems.plu} > ${maxPlu(merged)}`));
    if ((over?.n ?? 0) > 0) throw badRequest(`${over!.n} items have PLUs longer than ${merged.pluDigits} digits`, { field: "pluDigits" });
    await port.set(tenantId, p);
    return merged;
  }

  // ---------------------------------------------------------------- catalogue

  private async variantMap(tenantId: string, ids: string[]): Promise<Map<string, ScaleCatalogVariant>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, ScaleCatalogVariant>();
    for (let i = 0; i < unique.length; i += CHUNK) {
      for (const v of await this.deps.catalog.variants(tenantId, unique.slice(i, i + CHUNK))) out.set(v.id, v);
    }
    return out;
  }

  private view(row: ScaleItemRow, v: ScaleCatalogVariant | undefined): ScaleItemView {
    return {
      ...row,
      price: v?.price ?? null,
      taxInclusive: v?.taxInclusive ?? null,
      gstRate: v?.gstRate ?? null,
      unit: v?.unit ?? null,
      sku: v?.sku ?? null,
      missing: !v,
    };
  }

  private async views(tenantId: string, rows: ScaleItemRow[]): Promise<ScaleItemView[]> {
    if (rows.length === 0) return [];
    const vs = await this.variantMap(tenantId, rows.map((r) => r.itemId));
    return rows.map((r) => this.view(r, vs.get(r.itemId)));
  }

  // ---------------------------------------------------------------- items

  /** WHERE of the item list; without `soldBy` for its facet counts. */
  listConditions(tenantId: string, q: z.output<typeof scaleItemListQuery>, withSoldBy = true): SQL | undefined {
    const pluTerm = q.q && /^\d{1,6}$/.test(q.q) ? eq(scaleItems.plu, Number(q.q)) : undefined;
    const text = searchAny(q.q, [scaleItems.name]);
    return and(
      eq(scaleItems.tenantId, tenantId),
      withSoldBy && q.soldBy?.length ? inArray(scaleItems.soldBy, q.soldBy) : undefined,
      q.active !== undefined ? eq(scaleItems.active, q.active) : undefined,
      pluTerm && text ? sql`(${pluTerm} or ${text})` : text,
    );
  }

  /** Scale items (paged; q = name or PLU, soldBy, active; sort plu | name | updated | priced) with today's prices. */
  async listItems(tenantId: string, query: ScaleItemListQuery = {}): Promise<ListPage<ScaleItemView> & { facets: Record<string, Record<string, number>> }> {
    const q = scaleItemListQuery.parse(query);
    const order = SCALE_ITEM_SORT.orderBy(q.sort);
    const where = this.listConditions(tenantId, q);
    const [rows, [total], bySoldBy] = await Promise.all([
      this.db.select().from(scaleItems).where(where).orderBy(...order).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(scaleItems).where(where),
      this.db.select({ key: scaleItems.soldBy, n: count() }).from(scaleItems).where(this.listConditions(tenantId, q, false)).groupBy(scaleItems.soldBy),
    ]);
    return {
      items: await this.views(tenantId, rows),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { soldBy: facetCounts(bySoldBy) },
    };
  }

  private async row(tenantId: string, itemId: string, tx: Db | Tx = this.db): Promise<ScaleItemRow | null> {
    const [row] = await tx
      .select()
      .from(scaleItems)
      .where(and(eq(scaleItems.tenantId, tenantId), eq(scaleItems.itemId, itemId)))
      .limit(1);
    return row ?? null;
  }

  async getItem(tenantId: string, itemId: string): Promise<ScaleItemView> {
    const row = await this.row(tenantId, itemId);
    if (!row) throw notFound("Scale item");
    const [view] = await this.views(tenantId, [row]);
    return view!;
  }

  /**
   * Adds or updates a scale item. The PLU is the one given, else the item's current one, else the next free one
   * (taken under an advisory lock so two saves can't hand out the same code). `price` also sets the catalogue price.
   */
  async saveItem(tenantId: string, itemId: string, input: unknown): Promise<ScaleItemView> {
    const body = scaleItemInput.parse(input ?? {});
    const [variant] = await this.deps.catalog.variants(tenantId, [itemId]);
    if (!variant) throw notFound("Item");
    const settings = await this.getSettings(tenantId);
    const max = maxPlu(settings);
    if (body.plu != null && body.plu > max) throw badRequest(`PLU must be 1 to ${max} for ${settings.pluDigits}-digit codes`, { field: "plu" });
    const unitLabel = body.unitLabel ?? (body.soldBy === "piece" ? variant.unit || "pc" : "kg");

    let row: ScaleItemRow;
    try {
      row = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`scales:plu:${tenantId}`}))`);
        const existing = await this.row(tenantId, itemId, tx);
        let plu = body.plu ?? existing?.plu ?? null;
        if (plu !== null) {
          const [taken] = await tx
            .select({ name: scaleItems.name })
            .from(scaleItems)
            .where(and(eq(scaleItems.tenantId, tenantId), eq(scaleItems.plu, plu), ne(scaleItems.itemId, itemId)))
            .limit(1);
          if (taken) throw new AppError(409, "plu_taken", `PLU ${plu} is already used by ${taken.name}`, { field: "plu", plu, name: taken.name });
        } else {
          const used = await tx.select({ plu: scaleItems.plu }).from(scaleItems).where(eq(scaleItems.tenantId, tenantId));
          plu = nextFreePlu(
            used.map((u) => u.plu),
            max,
          );
          if (plu === null) throw new AppError(409, "plu_full", `All ${max} PLUs are in use`, { field: "plu" });
        }
        const values = {
          name: variant.name,
          plu,
          soldBy: body.soldBy,
          tareGrams: body.tareGrams,
          unitLabel,
          active: body.active,
          ...(body.price !== undefined ? { priceUpdatedAt: new Date() } : {}),
        };
        const [saved] = await tx
          .insert(scaleItems)
          .values({ tenantId, itemId, ...values })
          .onConflictDoUpdate({ target: [scaleItems.tenantId, scaleItems.itemId], set: { ...values, updatedAt: new Date() } })
          .returning();
        return saved!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, "plu_taken", "That PLU is already in use", { field: "plu" });
      throw err;
    }

    if (body.price !== undefined && body.price !== variant.price) {
      await this.deps.catalog.setPrice(tenantId, itemId, body.price);
      return this.view(row, { ...variant, price: body.price });
    }
    return this.view(row, variant);
  }

  async removeItem(tenantId: string, itemId: string): Promise<void> {
    const gone = await this.db
      .delete(scaleItems)
      .where(and(eq(scaleItems.tenantId, tenantId), eq(scaleItems.itemId, itemId)))
      .returning({ id: scaleItems.id });
    if (gone.length === 0) throw notFound("Scale item");
  }

  /**
   * Today's prices: sets each item's catalogue price (paise per unit). Every item must be a scale item of the shop.
   * Returns the updated items.
   */
  async setPrices(tenantId: string, input: unknown): Promise<{ items: ScaleItemView[] }> {
    const body = priceListInput.parse(input ?? {});
    const prices = new Map(body.items.map((i) => [i.itemId, i.price]));
    const ids = [...prices.keys()];
    const rows = await this.db
      .select()
      .from(scaleItems)
      .where(and(eq(scaleItems.tenantId, tenantId), inArray(scaleItems.itemId, ids)));
    const known = new Set(rows.map((r) => r.itemId));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) throw badRequest("Some items aren't on the scale list", { field: "items", itemIds: unknown });

    const variants = await this.variantMap(tenantId, ids);
    const changed: string[] = [];
    for (const [itemId, price] of prices) {
      const v = variants.get(itemId);
      if (!v) continue;
      if (v.price !== price) {
        await this.deps.catalog.setPrice(tenantId, itemId, price);
        variants.set(itemId, { ...v, price });
      }
      changed.push(itemId);
    }
    let updated = rows;
    if (changed.length) {
      updated = await this.db
        .update(scaleItems)
        .set({ priceUpdatedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(scaleItems.tenantId, tenantId), inArray(scaleItems.itemId, changed)))
        .returning();
    }
    return { items: updated.map((r) => this.view(r, variants.get(r.itemId))).sort((a, b) => a.plu - b.plu) };
  }

  // ---------------------------------------------------------------- counter

  /**
   * The bill line for a scanned code, or null when it isn't a scale label of this shop (or the item is off / gone).
   * Never throws: the POS falls back to its normal barcode lookup on null.
   */
  async resolveCode(tenantId: string, code: string): Promise<ResolvedScaleCode | null> {
    try {
      const settings = await this.getSettings(tenantId);
      const parsed = parseScaleBarcode(String(code ?? ""), formatOf(settings));
      if (!parsed) return null;
      const [row] = await this.db
        .select()
        .from(scaleItems)
        .where(and(eq(scaleItems.tenantId, tenantId), eq(scaleItems.plu, parsed.plu), eq(scaleItems.active, true)))
        .limit(1);
      if (!row) return null;
      const [variant] = await this.deps.catalog.variants(tenantId, [row.itemId]);
      if (!variant) return null;
      const line = lineFromLabel(parsed, row, variant.price);
      if (!line) return null;
      return { itemId: row.itemId, ...line, plu: row.plu, name: row.name, soldBy: row.soldBy, unitPrice: variant.price };
    } catch (err) {
      this.log.warn({ err, tenantId }, "scales: couldn't resolve a scanned code");
      return null;
    }
  }

  /** CSV of the active items (PLU, name, price per unit in rupees, tare, unit) for loading into the scale software. */
  async pluExport(tenantId: string): Promise<string> {
    const rows = await this.db
      .select()
      .from(scaleItems)
      .where(and(eq(scaleItems.tenantId, tenantId), eq(scaleItems.active, true)))
      .orderBy(asc(scaleItems.plu));
    const vs = await this.variantMap(tenantId, rows.map((r) => r.itemId));
    return pluCsv(
      rows
        .filter((r) => vs.has(r.itemId))
        .map((r) => ({ plu: r.plu, name: vs.get(r.itemId)!.name || r.name, price: vs.get(r.itemId)!.price, tareGrams: r.tareGrams, unitLabel: r.unitLabel })),
    );
  }

  /**
   * The barcode the scale would print for this item at `weightKg` (pieces for piece items; price labels: the amount at
   * today's price).
   */
  async labelPreview(tenantId: string, itemId: string, weightKg: number): Promise<ScaleLabelPreview> {
    const { weight } = labelQuery.parse({ weight: weightKg });
    const row = await this.row(tenantId, itemId);
    if (!row) throw notFound("Scale item");
    const settings = await this.getSettings(tenantId);
    const kg = roundQty(weight);
    let pricePaise: number | null = null;
    if (settings.valueKind === "price") {
      const [variant] = await this.deps.catalog.variants(tenantId, [itemId]);
      if (!variant) throw notFound("Item");
      pricePaise = Math.round(variant.price * kg);
    }
    // Piece items on weight labels carry the count in the value digits.
    const labelKg = row.soldBy === "piece" ? Math.round(kg) / 1000 : kg;
    const code = buildScaleBarcode({ plu: row.plu, weightKg: labelKg, pricePaise: pricePaise ?? undefined }, formatOf(settings));
    if (!code) throw badRequest(settings.valueKind === "price" ? "That amount doesn't fit on the label" : "That weight doesn't fit on the label", { field: "weight" });
    return { code, plu: row.plu, weightKg: kg, pricePaise, format: settings };
  }
}
