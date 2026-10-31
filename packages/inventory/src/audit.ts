/**
 * Physical stock audit (stock count): freeze the system quantities of a location (optionally a few categories), count by
 * scanning or typing (several counters can count at the same time; their counts are added up per line), review the
 * variance with reasons, then approve. Approval posts one `audit` stock movement per line that differs, valued at the
 * cost frozen with the session; the books pick them up through the existing stock-adjustment posting (docs/accounting.md).
 *
 *   draft -> counting -> review -> approved          (cancel from draft / counting / review)
 *
 * The adjustment is `counted - system quantity at the freeze`, not "set to counted", so sales made while counting stay.
 */
import { badRequest, conflict, notFound } from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { todayIST } from "@rbms/gst";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lineVariance, mergeCounts, type CountEntry } from "./batch-logic";
import { csvDisposition, toCsv, type CsvColumn } from "./csv";
import { fromMilli, milliToDecimal, paiseToRupees, toMilli } from "./logic";
import { noopLogger, type CatalogItem, type LoggerPort } from "./ports";
import {
  stockAuditEntries,
  stockAuditLines,
  stockAudits,
  stockBatchLevels,
  stockBatches,
  stockItems,
  stockLocations,
  type AuditStatus,
  type AuditTotals,
  type StockAuditLineRow,
  type StockAuditRow,
} from "./schema";
import type { InventoryDeps, InventoryService } from "./service";

export { csvDisposition };

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());
const uuid = z.string().uuid();
const MAX_LINES = 20_000;

export const auditCreateSchema = z.object({
  locationId: opt(uuid),
  /** Count only these categories (empty = everything). */
  categoryIds: z.array(uuid).max(100).default([]),
  title: opt(z.string().trim().max(120)),
  note: opt(z.string().trim().max(500)),
  /** Also list items whose system quantity is zero. */
  includeZero: z.boolean().optional(),
});
export type AuditCreateInput = z.input<typeof auditCreateSchema>;

const countEntrySchema = z
  .object({
    /** A line of the session, or a scanned / typed code (barcode or SKU), or an item (+ batch). */
    lineId: opt(uuid),
    code: opt(z.string().trim().min(1).max(100)),
    itemId: opt(uuid),
    batchId: opt(uuid),
    /** Adds (default) or replaces this counter's count of the line. */
    qty: z.coerce.number().min(-1_000_000).max(1_000_000).default(1),
    mode: z.enum(["add", "set"]).default("add"),
  })
  .superRefine((e, ctx) => {
    if (!e.lineId && !e.code && !e.itemId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Scan a code or choose an item" });
    if (e.mode === "set" && e.qty < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qty"], message: "A count can't be negative" });
  });

export const auditCountSchema = z.object({
  entries: z.array(countEntrySchema).min(1).max(500),
  /** Who is counting (shown on the review screen); defaults to the signed-in user. */
  counter: opt(z.string().trim().max(60)),
});
export type AuditCountInput = z.input<typeof auditCountSchema>;

export const AUDIT_REASONS = ["damaged", "expired", "theft", "entry_error", "found", "supplier_short", "other"] as const;
export const auditLinePatchSchema = z.object({
  /** Reviewer's recount: replaces the merged count. */
  countedQty: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().min(0).max(1_000_000_000).nullable().optional()),
  reason: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(100).nullable().optional()),
  note: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(300).nullable().optional()),
});
export type AuditLinePatch = z.input<typeof auditLinePatchSchema>;

export const auditBulkReasonSchema = z.object({
  reason: z.string().trim().min(1).max(100),
  /** Only lines that differ and have no reason yet (default true). */
  onlyEmpty: z.boolean().default(true),
});

export const auditApproveSchema = z.object({
  /** What to do with lines nobody counted: leave them alone (default) or treat them as zero (write them off). */
  uncounted: z.enum(["skip", "zero"]).default("skip"),
  /** Allow variance lines without a reason. */
  allowMissingReasons: z.boolean().optional(),
});
export type AuditApproveInput = z.input<typeof auditApproveSchema>;

