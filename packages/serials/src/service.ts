import { AppError, badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, searchAny } from "@srirealtime/core";
import type { Db, Tx } from "@srirealtime/db";
import { isValidDate, todayIST } from "@srirealtime/gst";
import { and, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  canMoveTo,
  checkSerialRows,
  MANUAL_STATUSES,
  normaliseSerial,
  ON_SHELF,
  phoneLast4Matches,
  publicWarrantyStatus,
  type PublicWarrantyStatus,
  stockDelta,
  warrantyDaysLeft,
  warrantyEnd,
  warrantyStatus,
  type RowProblem,
  type WarrantyStatus,
} from "./logic";
import {
  noopLogger,
  SERIALS_FEATURE,
  type CatalogPort,
  type FeatureGatePort,
  type LoggerPort,
  type SerialBill,
  type SerialReturn,
  type StockPort,
} from "./ports";
import {
  SERIAL_STATUSES,
  serialEvents,
  serialItems,
  serialUnits,
  type SerialEventRow,
  type SerialEventType,
  type SerialItemRow,
  type SerialStatus,
  type SerialUnitRow,
} from "./schema";

export interface SerialsDeps {
  db: Db;
  /** Inventory totals; without it units are tracked on their own. */
  stock?: StockPort;
  /** Item names when settings are saved without one. */
  catalog?: CatalogPort;
  /** The bill hooks run only for shops with the `serials` feature on. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  now?: () => Date;
}

/** Units in one receive call. */
export const MAX_RECEIVE = 500;
const MAX_PAISE = 2_000_000_000;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const itemSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    tracked: z.boolean().default(true),
    warrantyMonths: z.number().int().min(0).max(120).default(12),
    dualImei: z.boolean().default(false),
  })
  .strict();
export type ItemSettingsInput = z.input<typeof itemSettingsInput>;

export const receiveUnitsInput = z
  .object({
    itemId: z.string().uuid(),
    itemName: z.string().trim().min(1).max(200).optional(),
    units: z
      .array(z.object({ serial: z.string().max(60), serial2: z.string().max(60).nullish() }).strict())
      .min(1)
      .max(MAX_RECEIVE),
    purchaseRef: optText(60),
    supplier: optText(200),
    costPaise: z.number().int().min(0).max(MAX_PAISE).nullish(),
    note: optText(500),
  })
  .strict();
export type ReceiveUnitsInput = z.input<typeof receiveUnitsInput>;

export const statusInput = z.object({ status: z.enum(MANUAL_STATUSES), note: optText(500) }).strict();
export type StatusInput = z.input<typeof statusInput>;

export const claimInput = z.object({ note: z.string().trim().min(1).max(1000) }).strict();
export type ClaimInput = z.input<typeof claimInput>;

/** GET /units: `status` (comma list), `itemId` (ids), `q` over serial, IMEI 2, item, customer, phone, bill number. */
export const unitListQuery = listQuerySchema({ defaultLimit: 25, maxLimit: 200 }).extend({
  status: listFilter.oneOf(SERIAL_STATUSES),
  itemId: listFilter.ids(),
});
export type UnitListQuery = z.input<typeof unitListQuery>;

export const itemListQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 500 }).extend({ tracked: listFilter.bool() });
export type ItemListQuery = z.input<typeof itemListQuery>;

export const UNIT_SORT = defineSort(
  {
    received: serialUnits.receivedAt,
    sold: serialUnits.soldAt,
    serial: serialUnits.serial,
    item: sql`lower(${serialUnits.itemName})`,
    warranty: serialUnits.warrantyEnd,
    status: serialUnits.status,
  },
  { default: "-received", tieBreaker: [serialUnits.id] },
);
export const ITEM_SORT = defineSort(
  { name: sql`lower(${serialItems.name})`, warranty: serialItems.warrantyMonths, updated: serialItems.updatedAt },
  { default: "name", tieBreaker: [serialItems.id] },
);

