import { AppError, badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, rangeOrder, searchAny } from "@rbms/core";
import type { Db, Tx } from "@rbms/db";
import { isValidDate, todayIST } from "@rbms/gst";
import { and, asc, count, eq, gt, gte, inArray, lte, max, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  addDays,
  ALL_PURITIES,
  buybackRate,
  formatExchangeNumber,
  isPurityOf,
  isValidHuid,
  JEWELLERY_SETTINGS_SCHEMA,
  MAKING_TYPES,
  METALS,
  normalizeHuid,
  oldGoldValue,
  priceBreakdown,
  rateOf,
  resolveJewellerySettings,
  resolveRates,
  roundGrams,
  type JewellerySettings,
  type Metal,
  type PriceBreakdown,
  type Purity,
  type RateEntry,
  type ResolvedRate,
} from "./logic";
import { noopLogger, type CatalogPort, type JewellerySettingsPort, type LoggerPort, type PaymentPort } from "./ports";
import {
  EXCHANGE_STATUSES,
  jewelleryExchanges as X,
  jewelleryPieces as P,
  jewelleryRates as R,
  PIECE_STATUSES,
  type ExchangeLine,
  type JewelleryExchangeRow,
  type JewelleryPieceRow,
  type PieceStatus,
} from "./schema";

export interface JewelleryDeps {
  db: Db;
  /** Writes each piece's GST-exclusive price to its catalogue variant. Without it prices are only kept here. */
  catalog?: CatalogPort;
  /** Records an applied old-gold exchange as a payment on the bill. Without it `apply` is refused. */
  payments?: PaymentPort;
  /** Settings namespace `jewellery`. Without it the defaults apply and `PUT /settings` is refused. */
  settings?: JewellerySettingsPort;
  log?: LoggerPort;
  now?: () => Date;
}

const MAX_PAISE = 2_000_000_000;
/** ₹10 lakh a gram is far above any metal; catches a rate typed in rupees-per-10-g × 100 by mistake. */
const MAX_RATE = 100_000_000;
const MAX_GRAMS = 100_000;
const REPRICE_BATCH = 200;
const WRITE_CONCURRENCY = 8;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const dateStr = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const metalField = z.enum(METALS);
const purityField = z.enum(ALL_PURITIES);
const grams = z.number().positive().max(MAX_GRAMS).transform(roundGrams);
const grams0 = z.number().min(0).max(MAX_GRAMS).transform(roundGrams);
const pct = z
  .number()
  .min(0)
  .max(100)
  .transform((v) => Math.round(v * 100) / 100);
const paise = z.number().int().min(0).max(MAX_PAISE);
const huidField = z
  .string()
  .nullish()
  .transform((v) => (v ? normalizeHuid(v) : null))
  .refine((v) => v === null || isValidHuid(v), "HUID is 6 letters or digits");

const purityOfMetal = (v: { metal?: Metal; purity?: string }, ctx: z.RefinementCtx) => {
  if (v.metal && v.purity && !isPurityOf(v.metal, v.purity)) ctx.addIssue({ code: "custom", path: ["purity"], message: `${v.purity} is not a ${v.metal} purity` });
};

// ---------------------------------------------------------------- rates

export const rateEntryInput = z
  .object({ metal: metalField, purity: purityField, ratePerGram: z.number().int().min(1).max(MAX_RATE) })
  .strict()
  .superRefine(purityOfMetal);

/** PUT /rates: today's rates. Every metal named in the list is replaced for today (its other purities are derived). */
export const ratesInput = z
  .object({ rates: z.array(rateEntryInput).min(1).max(20) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rates.forEach((r, i) => {
      const k = `${r.metal}:${r.purity}`;
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["rates", i, "purity"], message: `${r.purity} ${r.metal} is listed twice` });
      seen.add(k);
    });
  });
export type RatesInput = z.input<typeof ratesInput>;

export const ratesQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

// ---------------------------------------------------------------- pieces