export const auditListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(z.enum(["draft", "counting", "review", "approved", "cancelled"])).optional()),
  locationId: opt(uuid),
});
export type AuditListQuery = z.input<typeof auditListSchema>;

export const auditLinesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  filter: z.enum(["all", "variance", "uncounted", "counted"]).default("all"),
  q: opt(z.string().trim().max(100)),
});
export type AuditLinesQuery = z.input<typeof auditLinesQuerySchema>;

export interface AuditLineView {
  id: string;
  itemId: string;
  batchId: string | null;
  itemName: string;
  unit: string | null;
  barcode: string | null;
  sku: string | null;
  batchNo: string | null;
  expiry: string | null;
  systemQty: number;
  countedQty: number | null;
  variance: number;
  unitCost: number | null;
  /** Variance at cost, paise. */
  value: number;
  reason: string | null;
  note: string | null;
  applied: boolean;
}

export interface AuditView {
  id: string;
  number: string;
  status: AuditStatus;
  locationId: string;
  locationName: string;
  categoryIds: string[];
  title: string | null;
  note: string | null;
  snapshotAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** Live totals (frozen at approval). */
  totals: AuditTotals;
  counters: string[];
}

export interface CountResult {
  results: { lineId: string; itemName: string; batchNo: string | null; counted: number; created: boolean }[];
  /** Codes that matched no item. */
  unknown: string[];
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

const toLineView = (l: StockAuditLineRow): AuditLineView => {
  const v = lineVariance({ systemMilli: toMilli(l.systemQty), countedMilli: l.countedQty === null ? null : toMilli(l.countedQty), unitCost: l.unitCost });
  return {
    id: l.id,
    itemId: l.itemId,
    batchId: l.batchId,
    itemName: l.itemName,
    unit: l.unit,
    barcode: l.barcode,
    sku: l.sku,
    batchNo: l.batchNo,
    expiry: l.expiry,
    systemQty: num(l.systemQty),
    countedQty: l.countedQty === null ? null : num(l.countedQty),
    variance: fromMilli(v.varianceMilli),
    unitCost: l.unitCost,
    value: v.value,
    reason: l.reason,
    note: l.note,
    applied: l.appliedAt !== null,
  };
};

export const AUDIT_CSV_COLUMNS: CsvColumn<AuditLineView>[] = [
  { header: "Item", value: (r) => r.itemName },
  { header: "Batch", value: (r) => r.batchNo },
  { header: "Expiry", value: (r) => r.expiry },
  { header: "Barcode", value: (r) => r.barcode },
  { header: "Unit", value: (r) => r.unit },
  { header: "System qty", value: (r) => r.systemQty },
  { header: "Counted qty", value: (r) => r.countedQty },
  { header: "Variance", value: (r) => r.variance },
  { header: "Cost (Rs)", value: (r) => (r.unitCost === null ? "" : paiseToRupees(r.unitCost)) },
  { header: "Value impact (Rs)", value: (r) => paiseToRupees(r.value) },
  { header: "Reason", value: (r) => r.reason },
  { header: "Note", value: (r) => r.note },
];

export class AuditService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(
    private readonly inv: InventoryService,
    deps: InventoryDeps,
  ) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  // ================================================================ reads

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<StockAuditRow> {
    const q = db
      .select()
      .from(stockAudits)
      .where(and(eq(stockAudits.tenantId, tenantId), eq(stockAudits.id, id)))
      .limit(1);
    const [row] = await (lock ? q.for("update") : q);
    if (!row) throw notFound("Stock audit");
    return row;
  }