export interface UnitView extends SerialUnitRow {
  warrantyStatus: WarrantyStatus;
  /** Days of warranty left counting today (0 once expired); null without a warranty. */
  warrantyDaysLeft: number | null;
}

export interface ItemView extends SerialItemRow {
  /** Units of this item on the shelf (in stock or returned). */
  inStock: number;
}

export interface WarrantyLookup {
  unit: UnitView;
  item: SerialItemRow | null;
  events: SerialEventRow[];
}

/** The public warranty page (no customer name, phone or bill): what the unit is and its warranty. */
export interface PublicWarranty {
  product: string;
  /** The serial / IMEI as looked up (upper case). */
  serial: string;
  /** Bill date the warranty runs from. */
  purchaseDate: string | null;
  warrantyMonths: number;
  warrantyEnd: string | null;
  status: PublicWarrantyStatus;
  /** Days of warranty left counting today (0 once expired); null without a warranty. */
  daysLeft: number | null;
}

export const publicWarrantyQuery = z.object({
  code: z.string().trim().min(3).max(60),
  /** Last 4 digits of the phone on the bill (optional; when given it must match). */
  last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Last 4 digits of your phone")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export interface ReceiveResult {
  received: number;
  items: SerialUnitRow[];
}

export interface SerialsSummary {
  inStock: number;
  defective: number;
  /** Sold units whose warranty ends between today and the end of this month (IST). */
  warrantyEndingThisMonth: number;
}

const PROBLEM_MESSAGES: Record<RowProblem["code"], string> = {
  empty: "Serial is empty",
  format: "Use letters, digits, - / . (3 to 40 characters)",
  imei_check: "Not a valid IMEI (check digit is wrong)",
  duplicate_in_batch: "Listed twice in this batch",
  same_as_imei1: "IMEI 2 is the same as IMEI 1",
  exists: "Already in stock records",
};

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

const monthEnd = (today: string) => {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export class SerialsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: SerialsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  unitView(row: SerialUnitRow, today = this.today()): UnitView {
    return { ...row, warrantyStatus: warrantyStatus(row.warrantyEnd, today), warrantyDaysLeft: warrantyDaysLeft(row.warrantyEnd, today) };
  }

  // ---------------------------------------------------------------- item settings

  private async inStockCounts(tenantId: string, itemIds: string[]): Promise<Map<string, number>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.db
      .select({ itemId: serialUnits.itemId, n: count() })
      .from(serialUnits)
      .where(and(eq(serialUnits.tenantId, tenantId), inArray(serialUnits.itemId, itemIds), inArray(serialUnits.status, [...ON_SHELF])))
      .groupBy(serialUnits.itemId);
    return new Map(rows.map((r) => [r.itemId, r.n]));
  }

  private async withCounts(tenantId: string, rows: SerialItemRow[]): Promise<ItemView[]> {
    const counts = await this.inStockCounts(tenantId, rows.map((r) => r.itemId));
    return rows.map((r) => ({ ...r, inStock: counts.get(r.itemId) ?? 0 }));
  }

  /** Settings for these items (items never set up are left out). The counter uses it to ask for serials. */
  async itemsFor(tenantId: string, itemIds: string[]): Promise<ItemView[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(serialItems)
      .where(and(eq(serialItems.tenantId, tenantId), inArray(serialItems.itemId, itemIds.slice(0, 500))));
    return this.withCounts(tenantId, rows);
  }

  async listItems(tenantId: string, query: ItemListQuery = {}) {
    const q = itemListQuery.parse(query);
    const where = and(eq(serialItems.tenantId, tenantId), q.tracked !== undefined ? eq(serialItems.tracked, q.tracked) : undefined, searchAny(q.q, [serialItems.name]));
    const [rows, [total]] = await Promise.all([
      this.db.select().from(serialItems).where(where).orderBy(...ITEM_SORT.orderBy(q.sort)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(serialItems).where(where),
    ]);
    return { items: await this.withCounts(tenantId, rows), total: total?.n ?? 0, limit: q.limit, offset: q.offset };
  }

  private async itemRow(tenantId: string, itemId: string, tx: Db | Tx = this.db): Promise<SerialItemRow | null> {
    const [row] = await tx
      .select()
      .from(serialItems)
      .where(and(eq(serialItems.tenantId, tenantId), eq(serialItems.itemId, itemId)))
      .limit(1);
    return row ?? null;
  }

  private async catalogueName(tenantId: string, itemId: string): Promise<string | null> {
    if (!this.deps.catalog) return null;
    try {
      const [v] = await this.deps.catalog.variants(tenantId, [itemId]);
      return v?.name ?? null;
    } catch (err) {
      this.log.warn({ err, tenantId, itemId }, "serials: catalogue lookup failed");
      return null;
    }
  }

  /** First receive of an item: settings with the defaults (tracked, 12 months, one serial). */
  private async createItem(tenantId: string, itemId: string, itemName: string | undefined): Promise<SerialItemRow> {
    const name = itemName ?? (await this.catalogueName(tenantId, itemId));
    if (!name) throw badRequest("Give the item's name", { field: "itemName" });
    const [row] = await this.db.insert(serialItems).values({ tenantId, itemId, name }).onConflictDoNothing().returning();
    const item = row ?? (await this.itemRow(tenantId, itemId));
    if (!item) throw conflict("Item settings could not be saved; try again");
    return item;
  }

  async saveItem(tenantId: string, itemId: string, input: unknown): Promise<ItemView> {
    const body = itemSettingsInput.parse(input);
    const existing = await this.itemRow(tenantId, itemId);
    const name = body.name ?? (await this.catalogueName(tenantId, itemId)) ?? existing?.name;
    if (!name) throw badRequest("Give the item's name", { field: "name" });
    const set = { name, tracked: body.tracked, warrantyMonths: body.warrantyMonths, dualImei: body.dualImei };
    const [row] = await this.db
      .insert(serialItems)
      .values({ tenantId, itemId, ...set })
      .onConflictDoUpdate({ target: [serialItems.tenantId, serialItems.itemId], set: { ...set, updatedAt: new Date() } })
      .returning();
    const [view] = await this.withCounts(tenantId, [row!]);
    return view!;
  }

  // ---------------------------------------------------------------- units

  private async event(
    tx: Db | Tx,
    tenantId: string,
    unitId: string,
    type: SerialEventType,
    ref: { refType?: string | null; refId?: string | null; refNumber?: string | null; note?: string | null; userId?: string | null } = {},
  ): Promise<SerialEventRow> {
    const [row] = await tx
      .insert(serialEvents)
      .values({
        tenantId,
        unitId,
        type,
        refType: ref.refType ?? null,
        refId: ref.refId ?? null,
        refNumber: ref.refNumber ?? null,
        note: ref.note ?? null,
        userId: ref.userId ?? null,
      })
      .returning();
    return row!;
  }

  /** Serials (either column) already recorded for this shop, among `codes`. */
  private async existing(tx: Db | Tx, tenantId: string, codes: string[]): Promise<Set<string>> {
    if (codes.length === 0) return new Set();
    const rows = await tx
      .select({ serial: serialUnits.serial, serial2: serialUnits.serial2 })
      .from(serialUnits)
      .where(and(eq(serialUnits.tenantId, tenantId), or(inArray(serialUnits.serial, codes), inArray(serialUnits.serial2, codes))));
    return new Set(rows.flatMap((r) => (r.serial2 ? [r.serial, r.serial2] : [r.serial])));
  }

  /**
   * Receives units of one item (pasted or scanned serials, IMEI 2 for dual-SIM phones). Every row is checked first
   * (format, IMEI check digit for 15-digit values, repeats in the batch, serials already recorded); any problem rejects
   * the whole batch with a 400 whose `details.rows` lists `{ index, field, value, code, message }`. Inventory goes up
   * by the number of units.
   */
  async receive(tenantId: string, input: unknown, userId: string | null = null): Promise<ReceiveResult> {
    const body = receiveUnitsInput.parse(input);
    const { rows, problems } = checkSerialRows(body.units);
    const codes = [...new Set(rows.flatMap((r) => (r.serial2 ? [r.serial, r.serial2] : [r.serial])).filter(Boolean))];
    const taken = await this.existing(this.db, tenantId, codes);
    const flagged = new Set(problems.map((p) => `${p.index}:${p.field}`));
    rows.forEach((r, index) => {
      if (!flagged.has(`${index}:serial`) && taken.has(r.serial)) problems.push({ index, field: "serial", value: r.serial, code: "exists" });
      if (r.serial2 && !flagged.has(`${index}:serial2`) && taken.has(r.serial2)) problems.push({ index, field: "serial2", value: r.serial2, code: "exists" });
    });
    if (problems.length) {
      problems.sort((a, b) => a.index - b.index || a.field.localeCompare(b.field));
      throw badRequest(problems.length === 1 ? "1 serial can't be received" : `${problems.length} serials can't be received`, {
        rows: problems.map((p) => ({ ...p, message: PROBLEM_MESSAGES[p.code] })),
      });
    }

    const item = (await this.itemRow(tenantId, body.itemId)) ?? (await this.createItem(tenantId, body.itemId, body.itemName));
    const itemName = body.itemName ?? item.name;

    let saved: SerialUnitRow[];
    try {
      saved = await this.db.transaction(async (tx) => {
        const units = await tx
          .insert(serialUnits)
          .values(
            rows.map((r) => ({
              tenantId,
              itemId: body.itemId,
              itemName,
              serial: r.serial,
              serial2: r.serial2,
              purchaseRef: body.purchaseRef,
              supplier: body.supplier,
              costPaise: body.costPaise ?? null,
              warrantyMonths: item.warrantyMonths,
              note: body.note,
            })),
          )
          .returning();
        await tx.insert(serialEvents).values(
          units.map((u) => ({
            tenantId,
            unitId: u.id,
            type: "received" as const,
            refType: body.purchaseRef ? "purchase" : null,
            refNumber: body.purchaseRef,
            note: body.note,
            userId,
          })),
        );
        return units;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("One of these serials was just received; check the list and try again");
      throw err;
    }
    const note = `${saved.length} unit${saved.length === 1 ? "" : "s"} received${body.purchaseRef ? ` (${body.purchaseRef})` : ""}`;
    await this.deps.stock
      ?.add(tenantId, body.itemId, saved.length, note, body.costPaise ?? null, userId)
      .catch((err) => this.log.error({ err, tenantId, itemId: body.itemId }, "serials: inventory add failed"));
    return { received: saved.length, items: saved };
  }

  /** WHERE of the unit list; without `status` for the status facet counts. */
  unitConditions(tenantId: string, q: z.output<typeof unitListQuery>, withStatus = true): SQL | undefined {
    const term = q.q ? normaliseSerial(q.q) : undefined;
    return and(
      eq(serialUnits.tenantId, tenantId),
      withStatus && q.status?.length ? inArray(serialUnits.status, q.status) : undefined,
      q.itemId?.length ? inArray(serialUnits.itemId, q.itemId) : undefined,
      q.q
        ? or(
            searchAny(term, [serialUnits.serial, serialUnits.serial2]),
            searchAny(q.q, [serialUnits.itemName, serialUnits.customerName, serialUnits.customerPhone, serialUnits.invoiceNumber, serialUnits.purchaseRef]),
          )
        : undefined,
    );
  }

  /** Units, newest received first by default; `facets.status` counts each status under the other filters. */
  async listUnits(tenantId: string, query: UnitListQuery = {}) {
    const q = unitListQuery.parse(query);
    const today = this.today();
    const where = this.unitConditions(tenantId, q);
    const [rows, [total], byStatus] = await Promise.all([
      this.db.select().from(serialUnits).where(where).orderBy(...UNIT_SORT.orderBy(q.sort)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(serialUnits).where(where),
      this.db.select({ key: serialUnits.status, n: count() }).from(serialUnits).where(this.unitConditions(tenantId, q, false)).groupBy(serialUnits.status),
    ]);
    return {
      items: rows.map((r) => this.unitView(r, today)),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { status: facetCounts(byStatus) },
    };
  }

  private async unitRow(tenantId: string, id: string, tx: Db | Tx = this.db, lock = false): Promise<SerialUnitRow> {
    const q = tx
      .select()
      .from(serialUnits)
      .where(and(eq(serialUnits.tenantId, tenantId), eq(serialUnits.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Unit");
    return row;
  }

  async events(tenantId: string, unitId: string): Promise<SerialEventRow[]> {
    return this.db
      .select()
      .from(serialEvents)
      .where(and(eq(serialEvents.tenantId, tenantId), eq(serialEvents.unitId, unitId)))
      .orderBy(desc(serialEvents.createdAt), desc(serialEvents.id))
      .limit(200);
  }

  async getUnit(tenantId: string, id: string): Promise<UnitView & { events: SerialEventRow[] }> {
    const row = await this.unitRow(tenantId, id);
    return { ...this.unitView(row), events: await this.events(tenantId, id) };
  }

  /**
   * Marks a unit defective, written off or back in stock (with a note). Sold units change only through their bill
   * (cancel) or a credit note. Inventory follows: off the shelf −1, back on +1.
   */
  async setStatus(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<UnitView> {
    const body = statusInput.parse(input);
    const { row, from } = await this.db.transaction(async (tx) => {
      const unit = await this.unitRow(tenantId, id, tx, true);
      if (unit.status === body.status) return { row: unit, from: unit.status };
      if (!canMoveTo(unit.status, body.status)) {
        throw new AppError(409, "invalid_status", unit.status === "sold" ? "A sold unit comes back through its bill or a credit note" : `Can't move a ${unit.status.replace("_", " ")} unit to ${body.status.replace("_", " ")}`);
      }
      const back = body.status === "in_stock";
      const [updated] = await tx
        .update(serialUnits)
        .set({
          status: body.status,
          ...(back ? { invoiceId: null, invoiceNumber: null, soldAt: null, soldOn: null, customerName: null, customerPhone: null, warrantyEnd: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(serialUnits.tenantId, tenantId), eq(serialUnits.id, id)))
        .returning();
      await this.event(tx, tenantId, id, body.status === "in_stock" ? "back_in_stock" : body.status, { note: body.note, userId });
      return { row: updated!, from: unit.status };
    });
    const delta = stockDelta(from, row.status);
    if (delta !== 0 && this.deps.stock) {
      const note = `${row.serial}: ${row.status === "in_stock" ? "back in stock" : row.status.replace("_", " ")}${body.note ? ` (${body.note})` : ""}`;
      const done = delta > 0 ? this.deps.stock.add(tenantId, row.itemId, 1, note, row.costPaise ?? null, userId) : this.deps.stock.remove(tenantId, row.itemId, 1, note, userId);
      await done.catch((err) => this.log.error({ err, tenantId, itemId: row.itemId }, "serials: inventory adjust failed"));
    }
    return this.unitView(row);
  }

  /** A warranty claim (or any note) on a unit's history. The host may turn it into a job card. */
  async claim(tenantId: string, unitId: string, input: unknown, userId: string | null = null): Promise<SerialEventRow> {
    const body = claimInput.parse(input);
    await this.unitRow(tenantId, unitId);
    return this.event(this.db, tenantId, unitId, "warranty_claim", { note: body.note, userId });
  }

  /** Any unit (any status) whose serial or IMEI 2 is `code`. */
  private async byCode(tenantId: string, code: string): Promise<SerialUnitRow | null> {
    const c = normaliseSerial(code);
    if (!c) return null;
    const [row] = await this.db
      .select()
      .from(serialUnits)
      .where(and(eq(serialUnits.tenantId, tenantId), or(eq(serialUnits.serial, c), eq(serialUnits.serial2, c))))
      .limit(1);
    return row ?? null;
  }

  /** Warranty lookup by IMEI / serial: the unit with its sale, warranty end and status, item settings and history. */
  async warranty(tenantId: string, code: string): Promise<WarrantyLookup> {
    const unit = await this.byCode(tenantId, code);
    if (!unit) throw notFound("Serial");
    const [item, events] = await Promise.all([this.itemRow(tenantId, unit.itemId), this.events(tenantId, unit.id)]);
    return { unit: this.unitView(unit), item, events };
  }

  /**
   * The customer's public warranty lookup by serial / IMEI (+ the last 4 digits of the phone on the bill, when given):
   * only units sold by this shop; null when there is no such sale or the digits don't match (the caller answers the
   * same 404 either way, so a lookup never tells which). Never returns the customer's name, phone or bill.
   */
  async publicWarranty(tenantId: string, query: unknown): Promise<PublicWarranty | null> {
    const q = publicWarrantyQuery.parse(query ?? {});
    const unit = await this.byCode(tenantId, q.code);
    if (!unit || unit.status !== "sold") return null;
    if (q.last4 !== undefined && !phoneLast4Matches(unit.customerPhone, q.last4)) return null;
    const since = unit.soldAt ?? unit.receivedAt;
    const [claim] = await this.db
      .select({ n: count() })
      .from(serialEvents)
      .where(and(eq(serialEvents.tenantId, tenantId), eq(serialEvents.unitId, unit.id), eq(serialEvents.type, "warranty_claim"), gte(serialEvents.createdAt, since)));
    const today = this.today();
    return {
      product: unit.itemName,
      serial: normaliseSerial(q.code),
      purchaseDate: unit.soldOn,
      warrantyMonths: unit.warrantyMonths,
      warrantyEnd: unit.warrantyEnd,
      status: publicWarrantyStatus(unit.warrantyEnd, today, (claim?.n ?? 0) > 0),
      daysLeft: warrantyDaysLeft(unit.warrantyEnd, today),
    };
  }

  /**
   * Of `serials`, the ones that are not on the shelf for `itemId` (in stock or returned) — unknown, sold, defective or
   * another item's. Normalised (upper case, no spaces). For job cards selling parts with serial numbers.
   */
  async unavailableFor(tenantId: string, itemId: string, serials: string[]): Promise<string[]> {
    const codes = [...new Set(serials.map(normaliseSerial).filter(Boolean))];
    if (codes.length === 0) return [];
    const rows = await this.db
      .select({ serial: serialUnits.serial })
      .from(serialUnits)
      .where(and(eq(serialUnits.tenantId, tenantId), eq(serialUnits.itemId, itemId), inArray(serialUnits.status, [...ON_SHELF]), inArray(serialUnits.serial, codes)));
    const ok = new Set(rows.map((r) => r.serial));
    return codes.filter((c) => !ok.has(c));
  }

  /**
   * POS scan: an in-stock unit whose serial or IMEI 2 equals the scanned code → its item and (IMEI 1) serial; else
   * null. Never throws.
   */
  async resolveCode(tenantId: string, code: string): Promise<{ itemId: string; serial: string } | null> {
    try {
      const c = normaliseSerial(code ?? "");
      if (!c || c.length > 60) return null;
      const [row] = await this.db
        .select({ itemId: serialUnits.itemId, serial: serialUnits.serial })
        .from(serialUnits)
        .where(and(eq(serialUnits.tenantId, tenantId), eq(serialUnits.status, "in_stock"), or(eq(serialUnits.serial, c), eq(serialUnits.serial2, c))))
        .limit(1);
      return row ?? null;
    } catch (err) {
      this.log.warn({ err, tenantId }, "serials: resolve failed");
      return null;
    }
  }

  async summary(tenantId: string): Promise<SerialsSummary> {
    const today = this.today();
    const end = monthEnd(today);
    const [r] = await this.db
      .select({
        inStock: sql<number>`count(*) filter (where ${serialUnits.status} in ('in_stock', 'returned'))::int`,
        defective: sql<number>`count(*) filter (where ${serialUnits.status} = 'defective')::int`,
        ending: sql<number>`count(*) filter (where ${serialUnits.status} = 'sold' and ${serialUnits.warrantyEnd} >= ${today} and ${serialUnits.warrantyEnd} <= ${end})::int`,
      })
      .from(serialUnits)
      .where(eq(serialUnits.tenantId, tenantId));
    return { inStock: r?.inStock ?? 0, defective: r?.defective ?? 0, warrantyEndingThisMonth: r?.ending ?? 0 };
  }

  /** Sold units whose warranty ends between `from` and `to` (for reminders / reports). */
  async warrantyEnding(tenantId: string, from: string, to: string, limit = 200): Promise<UnitView[]> {
    if (!isValidDate(from) || !isValidDate(to)) throw badRequest("Use YYYY-MM-DD dates");
    const rows = await this.db
      .select()
      .from(serialUnits)
      .where(and(eq(serialUnits.tenantId, tenantId), eq(serialUnits.status, "sold"), gte(serialUnits.warrantyEnd, from), lte(serialUnits.warrantyEnd, to)))
      .orderBy(serialUnits.warrantyEnd, serialUnits.id)
      .limit(Math.min(Math.max(limit, 1), 1000));
    const today = this.today();
    return rows.map((r) => this.unitView(r, today));
  }

  // ---------------------------------------------------------------- bill hooks

  private async enabled(tenantId: string) {
    return this.deps.featureGate ? this.deps.featureGate.isEnabled(tenantId, SERIALS_FEATURE) : true;
  }

  /**
   * A bill was issued: marks each serial listed on its lines sold (to the bill's customer) and starts its warranty from
   * the bill date with the item's warranty months. A serial that isn't on the shelf or belongs to another item is
   * logged and skipped. Idempotent per bill; never throws (the sale stands).
   */
  async onInvoiceIssued(tenantId: string, bill: SerialBill): Promise<void> {
    try {
      const lines = bill.lines.filter((l) => l.serials?.length);
      if (lines.length === 0) return;
      if (!(await this.enabled(tenantId))) return;
      const soldOn = isValidDate(bill.date) ? bill.date : this.today();
      await this.db.transaction(async (tx) => {
        // One run per shop+bill, so a retried hook can't sell twice.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`serials:${tenantId}:${bill.id}`}))`);
        const [done] = await tx
          .select({ n: count() })
          .from(serialEvents)
          .where(and(eq(serialEvents.tenantId, tenantId), eq(serialEvents.refId, bill.id), eq(serialEvents.type, "sold")));
        if ((done?.n ?? 0) > 0) return;
        const codes = [...new Set(lines.flatMap((l) => l.serials!.map(normaliseSerial)).filter(Boolean))];
        if (codes.length === 0) return;
        const units = await tx
          .select()
          .from(serialUnits)
          .where(and(eq(serialUnits.tenantId, tenantId), or(inArray(serialUnits.serial, codes), inArray(serialUnits.serial2, codes))))
          .for("update");
        const itemIds = [...new Set(units.map((u) => u.itemId))];
        const items = itemIds.length
          ? await tx
              .select()
              .from(serialItems)
              .where(and(eq(serialItems.tenantId, tenantId), inArray(serialItems.itemId, itemIds)))
          : [];
        const months = new Map(items.map((i) => [i.itemId, i.warrantyMonths]));
        const used = new Set<string>();
        for (const line of lines) {
          const mine = [...new Set(line.serials!.map(normaliseSerial).filter(Boolean))];
          if (mine.length !== Math.round(line.qty)) this.log.warn({ tenantId, invoiceId: bill.id, itemId: line.itemId, qty: line.qty, serials: mine.length }, "serials: serial count differs from line quantity");
          for (const code of mine) {
            const unit = units.find((u) => u.serial === code || u.serial2 === code);
            if (!unit) {
              this.log.warn({ tenantId, invoiceId: bill.id, serial: code }, "serials: sold serial not on record");
              continue;
            }
            if (used.has(unit.id)) continue;
            if (!ON_SHELF.includes(unit.status) || (line.itemId && unit.itemId !== line.itemId)) {
              this.log.warn({ tenantId, invoiceId: bill.id, serial: code, status: unit.status, unitItem: unit.itemId, lineItem: line.itemId }, "serials: sold serial not in stock or for another item");
              continue;
            }
            used.add(unit.id);
            const m = months.get(unit.itemId) ?? unit.warrantyMonths;
            await tx
              .update(serialUnits)
              .set({
                status: "sold",
                invoiceId: bill.id,
                invoiceNumber: bill.number,
                soldAt: this.now(),
                soldOn,
                customerName: bill.customer.name || null,
                customerPhone: bill.customer.phone,
                warrantyMonths: m,
                warrantyEnd: warrantyEnd(soldOn, m),
                updatedAt: new Date(),
              })
              .where(eq(serialUnits.id, unit.id));
            await this.event(tx, tenantId, unit.id, "sold", { refType: "invoice", refId: bill.id, refNumber: bill.number });
          }
        }
      });
    } catch (err) {
      this.log.error({ err, tenantId, invoiceId: bill.id }, "serials: marking sold failed");
    }
  }

  /** A bill was cancelled: its sold units go back in stock (sale and warranty cleared). Idempotent; never throws. */
  async onInvoiceCancelled(tenantId: string, invoiceId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`serials:${tenantId}:${invoiceId}`}))`);
        const units = await tx
          .select()
          .from(serialUnits)
          .where(and(eq(serialUnits.tenantId, tenantId), eq(serialUnits.invoiceId, invoiceId), eq(serialUnits.status, "sold")))
          .for("update");
        for (const u of units) {
          await tx
            .update(serialUnits)
            .set({ status: "in_stock", invoiceId: null, invoiceNumber: null, soldAt: null, soldOn: null, customerName: null, customerPhone: null, warrantyEnd: null, updatedAt: new Date() })
            .where(eq(serialUnits.id, u.id));
          await this.event(tx, tenantId, u.id, "sale_cancelled", { refType: "invoice", refId: invoiceId, refNumber: u.invoiceNumber });
        }
      });
    } catch (err) {
      this.log.error({ err, tenantId, invoiceId }, "serials: sale reversal failed");
    }
  }

  /**
   * A credit note took units back: those sold on the bill become `returned` (on the shelf; a "back in stock" action
   * makes them sellable), or `defective` when not restocked. Warranty ends. Idempotent; never throws.
   */
  async onCreditNote(tenantId: string, ret: SerialReturn): Promise<void> {
    try {
      const codes = [...new Set(ret.serials.map(normaliseSerial).filter(Boolean))];
      if (codes.length === 0) return;
      const status: SerialStatus = ret.restocked === false ? "defective" : "returned";
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`serials:${tenantId}:${ret.invoiceId}`}))`);
        const units = await tx
          .select()
          .from(serialUnits)
          .where(
            and(
              eq(serialUnits.tenantId, tenantId),
              eq(serialUnits.invoiceId, ret.invoiceId),
              eq(serialUnits.status, "sold"),
              or(inArray(serialUnits.serial, codes), inArray(serialUnits.serial2, codes)),
            ),
          )
          .for("update");
        if (units.length < codes.length) this.log.warn({ tenantId, invoiceId: ret.invoiceId, codes, found: units.length }, "serials: returned serials not sold on this bill");
        for (const u of units) {
          await tx.update(serialUnits).set({ status, warrantyEnd: null, updatedAt: new Date() }).where(eq(serialUnits.id, u.id));
          await this.event(tx, tenantId, u.id, "returned", {
            refType: "credit_note",
            refId: ret.creditNoteId ?? ret.invoiceId,
            refNumber: ret.creditNoteNumber ?? u.invoiceNumber,
            note: ret.restocked === false ? "Not restocked" : null,
          });
        }
      });
    } catch (err) {
      this.log.error({ err, tenantId, invoiceId: ret.invoiceId }, "serials: return failed");
    }
  }
}