const pieceShape = {
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  metal: metalField,
  purity: purityField,
  grossWeight: grams,
  stoneWeight: grams0.optional(),
  wastagePct: pct.optional(),
  makingType: z.enum(MAKING_TYPES).optional(),
  makingValue: paise.optional(),
  stoneCharges: paise.optional(),
  huid: huidField.optional(),
  tagNo: optText(40).optional(),
  status: z.enum(PIECE_STATUSES).optional(),
};

export const pieceInput = z.object(pieceShape).strict().superRefine(purityOfMetal);
export type PieceInput = z.input<typeof pieceInput>;

const { itemId: _itemId, ...patchShape } = pieceShape;
export const piecePatch = z.object(patchShape).partial().strict();
export type PiecePatch = z.input<typeof piecePatch>;

/** The whole piece after a create or patch: purity matches the metal, stones don't outweigh the piece. */
const pieceSpecCheck = z
  .object({
    metal: metalField,
    purity: z.string(),
    grossWeight: z.number(),
    stoneWeight: z.number(),
    makingType: z.enum(MAKING_TYPES),
    makingValue: z.number(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    purityOfMetal(v, ctx);
    if (v.stoneWeight >= v.grossWeight) ctx.addIssue({ code: "custom", path: ["stoneWeight"], message: "Stone weight must be less than the gross weight" });
    if (v.makingType === "percent" && v.makingValue > 10_000) ctx.addIssue({ code: "custom", path: ["makingValue"], message: "Making can be at most 100%" });
  });

export const pieceListQuery = listQuerySchema().extend({
  metal: listFilter.oneOf(METALS),
  purity: listFilter.oneOf(ALL_PURITIES),
  status: listFilter.oneOf(PIECE_STATUSES),
});
export type PieceListQuery = z.input<typeof pieceListQuery>;

export const PIECE_SORT = defineSort(
  {
    name: sql`lower(${P.name})`,
    tag: P.tagNo,
    gross: P.grossWeight,
    net: P.netWeight,
    price: P.lastPrice,
    updated: P.updatedAt,
  },
  { default: "name", tieBreaker: [P.id] },
);

export const repriceInput = z
  .object({ pieceId: z.string().uuid().optional(), metal: z.array(metalField).max(3).optional(), force: z.boolean().optional() })
  .strict();

// ---------------------------------------------------------------- exchanges

export const exchangeLineInput = z
  .object({
    description: z.string().trim().max(120).optional(),
    metal: metalField,
    purity: purityField,
    grossWeight: grams,
    deductionPct: pct.optional(),
    /** Buying rate override (paise per gram); default: the sale rate less the buy-back %. */
    ratePerGram: z.number().int().min(0).max(MAX_RATE).optional(),
  })
  .strict()
  .superRefine(purityOfMetal);

export const exchangeInput = z
  .object({
    date: dateStr.optional(),
    customer: z.object({ name: z.string().trim().min(1).max(120), phone: optText(20) }).strict(),
    lines: z.array(exchangeLineInput).min(1).max(30),
    note: optText(500),
  })
  .strict();
export type ExchangeInput = z.input<typeof exchangeInput>;

export const applyInput = z.object({ invoiceId: z.string().uuid() }).strict();

export const exchangeListQuery = listQuerySchema()
  .extend({ status: listFilter.oneOf(EXCHANGE_STATUSES), from: listFilter.date(), to: listFilter.date(), invoiceId: listFilter.id() })
  .superRefine(rangeOrder("from", "to"));
export type ExchangeListQuery = z.input<typeof exchangeListQuery>;

export const EXCHANGE_SORT = defineSort(
  { number: X.number, date: X.date, customer: sql`lower(${X.customerName})`, total: X.total, status: X.status },
  { default: "-number", tieBreaker: [X.id] },
);

// ---------------------------------------------------------------- views

/** A rate in force: `date` is the day it was entered (earlier than today when today's isn't set yet). */
export interface EffectiveRate extends ResolvedRate {
  date: string | null;
}

export interface RatesView {
  date: string;
  /** Some rate was entered today. */
  setToday: boolean;
  /** Today's card (null where nothing entered today). */
  today: ResolvedRate[];
  /** What was typed in today (overrides included). */
  entered: RateEntry[];
  /** Today's rate, or the latest earlier one, per purity. Pieces are priced from these. */
  effective: EffectiveRate[];
  /** Newest first, days with any rate entered. */
  history: { date: string; rates: ResolvedRate[] }[];
}

export interface TodayRates {
  date: string;
  setToday: boolean;
  rates: EffectiveRate[];
}

export interface RepriceResult {
  /** Pieces whose price was written. */
  repriced: number;
  unchanged: number;
  /** No rate for the piece's metal yet. */
  noRate: number;
  /** The catalogue refused the write (logged). */
  failed: number;
}

export interface PieceView extends Omit<JewelleryPieceRow, "grossWeight" | "stoneWeight" | "netWeight" | "wastagePct"> {
  grossWeight: number;
  stoneWeight: number;
  netWeight: number;
  wastagePct: number;
}

export interface PiecePrice {
  piece: PieceView;
  rate: { date: string | null; ratePerGram: number; source: ResolvedRate["source"] } | null;
  breakdown: PriceBreakdown | null;
}

export interface ExchangeView extends JewelleryExchangeRow {
  code: string;
}

export type ExchangeSummary = Omit<ExchangeView, "lines"> & { lineCount: number };

const num = (v: string | number | null | undefined) => Number(v ?? 0);

function pieceView(r: JewelleryPieceRow): PieceView {
  return { ...r, grossWeight: num(r.grossWeight), stoneWeight: num(r.stoneWeight), netWeight: num(r.netWeight), wastagePct: num(r.wastagePct) };
}

function pgError(err: unknown): { code?: string; constraint?: string } {
  const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: { code?: string; constraint_name?: string; constraint?: string } } | null;
  return { code: e?.code ?? e?.cause?.code, constraint: e?.constraint_name ?? e?.constraint ?? e?.cause?.constraint_name ?? e?.cause?.constraint };
}