  private async liveTotals(db: DbOrTx, tenantId: string, auditId: string): Promise<AuditTotals> {
    const [r] = await db
      .select({
        lines: sql<number>`count(*)::int`,
        counted: sql<number>`count(${stockAuditLines.countedQty})::int`,
        varianceLines: sql<number>`count(*) filter (where ${stockAuditLines.countedQty} is not null and ${stockAuditLines.countedQty} <> ${stockAuditLines.systemQty})::int`,
        surplus: sql<string>`coalesce(sum(round((${stockAuditLines.countedQty} - ${stockAuditLines.systemQty}) * coalesce(${stockAuditLines.unitCost}, 0))) filter (where ${stockAuditLines.countedQty} > ${stockAuditLines.systemQty}), 0)`,
        shortage: sql<string>`coalesce(sum(round((${stockAuditLines.systemQty} - ${stockAuditLines.countedQty}) * coalesce(${stockAuditLines.unitCost}, 0))) filter (where ${stockAuditLines.countedQty} < ${stockAuditLines.systemQty}), 0)`,
      })
      .from(stockAuditLines)
      .where(and(eq(stockAuditLines.tenantId, tenantId), eq(stockAuditLines.auditId, auditId)));
    const surplusValue = Math.round(num(r?.surplus));
    const shortageValue = Math.round(num(r?.shortage));
    return { lines: r?.lines ?? 0, counted: r?.counted ?? 0, varianceLines: r?.varianceLines ?? 0, surplusValue, shortageValue, netValue: surplusValue - shortageValue };
  }

