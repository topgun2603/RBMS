import { randomBytes } from "node:crypto";
import { AppError, badRequest, conflict, notFound, type TenantRef } from "@srirealtime/core";
import type { Db, Tx } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { canMoveKot, groupByStation, mergeLines, orderAmount, roundQty, splitLines } from "./logic";
import { noopLogger, type BillingPort, type BillResult, type DiningEventsPort, type LoggerPort, type MenuSourcePort } from "./ports";
import {
  ACTIVE_KOT_STATUSES,
  DEFAULT_STATION,
  diningAreas,
  diningKots,
  diningMenuItems,
  diningOrderItems,
  diningOrders,
  diningTables,
  KOT_STATUSES,
  ORDER_STATUSES,
  ORDER_TYPES,
  type DiningAreaRow,
  type DiningKotRow,
  type DiningMenuItemRow,
  type DiningOrderItemRow,
  type DiningOrderRow,
  type DiningOrderSource,
  type DiningTableRow,
  type KotStatus,
} from "./schema";

export interface DiningDeps {
  db: Db;
  billing?: BillingPort;
  menu?: MenuSourcePort;
  events?: DiningEventsPort;
  log?: LoggerPort;
  now?: () => Date;
}

const MAX_QTY = 10_000;
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const areaInput = z.object({ name: z.string().trim().min(1).max(60), sort: z.number().int().min(0).max(10_000).optional() }).strict();
export const tableInput = z
  .object({
    name: z.string().trim().min(1).max(30),
    areaId: z.string().uuid().nullish(),
    seats: z.number().int().min(1).max(100).default(4),
    sort: z.number().int().min(0).max(10_000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const tablePatch = tableInput.partial().strict();

export const menuItemInput = z
  .object({
    station: z.string().trim().min(1).max(30).optional(),
    veg: z.boolean().nullish(),
    available: z.boolean().optional(),
  })
  .strict();

export const lineInput = z
  .object({
    itemId: z.string().uuid().nullish(),
    /** Free-text line (no item): name and rate are required. */
    name: z.string().trim().min(1).max(200).optional(),
    rate: z.number().int().min(0).max(100_000_000).optional(),
    gstRate: z.number().min(0).max(28).optional(),
    qty: z.number().positive().max(MAX_QTY),
    note: optText(200),
  })
  .strict()
  .refine((l) => l.itemId || (l.name && l.rate !== undefined), { message: "Pick an item, or give a name and rate" });
export type LineInput = z.input<typeof lineInput>;

export const openInput = z
  .object({
    type: z.enum(ORDER_TYPES).default("dine_in"),
    tableId: z.string().uuid().nullish(),
    guests: z.number().int().min(1).max(200).nullish(),
    customerName: optText(120),
    customerPhone: optText(20),
    note: optText(500),
    items: z.array(lineInput).max(200).optional(),
    /** Send the items straight to the kitchen (takeaway at the counter). */
    sendKot: z.boolean().optional(),
  })
  .strict()
  .refine((o) => o.type !== "dine_in" || !!o.tableId, { message: "Pick a table", path: ["tableId"] });
export type OpenInput = z.input<typeof openInput>;

export const orderPatch = z
  .object({
    tableId: z.string().uuid().nullish(),
    guests: z.number().int().min(1).max(200).nullish(),
    customerName: optText(120),
    customerPhone: optText(20),
    note: optText(500),
  })
  .strict();

export const linePatch = z.object({ qty: z.number().positive().max(MAX_QTY).optional(), note: optText(200) }).strict();
export const cancelInput = z.object({ reason: z.string().trim().min(2).max(200) }).strict();

export const billInput = z
  .object({
    /** Line ids per bill for a split; leave out for one bill. Lines not listed go on a last bill. */
    splits: z.array(z.array(z.string().uuid()).max(200)).max(20).optional(),
    customer: z.object({ name: z.string().trim().min(1).max(120), phone: optText(20) }).nullish(),
    tillSessionId: z.string().uuid().nullish(),
  })
  .strict();
export type BillInput = z.input<typeof billInput>;

export const ordersQuery = z.object({
  status: z.enum(ORDER_STATUSES).default("open"),
  type: z.enum(ORDER_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const kitchenQuery = z.object({
  station: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])),
  /** Also tickets served in the last N minutes (the "recall" column). */
  recent: z.coerce.number().int().min(0).max(240).default(0),
});

export const kotMove = z.object({ status: z.enum(KOT_STATUSES) }).strict();

export interface OrderLine extends Omit<DiningOrderItemRow, "qty"> {
  qty: number;
  amount: number;
}

export interface OrderView extends DiningOrderRow {
  tableName: string | null;
  items: OrderLine[];
  kots: DiningKotRow[];
  amount: number;
  pendingCount: number;
}

export interface FloorTable extends DiningTableRow {
  order: { id: string; number: number; guests: number | null; amount: number; openedAt: Date; activeKots: number; readyKots: number } | null;
}

export interface KitchenTicket extends DiningKotRow {
  orderNumber: number;
  orderType: DiningOrderRow["type"];
  orderSource: DiningOrderSource;
  /** Delivery platform of an aggregator order ("zomato", "swiggy"…), for the badge. */
  platform: string | null;
  /** When the order must be ready (rider pickup): the ticket counts down to it. */
  dueAt: Date | null;
  tableName: string | null;
  customerName: string | null;
  orderNote: string | null;
  items: { id: string; name: string; qty: number; note: string | null; status: DiningOrderItemRow["status"]; cancelReason: string | null }[];
}

const toNum = (v: string | number | null | undefined) => Number(v ?? 0);
const qrToken = () => randomBytes(12).toString("base64url");

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Extra fields of an order from outside the restaurant (delivery platforms). */
export interface ExternalExtra {
  platform?: string | null;
  dueAt?: Date | null;
  taxByOperator?: boolean;
  /** The platform already took the order: a sold-out item still goes to the kitchen (staff can reject the order). */
  allowSoldOut?: boolean;
}

/** A delivery-platform order for the kitchen (rates in paise; lines without an item are shown by name). */
export interface ExternalOrderInput {
  ref: string;
  type: "delivery" | "takeaway";
  platform: string;
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  dueAt: Date | null;
  taxByOperator: boolean;
  lines: { itemId: string | null; name: string; qty: number; rate: number; gstRate?: number; note: string | null }[];
  /** Send the KOTs now (accepted orders); otherwise the lines wait until the order is accepted. */
  send: boolean;
}

export class DiningService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: DiningDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  private changed(tenantId: string, kind: "kot" | "order", id: string) {
    try {
      void Promise.resolve(this.deps.events?.changed(tenantId, { kind, id })).catch(() => {});
    } catch {
      /* listeners never break a request */
    }
  }

  // ---------------------------------------------------------------- areas & tables

  async areas(tenantId: string): Promise<DiningAreaRow[]> {
    return this.db.select().from(diningAreas).where(eq(diningAreas.tenantId, tenantId)).orderBy(asc(diningAreas.sort), asc(diningAreas.name));
  }

  async createArea(tenantId: string, input: unknown): Promise<DiningAreaRow> {
    const b = areaInput.parse(input);
    try {
      const [row] = await this.db.insert(diningAreas).values({ tenantId, name: b.name, sort: b.sort ?? 0 }).returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("An area with that name exists");
      throw err;
    }
  }

  async updateArea(tenantId: string, id: string, input: unknown): Promise<DiningAreaRow> {
    const b = areaInput.partial().strict().parse(input);
    try {
      const [row] = await this.db
        .update(diningAreas)
        .set({ ...b, updatedAt: new Date() })
        .where(and(eq(diningAreas.tenantId, tenantId), eq(diningAreas.id, id)))
        .returning();
      if (!row) throw notFound("Area");
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("An area with that name exists");
      throw err;
    }
  }

  /** Deletes an area; its tables stay, without an area. */
  async deleteArea(tenantId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(diningTables).set({ areaId: null }).where(and(eq(diningTables.tenantId, tenantId), eq(diningTables.areaId, id)));
      const rows = await tx.delete(diningAreas).where(and(eq(diningAreas.tenantId, tenantId), eq(diningAreas.id, id))).returning({ id: diningAreas.id });
      if (rows.length === 0) throw notFound("Area");
    });
  }

  async tables(tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<DiningTableRow[]> {
    return this.db
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.tenantId, tenantId), opts.includeInactive ? undefined : eq(diningTables.active, true)))
      .orderBy(asc(diningTables.sort), asc(diningTables.name));
  }

  private async table(tenantId: string, id: string, tx: Db | Tx = this.db): Promise<DiningTableRow> {
    const [row] = await tx
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.tenantId, tenantId), eq(diningTables.id, id)))
      .limit(1);
    if (!row) throw notFound("Table");
    return row;
  }

  private async checkArea(tenantId: string, areaId: string | null | undefined) {
    if (!areaId) return;
    const [a] = await this.db
      .select({ id: diningAreas.id })
      .from(diningAreas)
      .where(and(eq(diningAreas.tenantId, tenantId), eq(diningAreas.id, areaId)))
      .limit(1);
    if (!a) throw badRequest("Unknown area");
  }

  async createTable(tenantId: string, input: unknown): Promise<DiningTableRow> {
    const b = tableInput.parse(input);
    await this.checkArea(tenantId, b.areaId);
    try {
      const [row] = await this.db
        .insert(diningTables)
        .values({ tenantId, name: b.name, areaId: b.areaId ?? null, seats: b.seats, sort: b.sort ?? 0, active: b.active ?? true, qrToken: qrToken() })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A table with that name exists");
      throw err;
    }
  }

  async updateTable(tenantId: string, id: string, input: unknown): Promise<DiningTableRow> {
    const b = tablePatch.parse(input);
    await this.table(tenantId, id);
    await this.checkArea(tenantId, b.areaId);
    try {
      const [row] = await this.db
        .update(diningTables)
        .set({ ...b, updatedAt: new Date() })
        .where(and(eq(diningTables.tenantId, tenantId), eq(diningTables.id, id)))
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A table with that name exists");
      throw err;
    }
  }

  /** Removes a table with no open order (past orders keep their table id). */
  async deleteTable(tenantId: string, id: string): Promise<void> {
    await this.table(tenantId, id);
    const [open] = await this.db
      .select({ id: diningOrders.id })
      .from(diningOrders)
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.tableId, id), eq(diningOrders.status, "open")))
      .limit(1);
    if (open) throw conflict("This table has an open order");
    await this.db.delete(diningTables).where(and(eq(diningTables.tenantId, tenantId), eq(diningTables.id, id)));
  }

  /** New QR code for a table (the printed one stops working). */
  async rotateQr(tenantId: string, id: string): Promise<DiningTableRow> {
    await this.table(tenantId, id);
    const [row] = await this.db
      .update(diningTables)
      .set({ qrToken: qrToken(), updatedAt: new Date() })
      .where(and(eq(diningTables.tenantId, tenantId), eq(diningTables.id, id)))
      .returning();
    return row!;
  }

  /** Areas and tables with each table's open order (amount, guests, kitchen state), plus open takeaway/online orders. */
  async floor(tenantId: string) {
    const [areas, tables, open] = await Promise.all([this.areas(tenantId), this.tables(tenantId), this.openOrders(tenantId)]);
    const byTable = new Map(open.filter((o) => o.tableId).map((o) => [o.tableId!, o]));
    const floor: FloorTable[] = tables.map((t) => {
      const o = byTable.get(t.id);
      return {
        ...t,
        order: o
          ? { id: o.id, number: o.number, guests: o.guests, amount: o.amount, openedAt: o.createdAt, activeKots: o.activeKots, readyKots: o.readyKots }
          : null,
      };
    });
    return { areas, tables: floor, orders: open.filter((o) => !o.tableId) };
  }

  /** Open orders with their amount and kitchen state, oldest first. */
  private async openOrders(tenantId: string) {
    const rows = await this.db
      .select({
        order: diningOrders,
        tableName: diningTables.name,
        amount: sql<string>`coalesce((select sum(${diningOrderItems.qty} * ${diningOrderItems.rate}) from ${diningOrderItems} where ${diningOrderItems.tenantId} = ${tenantId} and ${diningOrderItems.orderId} = ${diningOrders.id} and ${diningOrderItems.status} <> 'cancelled'), 0)`,
        activeKots: sql<number>`(select count(*)::int from ${diningKots} where ${diningKots.tenantId} = ${tenantId} and ${diningKots.orderId} = ${diningOrders.id} and ${diningKots.status} in ('new', 'preparing'))`,
        readyKots: sql<number>`(select count(*)::int from ${diningKots} where ${diningKots.tenantId} = ${tenantId} and ${diningKots.orderId} = ${diningOrders.id} and ${diningKots.status} = 'ready')`,
        pending: sql<number>`(select count(*)::int from ${diningOrderItems} where ${diningOrderItems.tenantId} = ${tenantId} and ${diningOrderItems.orderId} = ${diningOrders.id} and ${diningOrderItems.status} = 'pending')`,
      })
      .from(diningOrders)
      .leftJoin(diningTables, eq(diningTables.id, diningOrders.tableId))
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.status, "open")))
      .orderBy(asc(diningOrders.createdAt));
    return rows.map((r) => ({
      ...r.order,
      tableName: r.tableName,
      amount: Math.round(toNum(r.amount)),
      activeKots: r.activeKots,
      readyKots: r.readyKots,
      pendingCount: r.pending,
    }));
  }

  async listOrders(tenantId: string, query: unknown = {}) {
    const q = ordersQuery.parse(query);
    if (q.status === "open") {
      const items = (await this.openOrders(tenantId)).filter((o) => !q.type || o.type === q.type);
      return { items, total: items.length };
    }
    const rows = await this.db
      .select({ order: diningOrders, tableName: diningTables.name })
      .from(diningOrders)
      .leftJoin(diningTables, eq(diningTables.id, diningOrders.tableId))
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.status, q.status), q.type ? eq(diningOrders.type, q.type) : undefined))
      .orderBy(desc(diningOrders.createdAt))
      .limit(q.limit);
    const items = rows.map((r) => ({ ...r.order, tableName: r.tableName }));
    return { items, total: items.length };
  }

  // ---------------------------------------------------------------- menu (kitchen settings)

  async menuItems(tenantId: string, itemIds?: string[]): Promise<DiningMenuItemRow[]> {
    if (itemIds && itemIds.length === 0) return [];
    return this.db
      .select()
      .from(diningMenuItems)
      .where(and(eq(diningMenuItems.tenantId, tenantId), itemIds ? inArray(diningMenuItems.itemId, itemIds.slice(0, 1000)) : undefined));
  }

  async saveMenuItem(tenantId: string, itemId: string, input: unknown): Promise<DiningMenuItemRow> {
    const b = menuItemInput.parse(input);
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    const [row] = await this.db
      .insert(diningMenuItems)
      .values({ tenantId, itemId, ...set })
      .onConflictDoUpdate({ target: [diningMenuItems.tenantId, diningMenuItems.itemId], set: { ...set, updatedAt: new Date() } })
      .returning();
    return row!;
  }

  /** The guests' QR menu: every active item with its veg mark and whether it's sold out today. */
  async publicMenu(tenantId: string) {
    const [items, settings] = await Promise.all([this.deps.menu?.list?.(tenantId) ?? Promise.resolve([]), this.menuItems(tenantId)]);
    const flags = new Map(settings.map((s) => [s.itemId, s]));
    return items.map((i) => ({ ...i, veg: flags.get(i.id)?.veg ?? null, available: flags.get(i.id)?.available ?? true }));
  }

  /** Stations in use (always includes "kitchen"). */
  async stations(tenantId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ station: diningMenuItems.station })
      .from(diningMenuItems)
      .where(eq(diningMenuItems.tenantId, tenantId));
    return [...new Set([DEFAULT_STATION, ...rows.map((r) => r.station)])].sort((a, b) => (a === DEFAULT_STATION ? -1 : b === DEFAULT_STATION ? 1 : a.localeCompare(b)));
  }

  // ---------------------------------------------------------------- orders

  private async lockDay(tx: Tx, tenantId: string, kind: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dining:${kind}:${tenantId}`}))`);
  }

  private async nextNumber(tx: Tx, tenantId: string, date: string, kind: "order" | "kot"): Promise<number> {
    await this.lockDay(tx, tenantId, kind);
    const t = kind === "order" ? diningOrders : diningKots;
    const [r] = await tx
      .select({ n: sql<number>`coalesce(max(${t.number}), 0)::int` })
      .from(t)
      .where(and(eq(t.tenantId, tenantId), eq(t.businessDate, date)));
    return (r?.n ?? 0) + 1;
  }

  private async orderRow(tenantId: string, id: string, tx: Db | Tx = this.db, lock = false): Promise<DiningOrderRow> {
    const q = tx
      .select()
      .from(diningOrders)
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Order");
    return row;
  }

  private assertOpen(o: DiningOrderRow) {
    if (o.status !== "open") throw new AppError(409, "order_closed", o.status === "billed" ? "This order is already billed" : "This order was cancelled");
  }

  /** Resolves input lines to priced lines with their station (items from the menu source, free text as given). */
  private async priceLines(tenantId: string, lines: z.output<typeof lineInput>[], opts: { allowSoldOut?: boolean } = {}) {
    const ids = [...new Set(lines.map((l) => l.itemId).filter((v): v is string => !!v))];
    const [items, settings] = await Promise.all([
      ids.length && this.deps.menu ? this.deps.menu.items(tenantId, ids) : Promise.resolve([]),
      this.menuItems(tenantId, ids),
    ]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const stationOf = new Map(settings.map((s) => [s.itemId, s]));
    return lines.map((l) => {
      const item = l.itemId ? byId.get(l.itemId) : undefined;
      if (l.itemId && !item && (!l.name || l.rate === undefined)) throw badRequest("Unknown item");
      const s = l.itemId ? stationOf.get(l.itemId) : undefined;
      if (s && !s.available && !opts.allowSoldOut) throw new AppError(409, "sold_out", `${item?.name ?? l.name} is sold out`);
      return {
        itemId: l.itemId ?? null,
        name: l.name ?? item!.name,
        qty: roundQty(l.qty),
        rate: l.rate ?? item!.rate,
        gstRate: l.gstRate ?? item?.gstRate ?? 5,
        hsn: item?.hsn ?? null,
        unit: item?.unit ?? null,
        note: l.note ?? null,
        station: s?.station ?? DEFAULT_STATION,
      };
    });
  }

  /** Opens an order. A dine-in table can have one open order: 409 `table_busy` (with its id) otherwise. */
  async open(
    tenantId: string,
    input: unknown,
    userId: string | null,
    source: DiningOrderSource = "staff",
    externalRef: string | null = null,
    extra: ExternalExtra = {},
  ): Promise<OrderView> {
    const b = openInput.parse(input);
    if (b.tableId) {
      const t = await this.table(tenantId, b.tableId);
      if (!t.active) throw badRequest("This table is switched off");
    }
    const priced = b.items?.length ? await this.priceLines(tenantId, b.items.map((l) => lineInput.parse(l)), { allowSoldOut: extra.allowSoldOut }) : [];
    const date = this.today();
    const id = await this.db.transaction(async (tx) => {
      if (b.tableId) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dining:table:${b.tableId}`}))`);
        const [busy] = await tx
          .select({ id: diningOrders.id })
          .from(diningOrders)
          .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.tableId, b.tableId), eq(diningOrders.status, "open")))
          .limit(1);
        if (busy) throw new AppError(409, "table_busy", "This table already has an open order", { orderId: busy.id });
      }
      const number = await this.nextNumber(tx, tenantId, date, "order");
      const [o] = await tx
        .insert(diningOrders)
        .values({
          tenantId,
          number,
          businessDate: date,
          type: b.type,
          source,
          tableId: b.tableId ?? null,
          guests: b.guests ?? null,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          note: b.note,
          externalRef,
          platform: extra.platform ?? null,
          dueAt: extra.dueAt ?? null,
          taxByOperator: extra.taxByOperator ?? false,
          openedBy: userId,
        })
        .returning();
      if (priced.length) await tx.insert(diningOrderItems).values(priced.map((l) => ({ tenantId, orderId: o!.id, ...l, qty: String(l.qty) })));
      if (b.sendKot && priced.length) await this.sendKotTx(tx, tenantId, o!.id, userId);
      return o!.id;
    });
    this.changed(tenantId, "order", id);
    return this.get(tenantId, id);
  }

  async get(tenantId: string, id: string): Promise<OrderView> {
    const o = await this.orderRow(tenantId, id);
    const [items, kots, table] = await Promise.all([
      this.db
        .select()
        .from(diningOrderItems)
        .where(and(eq(diningOrderItems.tenantId, tenantId), eq(diningOrderItems.orderId, id)))
        .orderBy(asc(diningOrderItems.createdAt), asc(diningOrderItems.id)),
      this.db
        .select()
        .from(diningKots)
        .where(and(eq(diningKots.tenantId, tenantId), eq(diningKots.orderId, id)))
        .orderBy(asc(diningKots.number)),
      o.tableId ? this.table(tenantId, o.tableId).catch(() => null) : Promise.resolve(null),
    ]);
    const lines: OrderLine[] = items.map((i) => {
      const q = toNum(i.qty);
      return { ...i, qty: q, amount: i.status === "cancelled" ? 0 : Math.round(q * i.rate) };
    });
    return {
      ...o,
      tableName: table?.name ?? null,
      items: lines,
      kots,
      amount: orderAmount(lines.filter((l) => l.status !== "cancelled")),
      pendingCount: lines.filter((l) => l.status === "pending").length,
    };
  }

  /** Guests, note, customer, or a move to another (free) table. */
  async update(tenantId: string, id: string, input: unknown): Promise<OrderView> {
    const b = orderPatch.parse(input);
    await this.db.transaction(async (tx) => {
      const o = await this.orderRow(tenantId, id, tx, true);
      this.assertOpen(o);
      if (b.tableId && b.tableId !== o.tableId) {
        const t = await this.table(tenantId, b.tableId, tx);
        if (!t.active) throw badRequest("This table is switched off");
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dining:table:${b.tableId}`}))`);
        const [busy] = await tx
          .select({ id: diningOrders.id })
          .from(diningOrders)
          .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.tableId, b.tableId), eq(diningOrders.status, "open"), ne(diningOrders.id, id)))
          .limit(1);
        if (busy) throw new AppError(409, "table_busy", "That table already has an open order", { orderId: busy.id });
      }
      const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
      if (set.tableId === null && o.type === "dine_in") delete set.tableId;
      await tx
        .update(diningOrders)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(diningOrders.id, id));
    });
    this.changed(tenantId, "order", id);
    return this.get(tenantId, id);
  }

  async addItems(tenantId: string, id: string, input: unknown, opts: { sendKot?: boolean; userId?: string | null } = {}): Promise<OrderView> {
    const lines = z.array(lineInput).min(1).max(200).parse(input);
    const priced = await this.priceLines(tenantId, lines);
    await this.db.transaction(async (tx) => {
      const o = await this.orderRow(tenantId, id, tx, true);
      this.assertOpen(o);
      await tx.insert(diningOrderItems).values(priced.map((l) => ({ tenantId, orderId: id, ...l, qty: String(l.qty) })));
      if (opts.sendKot) await this.sendKotTx(tx, tenantId, id, opts.userId ?? null);
    });
    this.changed(tenantId, "order", id);
    return this.get(tenantId, id);
  }

  private async lineRow(tx: Db | Tx, tenantId: string, orderId: string, lineId: string): Promise<DiningOrderItemRow> {
    const [row] = await tx
      .select()
      .from(diningOrderItems)
      .where(and(eq(diningOrderItems.tenantId, tenantId), eq(diningOrderItems.orderId, orderId), eq(diningOrderItems.id, lineId)))
      .limit(1);
    if (!row) throw notFound("Order line");
    return row;
  }

  /** Quantity or note of a line not sent to the kitchen yet. */
  async updateLine(tenantId: string, orderId: string, lineId: string, input: unknown): Promise<OrderView> {
    const b = linePatch.parse(input);
    await this.db.transaction(async (tx) => {
      this.assertOpen(await this.orderRow(tenantId, orderId, tx, true));
      const line = await this.lineRow(tx, tenantId, orderId, lineId);
      if (line.status !== "pending") throw new AppError(409, "line_sent", "Sent to the kitchen: cancel it and add a new line instead");
      await tx
        .update(diningOrderItems)
        .set({ ...(b.qty !== undefined ? { qty: String(roundQty(b.qty)) } : {}), ...(b.note !== undefined ? { note: b.note } : {}), updatedAt: new Date() })
        .where(eq(diningOrderItems.id, lineId));
    });
    return this.get(tenantId, orderId);
  }

  /**
   * Removes a line. Not sent yet: deleted. Sent (only with `allowSent`): cancelled with a reason and its KOT is marked
   * with a void so the kitchen sees it.
   */
  async removeLine(tenantId: string, orderId: string, lineId: string, input: unknown = {}, opts: { allowSent?: boolean } = {}): Promise<OrderView> {
    let kotId: string | null = null;
    await this.db.transaction(async (tx) => {
      this.assertOpen(await this.orderRow(tenantId, orderId, tx, true));
      const line = await this.lineRow(tx, tenantId, orderId, lineId);
      if (line.status === "cancelled") return;
      if (line.status === "pending") {
        await tx.delete(diningOrderItems).where(eq(diningOrderItems.id, lineId));
        return;
      }
      if (!opts.allowSent) throw new AppError(409, "line_sent", "Already sent to the kitchen: cancel it with a reason");
      const { reason } = cancelInput.parse(input);
      await tx.update(diningOrderItems).set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() }).where(eq(diningOrderItems.id, lineId));
      if (line.kotId) {
        kotId = line.kotId;
        const [left] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(diningOrderItems)
          .where(and(eq(diningOrderItems.tenantId, tenantId), eq(diningOrderItems.kotId, line.kotId), ne(diningOrderItems.status, "cancelled")));
        await tx
          .update(diningKots)
          .set({ hasVoids: true, ...((left?.n ?? 0) === 0 ? { status: "cancelled" as const } : {}), updatedAt: new Date() })
          .where(eq(diningKots.id, line.kotId));
      }
    });
    if (kotId) this.changed(tenantId, "kot", kotId);
    return this.get(tenantId, orderId);
  }

  private async sendKotTx(tx: Tx, tenantId: string, orderId: string, userId: string | null): Promise<DiningKotRow[]> {
    const pending = await tx
      .select()
      .from(diningOrderItems)
      .where(and(eq(diningOrderItems.tenantId, tenantId), eq(diningOrderItems.orderId, orderId), eq(diningOrderItems.status, "pending")))
      .orderBy(asc(diningOrderItems.createdAt), asc(diningOrderItems.id));
    if (pending.length === 0) return [];
    const date = this.today();
    const kots: DiningKotRow[] = [];
    for (const [station, lines] of groupByStation(pending)) {
      const number = await this.nextNumber(tx, tenantId, date, "kot");
      const [kot] = await tx.insert(diningKots).values({ tenantId, orderId, number, businessDate: date, station, createdBy: userId }).returning();
      await tx
        .update(diningOrderItems)
        .set({ status: "sent", kotId: kot!.id, updatedAt: new Date() })
        .where(inArray(diningOrderItems.id, lines.map((l) => l.id)));
      kots.push(kot!);
    }
    return kots;
  }

  /** Sends every line not sent yet to the kitchen: one KOT per station. Returns the new KOTs (nothing to send = []). */
  async sendKot(tenantId: string, orderId: string, userId: string | null = null): Promise<{ kots: DiningKotRow[]; order: OrderView }> {
    const kots = await this.db.transaction(async (tx) => {
      this.assertOpen(await this.orderRow(tenantId, orderId, tx, true));
      return this.sendKotTx(tx, tenantId, orderId, userId);
    });
    for (const k of kots) this.changed(tenantId, "kot", k.id);
    return { kots, order: await this.get(tenantId, orderId) };
  }

  /** Moves another open order's lines and tickets onto this one (joined tables) and cancels it. */
  async merge(tenantId: string, targetId: string, sourceId: string): Promise<OrderView> {
    if (targetId === sourceId) throw badRequest("Pick another order");
    await this.db.transaction(async (tx) => {
      const [a, b] = targetId < sourceId ? [targetId, sourceId] : [sourceId, targetId];
      const first = await this.orderRow(tenantId, a, tx, true);
      const second = await this.orderRow(tenantId, b, tx, true);
      this.assertOpen(first);
      this.assertOpen(second);
      await tx.update(diningOrderItems).set({ orderId: targetId }).where(and(eq(diningOrderItems.tenantId, tenantId), eq(diningOrderItems.orderId, sourceId)));
      await tx.update(diningKots).set({ orderId: targetId }).where(and(eq(diningKots.tenantId, tenantId), eq(diningKots.orderId, sourceId)));
      const src = first.id === sourceId ? first : second;
      const tgt = first.id === targetId ? first : second;
      await tx
        .update(diningOrders)
        .set({ guests: (tgt.guests ?? 0) + (src.guests ?? 0) || null, updatedAt: new Date() })
        .where(eq(diningOrders.id, targetId));
      await tx
        .update(diningOrders)
        .set({ status: "cancelled", note: `Merged into #${tgt.number}`, closedAt: this.now(), updatedAt: new Date() })
        .where(eq(diningOrders.id, sourceId));
    });
    this.changed(tenantId, "order", targetId);
    return this.get(tenantId, targetId);
  }

  /** Cancels an order that has no bill: its lines and kitchen tickets are cancelled too. */
  async cancel(tenantId: string, id: string, input: unknown): Promise<OrderView> {
    const { reason } = cancelInput.parse(input);
    await this.db.transaction(async (tx) => {
      const o = await this.orderRow(tenantId, id, tx, true);
      this.assertOpen(o);
      await tx
        .update(diningOrderItems)
        .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() })
        .where(and(eq(diningOrderItems.tenantId, tenantId), eq(diningOrderItems.orderId, id), ne(diningOrderItems.status, "cancelled")));
      await tx
        .update(diningKots)
        .set({ status: "cancelled", hasVoids: true, updatedAt: new Date() })
        .where(and(eq(diningKots.tenantId, tenantId), eq(diningKots.orderId, id), inArray(diningKots.status, [...ACTIVE_KOT_STATUSES])));
      await tx
        .update(diningOrders)
        .set({ status: "cancelled", note: o.note ? `${o.note} · ${reason}` : reason, closedAt: this.now(), updatedAt: new Date() })
        .where(eq(diningOrders.id, id));
    });
    this.changed(tenantId, "order", id);
    return this.get(tenantId, id);
  }

  /**
   * Bills the order: lines not sent yet go to the kitchen first, then one GST bill per split (identical items merged),
   * issued through invoices. The order closes and its table frees up. Payment is taken on the bill(s).
   */
  async bill(tenant: TenantRef, id: string, input: unknown, opts: { branchId?: string | null; userId?: string | null } = {}): Promise<{ order: OrderView; bills: BillResult[] }> {
    const b = billInput.parse(input);
    if (!this.deps.billing) throw new AppError(501, "billing_unavailable", "Billing is not available");
    const tenantId = tenant.id;
    // Claim the order first so two devices can't bill it twice; bills are made after the claim commits.
    const claimed = await this.db.transaction(async (tx) => {
      const o = await this.orderRow(tenantId, id, tx, true);
      this.assertOpen(o);
      if (o.taxByOperator) {
        throw new AppError(409, "tax_by_operator", "GST on this order is paid by the delivery platform (section 9(5)): settle it from Online orders, no tax bill is made");
      }
      await this.sendKotTx(tx, tenantId, id, opts.userId ?? null);
      const lines = await tx
        .select()
        .from(diningOrderItems)
        .where(and(eq(diningOrderItems.tenantId, tenantId), eq(diningOrderItems.orderId, id), ne(diningOrderItems.status, "cancelled")))
        .orderBy(asc(diningOrderItems.createdAt), asc(diningOrderItems.id));
      if (lines.length === 0) throw badRequest("Nothing to bill: add items first");
      const split = splitLines(lines, b.splits ?? []);
      if (split.error) throw badRequest(split.error === "unknown_line" ? "A split has a line that isn't on this order" : "A line is in two bills");
      const [row] = await tx
        .update(diningOrders)
        .set({ status: "billed", closedAt: this.now(), updatedAt: new Date() })
        .where(and(eq(diningOrders.id, id), eq(diningOrders.status, "open")))
        .returning();
      if (!row) throw conflict("This order is already being billed");
      return { order: o, bills: split.bills };
    });
    const customer = b.customer ?? (claimed.order.customerName ? { name: claimed.order.customerName, phone: claimed.order.customerPhone } : null);
    const results: BillResult[] = [];
    try {
      for (const lines of claimed.bills) {
        const merged = mergeLines(lines.map((l) => ({ ...l, qty: toNum(l.qty) })));
        const where = claimed.order.tableId ? (await this.table(tenantId, claimed.order.tableId).catch(() => null))?.name : null;
        const r = await this.deps.billing.createBill(
          tenant,
          {
            lines: merged.map((l) => ({
              description: l.note ? `${l.name} (${l.note})` : l.name,
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              gstRate: l.gstRate,
              hsn: l.hsn,
              unit: l.unit,
            })),
            customer,
            notes: `Order #${claimed.order.number}${where ? ` · Table ${where}` : ""}`,
            tillSessionId: b.tillSessionId ?? null,
          },
          { branchId: opts.branchId ?? null },
        );
        results.push(r);
      }
    } catch (err) {
      // Re-open with the bills made so far recorded, so staff can retry the rest.
      await this.db
        .update(diningOrders)
        .set({ status: results.length ? "billed" : "open", invoiceIds: results.map((r) => r.id), closedAt: results.length ? this.now() : null, updatedAt: new Date() })
        .where(eq(diningOrders.id, id));
      this.log.error({ err, tenantId, orderId: id, made: results.length }, "dining: billing failed");
      throw err;
    }
    await this.db
      .update(diningOrders)
      .set({ invoiceIds: results.map((r) => r.id), updatedAt: new Date() })
      .where(eq(diningOrders.id, id));
    this.changed(tenantId, "order", id);
    return { order: await this.get(tenantId, id), bills: results };
  }

  // ---------------------------------------------------------------- kitchen

  /** Tickets for the kitchen display: active ones (oldest first), plus recently served when `recent` > 0. */
  async kitchen(tenantId: string, query: unknown = {}): Promise<{ tickets: KitchenTicket[]; stations: string[]; now: Date }> {
    const q = kitchenQuery.parse(query);
    const since = new Date(this.now().getTime() - q.recent * 60_000);
    const rows = await this.db
      .select({ kot: diningKots, order: diningOrders, tableName: diningTables.name })
      .from(diningKots)
      .innerJoin(diningOrders, eq(diningOrders.id, diningKots.orderId))
      .leftJoin(diningTables, eq(diningTables.id, diningOrders.tableId))
      .where(
        and(
          eq(diningKots.tenantId, tenantId),
          q.station.length ? inArray(diningKots.station, q.station) : undefined,
          q.recent > 0
            ? sql`(${diningKots.status} in ('new', 'preparing', 'ready') or (${diningKots.status} = 'served' and ${diningKots.servedAt} >= ${since.toISOString()}))`
            : inArray(diningKots.status, [...ACTIVE_KOT_STATUSES]),
        ),
      )
      .orderBy(asc(diningKots.createdAt))
      .limit(300);
    const kotIds = rows.map((r) => r.kot.id);
    const items = kotIds.length
      ? await this.db
          .select()
          .from(diningOrderItems)
          .where(and(eq(diningOrderItems.tenantId, tenantId), inArray(diningOrderItems.kotId, kotIds)))
          .orderBy(asc(diningOrderItems.createdAt), asc(diningOrderItems.id))
      : [];
    const byKot = new Map<string, KitchenTicket["items"]>();
    for (const i of items) {
      const list = byKot.get(i.kotId!) ?? [];
      list.push({ id: i.id, name: i.name, qty: toNum(i.qty), note: i.note, status: i.status, cancelReason: i.cancelReason });
      byKot.set(i.kotId!, list);
    }
    return {
      now: this.now(),
      stations: await this.stations(tenantId),
      tickets: rows.map((r) => ({
        ...r.kot,
        orderNumber: r.order.number,
        orderType: r.order.type,
        orderSource: r.order.source,
        platform: r.order.platform,
        dueAt: r.order.dueAt,
        tableName: r.tableName,
        customerName: r.order.customerName,
        orderNote: r.order.note,
        items: byKot.get(r.kot.id) ?? [],
      })),
    };
  }

  /** Kitchen bump: new → preparing → ready → served (one step back allowed). */
  async moveKot(tenantId: string, kotId: string, input: unknown): Promise<DiningKotRow> {
    const { status } = kotMove.parse(input);
    const row = await this.db.transaction(async (tx) => {
      const [kot] = await tx
        .select()
        .from(diningKots)
        .where(and(eq(diningKots.tenantId, tenantId), eq(diningKots.id, kotId)))
        .limit(1)
        .for("update");
      if (!kot) throw notFound("Ticket");
      if (!canMoveKot(kot.status, status)) throw new AppError(409, "kot_move", `A ${kot.status} ticket can't go to ${status}`);
      if (kot.status === status) return kot;
      const now = this.now();
      const stamp: Partial<Record<"startedAt" | "readyAt" | "servedAt", Date | null>> =
        status === "preparing" ? { startedAt: kot.startedAt ?? now, readyAt: null } : status === "ready" ? { readyAt: now, servedAt: null } : status === "served" ? { servedAt: now } : {};
      const [updated] = await tx
        .update(diningKots)
        .set({ status: status as KotStatus, ...stamp, updatedAt: new Date() })
        .where(eq(diningKots.id, kotId))
        .returning();
      return updated!;
    });
    this.changed(tenantId, "kot", kotId);
    return row;
  }

  // ---------------------------------------------------------------- QR & online

  /** The table behind a QR token (active tables of shops with QR ordering). */
  async tableByToken(token: string): Promise<DiningTableRow | null> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;
    const [row] = await this.db
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.qrToken, token), eq(diningTables.active, true)))
      .limit(1);
    return row ?? null;
  }

  /**
   * A guest's order from the table's QR menu: added to the table's open order (opened if none) and sent to the
   * kitchen straight away. Rates always come from the menu, never from the guest.
   */
  async placeFromQr(token: string, input: unknown): Promise<{ tenantId: string; order: OrderView; kots: DiningKotRow[] }> {
    const table = await this.tableByToken(token);
    if (!table) throw notFound("Table");
    const body = z
      .object({ items: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().min(1).max(50), note: optText(200) }).strict()).min(1).max(50), name: optText(60) })
      .strict()
      .parse(input);
    const tenantId = table.tenantId;
    const lines = body.items.map((i) => ({ itemId: i.itemId, qty: i.qty, note: i.note }));
    const [existing] = await this.db
      .select({ id: diningOrders.id })
      .from(diningOrders)
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.tableId, table.id), eq(diningOrders.status, "open")))
      .limit(1);
    let orderId: string;
    if (existing) {
      orderId = existing.id;
      await this.addItems(tenantId, orderId, lines);
    } else {
      try {
        orderId = (await this.open(tenantId, { type: "dine_in", tableId: table.id, customerName: body.name, items: lines }, null, "qr")).id;
      } catch (err) {
        // Another guest at the same table opened it a moment ago.
        if (!(err instanceof AppError && err.code === "table_busy")) throw err;
        orderId = (err.details as { orderId: string }).orderId;
        await this.addItems(tenantId, orderId, lines);
      }
    }
    const { kots, order } = await this.sendKot(tenantId, orderId, null);
    return { tenantId, order, kots };
  }

  /**
   * An online store order reaching the kitchen: one dining order per store order (`externalRef`), sent to the kitchen
   * at once. Idempotent; never throws (logged).
   */
  async fromOnlineOrder(
    tenantId: string,
    e: { ref: string; number: string | null; customerName: string | null; customerPhone: string | null; delivery: boolean; lines: { itemId: string | null; name: string; qty: number; rate: number; gstRate: number }[] },
  ): Promise<void> {
    try {
      const [done] = await this.db
        .select({ id: diningOrders.id })
        .from(diningOrders)
        .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.externalRef, e.ref)))
        .limit(1);
      if (done || e.lines.length === 0) return;
      await this.open(
        tenantId,
        {
          type: e.delivery ? "delivery" : "takeaway",
          customerName: e.customerName,
          customerPhone: e.customerPhone,
          note: e.number ? `Online order ${e.number}` : "Online order",
          items: e.lines.map((l) => ({ itemId: l.itemId, name: l.name, rate: l.rate, gstRate: l.gstRate, qty: l.qty })),
          sendKot: true,
        },
        null,
        "online",
        e.ref,
      );
    } catch (err) {
      this.log.error({ err, tenantId, ref: e.ref }, "dining: online order to kitchen failed");
    }
  }

  /** Closes the dining order of a store order that was cancelled (its tickets are cancelled too). */
  async onlineOrderCancelled(tenantId: string, ref: string): Promise<void> {
    try {
      const [o] = await this.db
        .select({ id: diningOrders.id })
        .from(diningOrders)
        .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.externalRef, ref), eq(diningOrders.status, "open")))
        .limit(1);
      if (o) await this.cancel(tenantId, o.id, { reason: "Online order cancelled" });
    } catch (err) {
      this.log.error({ err, tenantId, ref }, "dining: online cancel failed");
    }
  }

  /** Marks the dining order of a store order done once the store order is billed/fulfilled elsewhere. */
  async onlineOrderClosed(tenantId: string, ref: string): Promise<void> {
    await this.db
      .update(diningOrders)
      .set({ status: "billed", closedAt: this.now(), updatedAt: new Date() })
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.externalRef, ref), eq(diningOrders.status, "open"), isNull(diningOrders.tableId)));
  }

  // ---------------------------------------------------------------- delivery platforms (aggregators)

  /**
   * A delivery-platform order (Zomato / Swiggy through an aggregator): one dining order per `ref`, idempotent (the
   * existing order is returned). Lines wait as "pending" until `send` (accepted), so a rejected order never reaches
   * the kitchen.
   */
  async openExternal(tenantId: string, e: ExternalOrderInput): Promise<OrderView> {
    const [done] = await this.db
      .select({ id: diningOrders.id })
      .from(diningOrders)
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.externalRef, e.ref)))
      .limit(1);
    if (done) return this.get(tenantId, done.id);
    const clip = (v: string | null, n: number) => (v ? v.slice(0, n) : null);
    return this.open(
      tenantId,
      {
        type: e.type,
        customerName: clip(e.customerName, 120),
        customerPhone: clip(e.customerPhone, 20),
        note: clip(e.note, 500),
        items: e.lines.map((l) => ({
          itemId: l.itemId,
          name: l.name.slice(0, 200) || "Item",
          rate: Math.max(0, Math.round(l.rate)),
          ...(l.gstRate !== undefined ? { gstRate: l.gstRate } : {}),
          qty: l.qty,
          note: clip(l.note, 200),
        })),
        sendKot: e.send,
      },
      null,
      "aggregator",
      e.ref,
      { platform: e.platform, dueAt: e.dueAt, taxByOperator: e.taxByOperator, allowSoldOut: true },
    );
  }

  /** The time the order must be ready by (accepting with a prep time moves it). */
  async setDue(tenantId: string, id: string, dueAt: Date | null): Promise<void> {
    await this.db
      .update(diningOrders)
      .set({ dueAt, updatedAt: new Date() })
      .where(and(eq(diningOrders.tenantId, tenantId), eq(diningOrders.id, id)));
    this.changed(tenantId, "order", id);
  }

  /**
   * Closes an open order without a bill: for delivery-platform orders whose GST the platform pays (section 9(5)),
   * the shop issues no tax invoice. Unsent lines go to the kitchen first so nothing is lost.
   */
  async settleWithoutBill(tenantId: string, id: string): Promise<OrderView> {
    await this.db.transaction(async (tx) => {
      const o = await this.orderRow(tenantId, id, tx, true);
      if (o.status !== "open") return;
      await this.sendKotTx(tx, tenantId, id, null);
      await tx.update(diningOrders).set({ status: "billed", closedAt: this.now(), updatedAt: new Date() }).where(eq(diningOrders.id, id));
    });
    this.changed(tenantId, "order", id);
    return this.get(tenantId, id);
  }

  /** The order of a kitchen ticket (null when unknown). */
  async orderOfKot(tenantId: string, kotId: string): Promise<string | null> {
    const [k] = await this.db
      .select({ orderId: diningKots.orderId })
      .from(diningKots)
      .where(and(eq(diningKots.tenantId, tenantId), eq(diningKots.id, kotId)))
      .limit(1);
    return k?.orderId ?? null;
  }
}