function pieceConflict(err: unknown): never {
  const { code, constraint } = pgError(err);
  if (code === "23505") {
    if (constraint?.includes("huid")) throw new AppError(409, "huid_taken", "Another piece has this HUID");
    if (constraint?.includes("tag")) throw new AppError(409, "tag_taken", "Another piece has this tag number");
    throw new AppError(409, "item_taken", "This item is already a piece");
  }
  throw err;
}

/** Runs `fn` over `items`, `limit` at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export class JewelleryService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: JewelleryDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<JewellerySettings> {
    if (!this.deps.settings) return resolveJewellerySettings(null);
    try {
      return resolveJewellerySettings(await this.deps.settings.get(tenantId));
    } catch (err) {
      this.log.warn({ err, tenantId }, "jewellery: settings unavailable, using defaults");
      return resolveJewellerySettings(null);
    }
  }

  /** Validates a patch and stores it. A new rounding reprices every piece in stock. */
  async updateSettings(tenantId: string, patch: unknown): Promise<JewellerySettings> {
    const port = this.deps.settings;
    if (!port?.set) throw badRequest("Jewellery settings can't be changed here");
    const p = JEWELLERY_SETTINGS_SCHEMA.partial().strict().parse(patch ?? {});
    const before = await this.getSettings(tenantId);
    const merged = JEWELLERY_SETTINGS_SCHEMA.parse({ ...before, ...p });
    await port.set(tenantId, p);
    if (merged.roundTo !== before.roundTo) await this.repriceWhere(tenantId, undefined, { settings: merged });
    return merged;
  }

  // ---------------------------------------------------------------- rates

  private async enteredOn(tenantId: string, date: string): Promise<RateEntry[]> {
    return this.db
      .select({ metal: R.metal, purity: R.purity, ratePerGram: R.ratePerGram })
      .from(R)
      .where(and(eq(R.tenantId, tenantId), eq(R.date, date)));
  }

  /** Per purity, today's rate or the latest one before it. */
  async effectiveRates(tenantId: string): Promise<EffectiveRate[]> {
    const today = this.today();
    const latest = await this.db
      .select({ metal: R.metal, date: max(R.date) })
      .from(R)
      .where(and(eq(R.tenantId, tenantId), lte(R.date, today)))
      .groupBy(R.metal);
    const pairs = latest.filter((l): l is { metal: Metal; date: string } => !!l.date);
    const rows = pairs.length
      ? await this.db
          .select({ metal: R.metal, purity: R.purity, ratePerGram: R.ratePerGram, date: R.date })
          .from(R)
          .where(and(eq(R.tenantId, tenantId), or(...pairs.map((p) => and(eq(R.metal, p.metal), eq(R.date, p.date))))))
      : [];
    const dateOf = new Map(pairs.map((p) => [p.metal, p.date]));
    return resolveRates(rows).map((r) => ({ ...r, date: r.ratePerGram === null ? null : (dateOf.get(r.metal) ?? null) }));
  }

  async todayRates(tenantId: string): Promise<TodayRates> {
    const date = this.today();
    const rates = await this.effectiveRates(tenantId);
    return { date, setToday: rates.some((r) => r.date === date), rates };
  }

  async rates(tenantId: string, days = 30): Promise<RatesView> {
    const today = this.today();
    const from = addDays(today, -(Math.max(1, days) - 1));
    const [rows, effective] = await Promise.all([
      this.db
        .select({ date: R.date, metal: R.metal, purity: R.purity, ratePerGram: R.ratePerGram })
        .from(R)
        .where(and(eq(R.tenantId, tenantId), gte(R.date, from), lte(R.date, today)))
        .orderBy(asc(R.date)),
      this.effectiveRates(tenantId),
    ]);
    const byDate = new Map<string, RateEntry[]>();
    for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), { metal: r.metal, purity: r.purity, ratePerGram: r.ratePerGram }]);
    const entered = byDate.get(today) ?? [];
    return {
      date: today,
      setToday: entered.length > 0,
      today: resolveRates(entered),
      entered,
      effective,
      history: [...byDate.entries()].reverse().map(([date, list]) => ({ date, rates: resolveRates(list) })),
    };
  }

  /** Saves today's rates (each metal named is replaced for today), then reprices every in-stock piece of those metals. */
  async setRates(tenantId: string, input: unknown, userId: string | null = null): Promise<{ date: string; rates: ResolvedRate[]; reprice: RepriceResult }> {
    const b = ratesInput.parse(input);
    const date = this.today();
    const metals = [...new Set(b.rates.map((r) => r.metal))];
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`jewellery:rates:${tenantId}`}))`);
      await tx.delete(R).where(and(eq(R.tenantId, tenantId), eq(R.date, date), inArray(R.metal, metals)));
      await tx.insert(R).values(b.rates.map((r) => ({ tenantId, date, metal: r.metal, purity: r.purity as Purity, ratePerGram: r.ratePerGram, setBy: userId })));
    });
    const reprice = await this.repriceWhere(tenantId, inArray(P.metal, metals));
    this.log.info({ tenantId, date, metals, ...reprice }, "jewellery: rates set");
    return { date, rates: resolveRates(await this.enteredOn(tenantId, date)), reprice };
  }

  // ---------------------------------------------------------------- pricing

  /**
   * Recomputes the GST-exclusive price of in-stock pieces (under `extra`) and writes changed ones to the catalogue,
   * in keyset batches. `force` writes unchanged prices too (e.g. after a catalogue import).
   */
  async repriceWhere(tenantId: string, extra?: SQL, opts: { force?: boolean; settings?: JewellerySettings; includeAnyStatus?: boolean } = {}): Promise<RepriceResult> {
    const [settings, card] = await Promise.all([opts.settings ?? this.getSettings(tenantId), this.effectiveRates(tenantId)]);
    const out: RepriceResult = { repriced: 0, unchanged: 0, noRate: 0, failed: 0 };
    let after: string | null = null;
    for (;;) {
      const rows: JewelleryPieceRow[] = await this.db
        .select()
        .from(P)
        .where(and(eq(P.tenantId, tenantId), opts.includeAnyStatus ? undefined : eq(P.status, "in_stock"), extra, after ? gt(P.id, after) : undefined))
        .orderBy(asc(P.id))
        .limit(REPRICE_BATCH);
      if (rows.length === 0) break;
      after = rows[rows.length - 1]!.id;
      await eachLimited(rows, WRITE_CONCURRENCY, async (row) => {
        const rate = rateOf(card, row.metal, row.purity);
        if (rate === null) {
          out.noRate++;
          return;
        }
        const price = this.priceOf(row, rate, settings).total;
        if (!opts.force && price === row.lastPrice) {
          out.unchanged++;
          return;
        }
        try {
          await this.deps.catalog?.setPrice(tenantId, row.itemId, price);
          await this.db
            .update(P)
            .set({ lastPrice: price, priceUpdatedAt: this.now() })
            .where(and(eq(P.tenantId, tenantId), eq(P.id, row.id)));
          out.repriced++;
        } catch (err) {
          out.failed++;
          this.log.error({ err, tenantId, pieceId: row.id, itemId: row.itemId }, "jewellery: couldn't write the price to the catalogue");
        }
      });
      if (rows.length < REPRICE_BATCH) break;
    }
    return out;
  }

  private priceOf(row: JewelleryPieceRow, rate: number, settings: JewellerySettings): PriceBreakdown {
    return priceBreakdown(
      {
        grossWeight: row.grossWeight,
        stoneWeight: row.stoneWeight,
        wastagePct: row.wastagePct,
        makingType: row.makingType,
        makingValue: row.makingValue,
        stoneCharges: row.stoneCharges,
      },
      rate,
      { gstRate: settings.gstRate, roundTo: settings.roundTo },
    );
  }

  /** POST /reprice: one piece (any status), some metals, or every piece in stock. */
  async reprice(tenantId: string, input: unknown = {}): Promise<RepriceResult> {
    const b = repriceInput.parse(input ?? {});
    if (b.pieceId) {
      await this.pieceRow(tenantId, b.pieceId);
      return this.repriceWhere(tenantId, eq(P.id, b.pieceId), { force: b.force ?? true, includeAnyStatus: true });
    }
    return this.repriceWhere(tenantId, b.metal?.length ? inArray(P.metal, b.metal) : undefined, { force: b.force });
  }

  async piecePrice(tenantId: string, id: string): Promise<PiecePrice> {
    const [row, card, settings] = await Promise.all([this.pieceRow(tenantId, id), this.effectiveRates(tenantId), this.getSettings(tenantId)]);
    const r = card.find((c) => c.metal === row.metal && c.purity === row.purity);
    if (!r || r.ratePerGram === null) return { piece: pieceView(row), rate: null, breakdown: null };
    return { piece: pieceView(row), rate: { date: r.date, ratePerGram: r.ratePerGram, source: r.source }, breakdown: this.priceOf(row, r.ratePerGram, settings) };
  }

  // ---------------------------------------------------------------- pieces

  private async pieceRow(tenantId: string, id: string, tx: Db | Tx = this.db): Promise<JewelleryPieceRow> {
    const [row] = await tx
      .select()
      .from(P)
      .where(and(eq(P.tenantId, tenantId), eq(P.id, id)))
      .limit(1);
    if (!row) throw notFound("Piece");
    return row;
  }

  /** WHERE of the piece list; `without` drops one filter for its facet counts. */
  pieceConditions(tenantId: string, q: z.output<typeof pieceListQuery>, without?: "metal" | "status"): SQL | undefined {
    return and(
      eq(P.tenantId, tenantId),
      without !== "metal" && q.metal?.length ? inArray(P.metal, q.metal) : undefined,
      q.purity?.length ? inArray(P.purity, q.purity) : undefined,
      without !== "status" && q.status?.length ? inArray(P.status, q.status) : undefined,
      searchAny(q.q, [P.name, P.tagNo, P.huid]),
    );
  }

  async listPieces(tenantId: string, query: PieceListQuery = {}) {
    const q = pieceListQuery.parse(query);
    const order = PIECE_SORT.orderBy(q.sort);
    const where = this.pieceConditions(tenantId, q);
    const [rows, [total], byMetal, byStatus] = await Promise.all([
      this.db.select().from(P).where(where).orderBy(...order).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(P).where(where),
      this.db.select({ key: P.metal, n: count() }).from(P).where(this.pieceConditions(tenantId, q, "metal")).groupBy(P.metal),
      this.db.select({ key: P.status, n: count() }).from(P).where(this.pieceConditions(tenantId, q, "status")).groupBy(P.status),
    ]);
    return {
      items: rows.map(pieceView),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { metal: facetCounts(byMetal), status: facetCounts(byStatus) },
    };
  }

  async getPiece(tenantId: string, id: string): Promise<PieceView> {
    return pieceView(await this.pieceRow(tenantId, id));
  }

  /** Pieces for these catalogue variants (e.g. to show weight and HUID on a bill). */
  async piecesForItems(tenantId: string, itemIds: string[]): Promise<PieceView[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(P)
      .where(and(eq(P.tenantId, tenantId), inArray(P.itemId, itemIds.slice(0, 500))));
    return rows.map(pieceView);
  }

  private async variantName(tenantId: string, itemId: string): Promise<string> {
    const found = this.deps.catalog?.variants ? (await this.deps.catalog.variants(tenantId, [itemId])).find((v) => v.id === itemId) : undefined;
    if (!found) throw badRequest("Give the piece a name", { field: "name" });
    return found.name;
  }

  async createPiece(tenantId: string, input: unknown): Promise<PieceView> {
    const b = pieceInput.parse(input);
    const spec = {
      metal: b.metal,
      purity: b.purity,
      grossWeight: b.grossWeight,
      stoneWeight: b.stoneWeight ?? 0,
      wastagePct: b.wastagePct ?? 0,
      makingType: b.makingType ?? "per_gram",
      makingValue: b.makingValue ?? 0,
      stoneCharges: b.stoneCharges ?? 0,
    };
    pieceSpecCheck.parse(spec);
    const name = b.name ?? (await this.variantName(tenantId, b.itemId));
    let row: JewelleryPieceRow;
    try {
      [row] = (await this.db
        .insert(P)
        .values({
          tenantId,
          itemId: b.itemId,
          name,
          ...spec,
          purity: spec.purity as Purity,
          grossWeight: String(spec.grossWeight),
          stoneWeight: String(spec.stoneWeight),
          netWeight: String(roundGrams(spec.grossWeight - spec.stoneWeight)),
          wastagePct: String(spec.wastagePct),
          huid: b.huid ?? null,
          tagNo: b.tagNo ?? null,
          status: b.status ?? "in_stock",
        })
        .returning()) as [JewelleryPieceRow];
    } catch (err) {
      pieceConflict(err);
    }
    if (row.status === "in_stock") await this.repriceWhere(tenantId, eq(P.id, row.id), { force: true });
    return this.getPiece(tenantId, row.id);
  }

  async updatePiece(tenantId: string, id: string, input: unknown): Promise<PieceView> {
    const b = piecePatch.parse(input ?? {});
    const cur = await this.pieceRow(tenantId, id);
    const merged = {
      metal: b.metal ?? cur.metal,
      purity: b.purity ?? cur.purity,
      grossWeight: b.grossWeight ?? num(cur.grossWeight),
      stoneWeight: b.stoneWeight ?? num(cur.stoneWeight),
      wastagePct: b.wastagePct ?? num(cur.wastagePct),
      makingType: b.makingType ?? cur.makingType,
      makingValue: b.makingValue ?? cur.makingValue,
      stoneCharges: b.stoneCharges ?? cur.stoneCharges,
    };
    pieceSpecCheck.parse(merged);
    const set: Partial<typeof P.$inferInsert> = {
      metal: merged.metal,
      purity: merged.purity as Purity,
      grossWeight: String(merged.grossWeight),
      stoneWeight: String(merged.stoneWeight),
      netWeight: String(roundGrams(merged.grossWeight - merged.stoneWeight)),
      wastagePct: String(merged.wastagePct),
      makingType: merged.makingType,
      makingValue: merged.makingValue,
      stoneCharges: merged.stoneCharges,
      updatedAt: this.now(),
    };
    if (b.name !== undefined) set.name = b.name;
    if (b.huid !== undefined) set.huid = b.huid;
    if (b.tagNo !== undefined) set.tagNo = b.tagNo;
    if (b.status !== undefined) set.status = b.status;
    let row: JewelleryPieceRow;
    try {
      [row] = (await this.db
        .update(P)
        .set(set)
        .where(and(eq(P.tenantId, tenantId), eq(P.id, id)))
        .returning()) as [JewelleryPieceRow];
    } catch (err) {
      pieceConflict(err);
    }
    if (row.status === "in_stock") await this.repriceWhere(tenantId, eq(P.id, id));
    return this.getPiece(tenantId, id);
  }

  async deletePiece(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(P)
      .where(and(eq(P.tenantId, tenantId), eq(P.id, id)))
      .returning({ id: P.id });
    if (rows.length === 0) throw notFound("Piece");
  }

  /**
   * Marks the pieces of these catalogue variants sold / in stock / reserved (for the host's bill hooks: issued → sold,
   * cancelled → in_stock). Pieces coming back in stock are repriced. Returns how many changed.
   */
  async setStatusByItems(tenantId: string, itemIds: string[], status: PieceStatus): Promise<number> {
    if (itemIds.length === 0) return 0;
    const rows = await this.db
      .update(P)
      .set({ status, updatedAt: this.now() })
      .where(and(eq(P.tenantId, tenantId), inArray(P.itemId, itemIds.slice(0, 500)), sql`${P.status} <> ${status}`))
      .returning({ id: P.id });
    if (status === "in_stock" && rows.length) await this.repriceWhere(tenantId, inArray(P.id, rows.map((r) => r.id)));
    return rows.length;
  }

  // ---------------------------------------------------------------- exchanges

  private exchangeView(row: JewelleryExchangeRow): ExchangeView {
    return { ...row, code: formatExchangeNumber(row.number) };
  }

  private async exchangeRow(tenantId: string, id: string, tx: Db | Tx = this.db, lock = false): Promise<JewelleryExchangeRow> {
    const q = tx
      .select()
      .from(X)
      .where(and(eq(X.tenantId, tenantId), eq(X.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Exchange");
    return row;
  }

  /** Values each line at the buying rate (the sale rate for its purity less the buy-back %), unless a rate is given. */
  async valueLines(tenantId: string, lines: z.output<typeof exchangeLineInput>[]): Promise<{ lines: ExchangeLine[]; total: number }> {
    const [card, settings] = await Promise.all([this.effectiveRates(tenantId), this.getSettings(tenantId)]);
    const out = lines.map((l, i): ExchangeLine => {
      let rate = l.ratePerGram;
      if (rate === undefined) {
        const sale = rateOf(card, l.metal, l.purity);
        if (sale === null) throw badRequest(`Enter today's ${l.metal} rate first`, { field: `lines.${i}.ratePerGram` });
        rate = buybackRate(sale, settings.buybackPct);
      }
      const deductionPct = l.deductionPct ?? 0;
      const v = oldGoldValue({ grossWeight: l.grossWeight, deductionPct }, rate);
      return {
        description: l.description || `Old ${l.metal} ${l.purity}`,
        metal: l.metal,
        purity: l.purity as Purity,
        grossWeight: l.grossWeight,
        deductionPct,
        netWeight: v.netWeight,
        ratePerGram: rate,
        value: v.value,
      };
    });
    return { lines: out, total: out.reduce((s, l) => s + l.value, 0) };
  }

  async createExchange(tenantId: string, input: unknown, userId: string | null = null): Promise<ExchangeView> {
    const b = exchangeInput.parse(input);
    const { lines, total } = await this.valueLines(tenantId, b.lines);
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`jewellery:exchange-no:${tenantId}`}))`);
      const [r] = await tx
        .select({ n: sql<number>`coalesce(max(${X.number}), 0)::int` })
        .from(X)
        .where(eq(X.tenantId, tenantId));
      const [created] = await tx
        .insert(X)
        .values({
          tenantId,
          number: (r?.n ?? 0) + 1,
          date: b.date ?? this.today(),
          customerName: b.customer.name,
          customerPhone: b.customer.phone,
          lines,
          total,
          note: b.note,
          userId,
        })
        .returning();
      return created!;
    });
    return this.exchangeView(row);
  }

  exchangeConditions(tenantId: string, q: z.output<typeof exchangeListQuery>, withStatus = true): SQL | undefined {
    return and(
      eq(X.tenantId, tenantId),
      withStatus && q.status?.length ? inArray(X.status, q.status) : undefined,
      q.from ? gte(X.date, q.from) : undefined,
      q.to ? lte(X.date, q.to) : undefined,
      q.invoiceId ? eq(X.invoiceId, q.invoiceId) : undefined,
      searchAny(q.q, [X.customerName, X.customerPhone, sql`'OG-' || lpad(${X.number}::text, 4, '0')`]),
    );
  }

  async listExchanges(tenantId: string, query: ExchangeListQuery = {}) {
    const q = exchangeListQuery.parse(query);
    const order = EXCHANGE_SORT.orderBy(q.sort);
    const where = this.exchangeConditions(tenantId, q);
    const [rows, [total], byStatus] = await Promise.all([
      this.db
        .select({
          id: X.id,
          tenantId: X.tenantId,
          number: X.number,
          date: X.date,
          customerName: X.customerName,
          customerPhone: X.customerPhone,
          total: X.total,
          invoiceId: X.invoiceId,
          appliedAt: X.appliedAt,
          status: X.status,
          note: X.note,
          userId: X.userId,
          createdAt: X.createdAt,
          updatedAt: X.updatedAt,
          lineCount: sql<number>`jsonb_array_length(${X.lines})::int`,
        })
        .from(X)
        .where(where)
        .orderBy(...order)
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ n: count() }).from(X).where(where),
      this.db.select({ key: X.status, n: count() }).from(X).where(this.exchangeConditions(tenantId, q, false)).groupBy(X.status),
    ]);
    return {
      items: rows.map((r): ExchangeSummary => ({ ...r, code: formatExchangeNumber(r.number) })),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { status: facetCounts(byStatus) },
    };
  }

  async getExchange(tenantId: string, id: string): Promise<ExchangeView> {
    return this.exchangeView(await this.exchangeRow(tenantId, id));
  }

  async cancelExchange(tenantId: string, id: string): Promise<ExchangeView> {
    const row = await this.db.transaction(async (tx) => {
      const cur = await this.exchangeRow(tenantId, id, tx, true);
      if (cur.status === "applied") throw conflict("This exchange is already on a bill");
      if (cur.status === "cancelled") return cur;
      const [r] = await tx
        .update(X)
        .set({ status: "cancelled", updatedAt: this.now() })
        .where(and(eq(X.tenantId, tenantId), eq(X.id, id)))
        .returning();
      return r!;
    });
    return this.exchangeView(row);
  }

  /** Records the exchange total as a payment ("other", reference "Old gold OG-0003") on the bill, then marks it applied. */
  async applyExchange(tenantId: string, exchangeId: string, invoiceId: string): Promise<ExchangeView> {
    const port = this.deps.payments;
    if (!port) throw badRequest("Old gold can't be applied to bills here");
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`jewellery:exchange:${exchangeId}`}))`);
      const cur = await this.exchangeRow(tenantId, exchangeId, tx, true);
      if (cur.status === "applied") throw conflict("This exchange is already on a bill");
      if (cur.status === "cancelled") throw conflict("This exchange was cancelled");
      if (cur.total <= 0) throw badRequest("This exchange has no value");
      await port.addPayment(tenantId, invoiceId, { amount: cur.total, method: "other", date: this.today(), reference: `Old gold ${formatExchangeNumber(cur.number)}` });
      const [r] = await tx
        .update(X)
        .set({ status: "applied", invoiceId, appliedAt: this.now(), updatedAt: this.now() })
        .where(and(eq(X.tenantId, tenantId), eq(X.id, exchangeId)))
        .returning();
      return r!;
    });
    this.log.info({ tenantId, exchangeId, invoiceId, amount: row.total }, "jewellery: old gold applied to a bill");
    return this.exchangeView(row);
  }
}