  private async view(tenantId: string, a: StockAuditRow): Promise<AuditView> {
    const [totals, [loc], counters] = await Promise.all([
      a.totals ? Promise.resolve(a.totals) : this.liveTotals(this.db, tenantId, a.id),
      this.db.select({ name: stockLocations.name }).from(stockLocations).where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.id, a.locationId))).limit(1),
      this.db
        .selectDistinct({ counter: stockAuditEntries.counter })
        .from(stockAuditEntries)
        .where(and(eq(stockAuditEntries.tenantId, tenantId), eq(stockAuditEntries.auditId, a.id))),
    ]);
    return {
      id: a.id,
      number: a.number,
      status: a.status,
      locationId: a.locationId,
      locationName: loc?.name ?? "",
      categoryIds: a.categoryIds,
      title: a.title,
      note: a.note,
      snapshotAt: a.snapshotAt,
      createdAt: a.createdAt,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      approvedAt: a.approvedAt,
      cancelledAt: a.cancelledAt,
      cancelReason: a.cancelReason,
      totals,
      counters: counters.map((c) => c.counter).sort(),
    };
  }

  async get(tenantId: string, id: string): Promise<AuditView> {
    return this.view(tenantId, await this.row(this.db, tenantId, id));
  }

  async list(tenantId: string, query: AuditListQuery = {}) {
    const q = auditListSchema.parse(query);
    const where = and(eq(stockAudits.tenantId, tenantId), q.status?.length ? inArray(stockAudits.status, q.status) : undefined, q.locationId ? eq(stockAudits.locationId, q.locationId) : undefined);
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(stockAudits).where(where).orderBy(desc(stockAudits.createdAt), desc(stockAudits.id)).limit(q.limit).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(stockAudits).where(where),
    ]);
    const items = await Promise.all(rows.map((r) => this.view(tenantId, r)));
    return { items, total: counted?.total ?? 0, limit: q.limit, offset: q.offset };
  }

  async lines(tenantId: string, id: string, query: AuditLinesQuery = {}) {
    await this.row(this.db, tenantId, id);
    const q = auditLinesQuerySchema.parse(query);
    const L = stockAuditLines;
    const pat = q.q ? `%${q.q.replace(/[%_\\]/g, "\\$&")}%` : null;
    const where = and(
      eq(L.tenantId, tenantId),
      eq(L.auditId, id),
      q.filter === "variance" ? sql`${L.countedQty} is not null and ${L.countedQty} <> ${L.systemQty}` : undefined,
      q.filter === "uncounted" ? sql`${L.countedQty} is null` : undefined,
      q.filter === "counted" ? sql`${L.countedQty} is not null` : undefined,
      pat ? sql`(${L.itemName} ilike ${pat} or ${L.barcode} ilike ${pat} or ${L.sku} ilike ${pat} or ${L.batchNo} ilike ${pat})` : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(L).where(where).orderBy(asc(sql`lower(${L.itemName})`), asc(L.expiry), asc(L.id)).limit(q.limit).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(L).where(where),
    ]);
    return { items: rows.map(toLineView), total: counted?.total ?? 0, limit: q.limit, offset: q.offset };
  }

  /** The variance report: every counted line that differs, with its value at cost. CSV via `csv()`. */
  async variance(tenantId: string, id: string) {
    const audit = await this.get(tenantId, id);
    const rows = await this.db
      .select()
      .from(stockAuditLines)
      .where(and(eq(stockAuditLines.tenantId, tenantId), eq(stockAuditLines.auditId, id), sql`${stockAuditLines.countedQty} is not null`, sql`${stockAuditLines.countedQty} <> ${stockAuditLines.systemQty}`))
      .orderBy(asc(sql`lower(${stockAuditLines.itemName})`), asc(stockAuditLines.expiry));
    const items = rows.map(toLineView);
    return { audit, items, totals: audit.totals };
  }

  async csv(tenantId: string, id: string, which: "all" | "variance" = "all"): Promise<{ name: string; date: string; body: string }> {
    const audit = await this.row(this.db, tenantId, id);
    const rows = await this.db
      .select()
      .from(stockAuditLines)
      .where(
        and(
          eq(stockAuditLines.tenantId, tenantId),
          eq(stockAuditLines.auditId, id),
          which === "variance" ? sql`${stockAuditLines.countedQty} is not null and ${stockAuditLines.countedQty} <> ${stockAuditLines.systemQty}` : undefined,
        ),
      )
      .orderBy(asc(sql`lower(${stockAuditLines.itemName})`), asc(stockAuditLines.expiry));
    return { name: `stock-audit-${audit.number.replace(/\//g, "-")}${which === "variance" ? "-variance" : ""}`, date: this.today(), body: toCsv(rows.map(toLineView), AUDIT_CSV_COLUMNS) };
  }

  // ================================================================ create (freeze the snapshot)

  async create(tenantId: string, input: AuditCreateInput, userId: string | null = null): Promise<AuditView> {
    const b = auditCreateSchema.parse(input);
    const loc = await this.inv.resolveLocation(tenantId, b.locationId ?? null, { active: true });
    const items = (await this.inv.catalogSearch(tenantId, "")) as CatalogItem[];
    const inScope = b.categoryIds.length ? items.filter((i) => i.categoryId && b.categoryIds.includes(i.categoryId)) : items;
    const scoped = new Map(inScope.map((i) => [i.id, i]));
    const stock = await this.db
      .select({ itemId: stockItems.itemId, qty: stockItems.qty, avgCost: stockItems.avgCost, track: stockItems.track })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.locationId, loc.id)));
    const levels = await this.db
      .select({ level: stockBatchLevels, batch: stockBatches })
      .from(stockBatchLevels)
      .innerJoin(stockBatches, eq(stockBatches.id, stockBatchLevels.batchId))
      .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.locationId, loc.id), sql`${stockBatchLevels.qty} <> 0`));
    const stockBy = new Map(stock.map((s) => [s.itemId, s]));
    const batchesBy = new Map<string, typeof levels>();
    for (const l of levels) batchesBy.set(l.level.itemId, [...(batchesBy.get(l.level.itemId) ?? []), l]);
    // Every untracked item (track off at any location) is left out: it has no quantity to count.
    const untracked = await this.inv.untrackedOf(this.db, tenantId, [...scoped.keys()]);

    const lines: (typeof stockAuditLines.$inferInsert)[] = [];
    const base = (i: CatalogItem) => ({
      tenantId,
      itemId: i.id,
      itemName: i.name,
      unit: i.unit,
      barcode: i.barcode ?? null,
      sku: i.sku ?? null,
    });
    for (const i of inScope) {
      if (untracked.has(i.id)) continue;
      const s = stockBy.get(i.id);
      const qty = toMilli(s?.qty ?? 0);
      const bl = batchesBy.get(i.id) ?? [];
      const cost = s?.avgCost ?? null;
      if (bl.length > 0) {
        let batched = 0;
        for (const x of bl) {
          batched += toMilli(x.level.qty);
          lines.push({ ...base(i), auditId: "", batchId: x.batch.id, batchNo: x.batch.batchNo, expiry: x.batch.expiry, systemQty: x.level.qty, unitCost: x.batch.cost ?? cost });
        }
        if (qty - batched !== 0) lines.push({ ...base(i), auditId: "", batchId: null, systemQty: milliToDecimal(qty - batched), unitCost: cost });
      } else if (qty !== 0 || b.includeZero) {
        lines.push({ ...base(i), auditId: "", batchId: null, systemQty: milliToDecimal(qty), unitCost: cost });
      }
    }
    if (lines.length > MAX_LINES) throw badRequest(`This count has ${lines.length} lines. Count a few categories at a time (the limit is ${MAX_LINES}).`);
    if (lines.length === 0 && !b.includeZero) throw badRequest("There is no stock in this selection to count. Tick \"include items with zero stock\" or choose other categories");

    const date = this.today();
    const created = await this.db.transaction(async (tx) => {
      const number = await this.inv.purchasing.nextNumber(tx, tenantId, "sa", date);
      const [audit] = await tx
        .insert(stockAudits)
        .values({ tenantId, number, status: "draft", locationId: loc.id, categoryIds: b.categoryIds, title: b.title ?? null, note: b.note ?? null, snapshotAt: this.now(), createdBy: userId })
        .returning();
      for (let i = 0; i < lines.length; i += 500) {
        await tx.insert(stockAuditLines).values(lines.slice(i, i + 500).map((l) => ({ ...l, auditId: audit!.id })));
      }
      return audit!;
    });
    this.log.info({ tenantId, auditId: created.id, lines: lines.length }, "inventory: stock audit created");
    return this.view(tenantId, created);
  }

  // ================================================================ status changes

  private async move(tenantId: string, id: string, from: AuditStatus[], to: AuditStatus, set: Partial<typeof stockAudits.$inferInsert> = {}): Promise<AuditView> {
    const [row] = await this.db
      .update(stockAudits)
      .set({ status: to, updatedAt: this.now(), ...set })
      .where(and(eq(stockAudits.tenantId, tenantId), eq(stockAudits.id, id), inArray(stockAudits.status, from)))
      .returning();
    if (!row) {
      const cur = await this.row(this.db, tenantId, id);
      throw conflict(`This count is ${cur.status}; it can't be changed that way`);
    }
    return this.view(tenantId, row);
  }

  start(tenantId: string, id: string) {
    return this.move(tenantId, id, ["draft"], "counting", { startedAt: this.now() });
  }

  async submit(tenantId: string, id: string) {
    const t = await this.liveTotals(this.db, tenantId, id);
    if (t.counted === 0) throw badRequest("Nothing was counted yet");
    return this.move(tenantId, id, ["counting"], "review", { submittedAt: this.now() });
  }

  reopen(tenantId: string, id: string) {
    return this.move(tenantId, id, ["review"], "counting");
  }

  cancel(tenantId: string, id: string, reason: string | null) {
    return this.move(tenantId, id, ["draft", "counting", "review"], "cancelled", { cancelledAt: this.now(), cancelReason: reason });
  }

  // ================================================================ counting

  private async lineById(tx: DbOrTx, tenantId: string, auditId: string, id: string) {
    const [l] = await tx
      .select()
      .from(stockAuditLines)
      .where(and(eq(stockAuditLines.tenantId, tenantId), eq(stockAuditLines.auditId, auditId), eq(stockAuditLines.id, id)))
      .limit(1)
      .for("update");
    if (!l) throw notFound("Audit line");
    return l;
  }

  /** The line a scanned code or item belongs to (an item found but not in the snapshot gets a new line with system qty 0). */
  private async resolveLine(
    tx: DbOrTx,
    tenantId: string,
    audit: StockAuditRow,
    e: z.output<typeof countEntrySchema>,
  ): Promise<{ line: StockAuditLineRow; created: boolean } | { unknown: string }> {
    if (e.lineId) return { line: await this.lineById(tx, tenantId, audit.id, e.lineId), created: false };
    const L = stockAuditLines;
    let item: CatalogItem | undefined;
    if (e.itemId) item = (await this.inv.catalogItems(tenantId, [e.itemId]))[0];
    if (!item && e.code) {
      const code = e.code.trim();
      const [hit] = await tx
        .select()
        .from(L)
        .where(and(eq(L.tenantId, tenantId), eq(L.auditId, audit.id), sql`(${L.barcode} = ${code} or lower(${L.sku}) = lower(${code}))`))
        .orderBy(asc(L.expiry), asc(L.id))
        .limit(1)
        .for("update");
      if (hit) {
        // A batch-tracked item scanned without a batch lands on its first line (soonest expiry) unless a batch was named.
        if (!e.batchId) return { line: hit, created: false };
        item = { id: hit.itemId, name: hit.itemName, unit: hit.unit ?? "", hsn: null, rate: 0, gstRate: 0, barcode: hit.barcode, sku: hit.sku };
      } else {
        const found = (await this.inv.catalogSearch(tenantId, code)).filter((i) => i.barcode === code || (i.sku ?? "").toLowerCase() === code.toLowerCase());
        item = found[0];
      }
    }
    if (!item) return { unknown: e.code ?? e.itemId ?? "" };
    const [existing] = await tx
      .select()
      .from(L)
      .where(and(eq(L.tenantId, tenantId), eq(L.auditId, audit.id), eq(L.itemId, item.id), e.batchId ? eq(L.batchId, e.batchId) : sql`${L.batchId} is null`))
      .limit(1)
      .for("update");
    if (existing) return { line: existing, created: false };
    let batchNo: string | null = null;
    let expiry: string | null = null;
    if (e.batchId) {
      const b = await this.inv.batches.batchRow(tx, tenantId, e.batchId);
      if (b.itemId !== item.id) throw badRequest("That batch belongs to another item");
      batchNo = b.batchNo;
      expiry = b.expiry;
    }
    const [row] = await tx
      .select({ avgCost: stockItems.avgCost })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.itemId, item.id), eq(stockItems.locationId, audit.locationId)))
      .limit(1);
    const [made] = await tx
      .insert(L)
      .values({
        tenantId,
        auditId: audit.id,
        itemId: item.id,
        batchId: e.batchId ?? null,
        itemName: item.name,
        unit: item.unit,
        barcode: item.barcode ?? null,
        sku: item.sku ?? null,
        batchNo,
        expiry,
        systemQty: "0",
        unitCost: row?.avgCost ?? null,
      })
      .returning();
    return { line: made!, created: true };
  }

  /**
   * Records counts: each entry adds to (or sets) one counter's count of a line, and the line's count becomes the sum
   * over all counters. Codes that match nothing are returned in `unknown` (nothing is recorded for them).
   */
  async count(tenantId: string, id: string, input: AuditCountInput, userId: string | null = null): Promise<CountResult> {
    const b = auditCountSchema.parse(input);
    const counter = b.counter ?? (userId ? `user-${userId.slice(0, 8)}` : "counter");
    return this.db.transaction(async (tx) => {
      const audit = await this.row(tx, tenantId, id, true);
      if (audit.status !== "counting") throw conflict(audit.status === "draft" ? "Start counting first" : `This count is ${audit.status}`);
      const results: CountResult["results"] = [];
      const unknown: string[] = [];
      for (const e of b.entries) {
        const hit = await this.resolveLine(tx, tenantId, audit, e);
        if ("unknown" in hit) {
          unknown.push(hit.unknown);
          continue;
        }
        const { line } = hit;
        await tx.insert(stockAuditEntries).values({ tenantId, auditId: id, lineId: line.id, mode: e.mode, qty: milliToDecimal(toMilli(e.qty)), counter, userId, createdAt: this.now() });
        const entries = await tx
          .select({ counter: stockAuditEntries.counter, mode: stockAuditEntries.mode, qty: stockAuditEntries.qty })
          .from(stockAuditEntries)
          .where(and(eq(stockAuditEntries.tenantId, tenantId), eq(stockAuditEntries.lineId, line.id)))
          .orderBy(asc(stockAuditEntries.createdAt), asc(stockAuditEntries.id));
        const merged = mergeCounts(entries.map((x): CountEntry => ({ counter: x.counter, mode: x.mode, milli: toMilli(x.qty) })));
        const counted = Math.max(0, merged ?? 0);
        await tx.update(stockAuditLines).set({ countedQty: milliToDecimal(counted) }).where(eq(stockAuditLines.id, line.id));
        results.push({ lineId: line.id, itemName: line.itemName, batchNo: line.batchNo, counted: fromMilli(counted), created: hit.created });
      }
      return { results, unknown };
    });
  }

  /** Review: change a line's count, reason or note. Only while the audit is in review. */
  async patchLine(tenantId: string, auditId: string, lineId: string, input: AuditLinePatch): Promise<AuditLineView> {
    const b = auditLinePatchSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const audit = await this.row(tx, tenantId, auditId, true);
      if (audit.status !== "review" && audit.status !== "counting") throw conflict("Lines can be changed while counting or reviewing");
      if (b.countedQty !== undefined && audit.status !== "review") throw conflict("Change counts through counting; the reviewer can recount in review");
      await this.lineById(tx, tenantId, auditId, lineId);
      const set: Partial<typeof stockAuditLines.$inferInsert> = {};
      if (b.countedQty !== undefined) set.countedQty = b.countedQty === null ? null : milliToDecimal(toMilli(b.countedQty));
      if (b.reason !== undefined) set.reason = b.reason;
      if (b.note !== undefined) set.note = b.note;
      const [row] = await tx.update(stockAuditLines).set(set).where(eq(stockAuditLines.id, lineId)).returning();
      return toLineView(row!);
    });
  }

  /** Sets one reason on every differing line (that has none yet). Returns how many lines changed. */
  async bulkReason(tenantId: string, auditId: string, input: z.input<typeof auditBulkReasonSchema>): Promise<{ updated: number }> {
    const b = auditBulkReasonSchema.parse(input);
    const audit = await this.row(this.db, tenantId, auditId);
    if (audit.status !== "review") throw conflict("Reasons are set while reviewing");
    const L = stockAuditLines;
    const rows = await this.db
      .update(L)
      .set({ reason: b.reason })
      .where(and(eq(L.tenantId, tenantId), eq(L.auditId, auditId), sql`${L.countedQty} is not null and ${L.countedQty} <> ${L.systemQty}`, b.onlyEmpty ? sql`${L.reason} is null` : undefined))
      .returning({ id: L.id });
    return { updated: rows.length };
  }

  // ================================================================ approve

  /**
   * Approves the count: each counted line that differs becomes an `audit` stock movement of `counted - system` at the
   * location (batch lines also move their batch), valued at the frozen cost. Needs a reason on every differing line
   * unless `allowMissingReasons`. All or nothing; an approved audit never changes again.
   */
  async approve(tenantId: string, id: string, input: AuditApproveInput = {}, userId: string | null = null): Promise<AuditView> {
    const b = auditApproveSchema.parse(input);
    const drops = this.inv.dropSinkPublic();
    const row = await this.db.transaction(async (tx) => {
      const audit = await this.row(tx, tenantId, id, true);
      if (audit.status !== "review") throw conflict(audit.status === "approved" ? "This count was already approved" : "Submit the count for review first");
      const lines = await tx
        .select()
        .from(stockAuditLines)
        .where(and(eq(stockAuditLines.tenantId, tenantId), eq(stockAuditLines.auditId, id)))
        .orderBy(asc(stockAuditLines.itemId), asc(stockAuditLines.id));
      const effective = lines.map((l) => ({ l, counted: l.countedQty !== null ? toMilli(l.countedQty) : b.uncounted === "zero" ? 0 : null }));
      const differing = effective.filter((x) => x.counted !== null && x.counted !== toMilli(x.l.systemQty));
      if (!b.allowMissingReasons) {
        const missing = differing.filter((x) => !x.l.reason);
        if (missing.length > 0) {
          throw badRequest(`${missing.length} line${missing.length === 1 ? "" : "s"} with a difference need a reason`, { lines: missing.slice(0, 20).map((x) => x.l.id), count: missing.length });
        }
      }
      let surplus = 0;
      let shortage = 0;
      for (const x of differing) {
        const l = x.l;
        const delta = x.counted! - toMilli(l.systemQty);
        const unitCost = l.unitCost ?? null;
        const value = Math.round((delta * (unitCost ?? 0)) / 1000);
        if (delta > 0) surplus += value;
        else shortage += -value;
        const note = `Stock audit ${audit.number}${l.reason ? `: ${l.reason}` : ""}${l.batchNo ? ` (batch ${l.batchNo})` : ""}`;
        const common = { tenantId, locationId: audit.locationId, itemId: l.itemId, deltaMilli: delta, reason: "audit" as const, refType: "audit", refId: audit.id, refNumber: audit.number, note, createdBy: userId };
        if (l.batchId) {
          await this.inv.change(tx, { ...common, unitCost: delta > 0 ? unitCost : null, skipBatch: true }, drops);
          if (delta > 0) {
            await this.inv.batches.applyDelta(tx, tenantId, { id: l.batchId, itemId: l.itemId }, audit.locationId, delta, "audit", { refType: "audit", refId: audit.id, refNumber: audit.number, note: l.reason, userId, unitCost });
          } else {
            const [lvl] = await tx
              .select({ qty: stockBatchLevels.qty })
              .from(stockBatchLevels)
              .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.batchId, l.batchId), eq(stockBatchLevels.locationId, audit.locationId)))
              .limit(1)
              .for("update");
            const take = Math.min(-delta, Math.max(0, toMilli(lvl?.qty ?? 0)));
            if (take > 0) await this.inv.batches.applyDelta(tx, tenantId, { id: l.batchId, itemId: l.itemId }, audit.locationId, -take, "audit", { refType: "audit", refId: audit.id, refNumber: audit.number, note: l.reason, userId });
          }
        } else {
          // The unbatched part of the item (or an item without batches): the batch ledger stays as it is.
          await this.inv.change(tx, { ...common, unitCost: delta > 0 ? unitCost : null, skipBatch: true }, drops);
        }
        await tx.update(stockAuditLines).set({ appliedAt: this.now(), countedQty: l.countedQty ?? "0" }).where(eq(stockAuditLines.id, l.id));
      }
      const totals: AuditTotals = {
        lines: lines.length,
        counted: effective.filter((x) => x.counted !== null).length,
        varianceLines: differing.length,
        surplusValue: surplus,
        shortageValue: shortage,
        netValue: surplus - shortage,
      };
      const [done] = await tx
        .update(stockAudits)
        .set({ status: "approved", approvedAt: this.now(), approvedBy: userId, totals, updatedAt: this.now() })
        .where(and(eq(stockAudits.tenantId, tenantId), eq(stockAudits.id, id)))
        .returning();
      return done!;
    });
    this.log.info({ tenantId, auditId: id }, "inventory: stock audit approved");
    await this.inv.emitLowStockPublic(tenantId, drops);
    return this.view(tenantId, row);
  }
}

