/**
 * Stock transfers between locations (branches, shops, warehouses) with an in-transit step.
 *
 *   draft -> send -> in_transit -> receive -> partially_received -> closed        (cancel while nothing is received)
 *
 * Sending takes the goods out of the source (movement `transfer_out`, batches first-expiry-first-out or as chosen). They
 * are then "in transit": in no location, not sellable, valued at the source cost on the in-transit report. Receiving adds
 * the good quantity to the destination (movement `transfer_in`, same batches); damaged and short quantities are written
 * off on the note with a reason. The old instant transfer (`POST /v1/inventory/transfers`) is `instant()` here: send and
 * receive in one step, so existing screens, tests and integrations keep working.
 */
import { AppError, badRequest, conflict, notFound } from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { todayIST } from "@rbms/gst";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { lineInTransit, transferStatusAfter } from "./batch-logic";
import { checkAvailability, transferProblem } from "./levels";
import { fromMilli, mergeQtyLines, toMilli } from "./logic";
import { noopLogger, type LoggerPort, type TransferNoticePort } from "./ports";
import { stockItems, stockLocations, stockTransfers, type StockTransferRow, type TransferBatchPart, type TransferLine, type TransferStatus } from "./schema";
import { insufficientStock, toTransfer, type InventoryDeps, type InventoryService, type StockTransfer } from "./service";

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());
const uuid = z.string().uuid();
const qtyNum = z.coerce.number().positive("Quantity must be more than 0").max(1_000_000_000);
const nonNeg = z.coerce.number().min(0).max(1_000_000_000);

export const transferNoteInputSchema = z.object({
  fromLocationId: uuid,
  toLocationId: uuid,
  lines: z
    .array(
      z.object({
        itemId: uuid,
        qty: qtyNum,
        /** Take from this batch first (batch-tracked items); without it the oldest expiry goes first. */
        batchId: opt(uuid),
      }),
    )
    .min(1, "Add at least one line")
    .max(500),
  note: opt(z.string().trim().max(500)),
  transport: opt(z.string().trim().max(200)),
  /** Send straight away instead of saving a draft. */
  send: z.boolean().optional(),
});
export type TransferNoteInput = z.input<typeof transferNoteInputSchema>;

export const transferDraftPatchSchema = z.object({
  toLocationId: uuid.optional(),
  lines: transferNoteInputSchema.shape.lines.optional(),
  note: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(500).nullable().optional()),
  transport: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(200).nullable().optional()),
});
export type TransferDraftPatch = z.input<typeof transferDraftPatchSchema>;

export const RECEIVE_REASONS = ["short", "damaged", "wrong_item", "lost", "other"] as const;

const receiveLineSchema = z.object({
  itemId: uuid,
  /** Good quantity that arrived. */
  received: nonNeg.default(0),
  damaged: nonNeg.optional(),
  short: nonNeg.optional(),
  reason: opt(z.string().trim().max(200)),
  /** Per-batch split (batch-tracked lines); without it the line's numbers fill the batches in order. */
  batches: z
    .array(z.object({ batchId: uuid, received: nonNeg.default(0), damaged: nonNeg.optional(), short: nonNeg.optional() }))
    .max(50)
    .optional(),
});

export const transferReceiveSchema = z.object({
  lines: z.array(receiveLineSchema).max(500).default([]),
  /** Receive everything that is still on the way, in full. */
  all: z.boolean().optional(),
  /** Write the rest off as short and close the note. */
  closeShort: z.boolean().optional(),
  note: opt(z.string().trim().max(500)),
});
export type TransferReceiveInput = z.input<typeof transferReceiveSchema>;

export const transferListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(z.enum(["draft", "in_transit", "partially_received", "closed", "cancelled"])).optional()),
  /** Notes sent from or to this location. */
  locationId: opt(uuid),
  direction: z.enum(["in", "out"]).optional(),
  q: opt(z.string().trim().max(100)),
});
export type TransferListQ = z.input<typeof transferListSchema>;

export interface InTransitRow {
  transferId: string;
  number: string | null;
  status: TransferStatus;
  fromLocationId: string;
  toLocationId: string;
  sentAt: Date | null;
  itemId: string;
  itemName: string;
  unit: string;
  qty: number;
  /** Value at the cost when it was sent, paise. */
  value: number;
  batches: { batchNo: string; expiry: string | null; qty: number }[];
  /** Days since it was sent. */
  days: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class TransferService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly notice: TransferNoticePort | null;

  constructor(
    private readonly inv: InventoryService,
    deps: InventoryDeps,
  ) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.notice = deps.transferNotice ?? null;
  }

  today() {
    return todayIST(this.now());
  }

  // ================================================================ reads

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<StockTransferRow> {
    const q = db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id)))
      .limit(1);
    const [row] = await (lock ? q.for("update") : q);
    if (!row) throw notFound("Transfer");
    return row;
  }

  async get(tenantId: string, id: string): Promise<StockTransfer & { fromName: string; toName: string; fromCode: string; toCode: string }> {
    const row = await this.row(this.db, tenantId, id);
    const locs = await this.db
      .select()
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, tenantId), inArray(stockLocations.id, [row.fromLocationId, row.toLocationId])));
    const by = new Map(locs.map((l) => [l.id, l]));
    const lines = await this.withNames(tenantId, row.lines);
    return {
      ...toTransfer({ ...row, lines }),
      fromName: by.get(row.fromLocationId)?.name ?? "",
      toName: by.get(row.toLocationId)?.name ?? "",
      fromCode: by.get(row.fromLocationId)?.code ?? "",
      toCode: by.get(row.toLocationId)?.code ?? "",
    };
  }

  /** Fills missing item names / units (old instant transfers store only ids). */
  private async withNames(tenantId: string, lines: TransferLine[]): Promise<TransferLine[]> {
    const missing = lines.filter((l) => !l.itemName).map((l) => l.itemId);
    if (missing.length === 0) return lines;
    const items = new Map((await this.inv.catalogItems(tenantId, [...new Set(missing)])).map((i) => [i.id, i]));
    return lines.map((l) => (l.itemName ? l : { ...l, itemName: items.get(l.itemId)?.name ?? "", unit: items.get(l.itemId)?.unit ?? "" }));
  }

  async list(tenantId: string, query: TransferListQ = {}) {
    const q = transferListSchema.parse(query);
    const loc = q.locationId;
    const where = and(
      eq(stockTransfers.tenantId, tenantId),
      q.status?.length ? inArray(stockTransfers.status, q.status) : undefined,
      loc
        ? q.direction === "in"
          ? eq(stockTransfers.toLocationId, loc)
          : q.direction === "out"
            ? eq(stockTransfers.fromLocationId, loc)
            : or(eq(stockTransfers.fromLocationId, loc), eq(stockTransfers.toLocationId, loc))
        : undefined,
      q.q ? sql`${stockTransfers.number} ilike ${`%${q.q.replace(/[%_\\]/g, "\\$&")}%`}` : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(stockTransfers).where(where).orderBy(desc(stockTransfers.createdAt), desc(stockTransfers.id)).limit(q.limit).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(stockTransfers).where(where),
    ]);
    return { items: rows.map(toTransfer), total: counted?.total ?? 0, limit: q.limit, offset: q.offset };
  }

  /** Everything still on the road, per transfer line, with the value at the cost it left at. */
  async inTransit(tenantId: string, opts: { toLocationId?: string; fromLocationId?: string } = {}): Promise<{ items: InTransitRow[]; totals: { transfers: number; lines: number; value: number } }> {
    const rows = await this.db
      .select()
      .from(stockTransfers)
      .where(
        and(
          eq(stockTransfers.tenantId, tenantId),
          inArray(stockTransfers.status, ["in_transit", "partially_received"]),
          opts.toLocationId ? eq(stockTransfers.toLocationId, opts.toLocationId) : undefined,
          opts.fromLocationId ? eq(stockTransfers.fromLocationId, opts.fromLocationId) : undefined,
        ),
      )
      .orderBy(asc(stockTransfers.sentAt));
    const lineItems = rows.flatMap((r) => r.lines);
    const names = new Map((await this.inv.catalogItems(tenantId, [...new Set(lineItems.map((l) => l.itemId))])).map((i) => [i.id, i]));
    const nowMs = this.now().getTime();
    const out: InTransitRow[] = [];
    for (const r of rows) {
      for (const l of r.lines) {
        const qty = lineInTransit(l);
        if (qty <= 0) continue;
        const batches = (l.batches ?? [])
          .map((b) => ({ batchNo: b.batchNo, expiry: b.expiry, qty: lineInTransit(b) }))
          .filter((b) => b.qty > 0);
        out.push({
          transferId: r.id,
          number: r.number,
          status: r.status,
          fromLocationId: r.fromLocationId,
          toLocationId: r.toLocationId,
          sentAt: r.sentAt,
          itemId: l.itemId,
          itemName: l.itemName ?? names.get(l.itemId)?.name ?? "",
          unit: l.unit ?? names.get(l.itemId)?.unit ?? "",
          qty,
          value: Math.round(qty * (l.unitCost ?? 0)),
          batches,
          days: r.sentAt ? Math.max(0, Math.floor((nowMs - r.sentAt.getTime()) / 86_400_000)) : 0,
        });
      }
    }
    return { items: out, totals: { transfers: rows.length, lines: out.length, value: out.reduce((a, r) => a + r.value, 0) } };
  }

  // ================================================================ create / edit / send

  private async validateEnds(tenantId: string, fromId: string, toId: string) {
    await this.inv.defaultLocationRow(tenantId);
    const [from, to] = await Promise.all([this.inv.locationRowPublic(this.db, tenantId, fromId), this.inv.locationRowPublic(this.db, tenantId, toId)]);
    const problem = transferProblem(fromId, toId, from, to);
    if (problem) throw problem.status === 404 ? new AppError(404, "not_found", problem.message) : badRequest(problem.message);
    return { from: from!, to: to! };
  }

  private async cleanLines(tenantId: string, lines: { itemId: string; qty: number; batchId?: string }[]) {
    const merged = mergeQtyLines(lines);
    if (merged.length === 0) throw badRequest("Add at least one line");
    const items = await this.inv.catalogItems(tenantId, merged.map((l) => l.itemId));
    const found = new Map(items.map((i) => [i.id, i]));
    const missing = merged.filter((l) => !found.has(l.itemId)).map((l) => l.itemId);
    if (missing.length > 0) throw badRequest("Some lines refer to items that no longer exist", { itemIds: missing });
    return merged.map((l) => {
      const it = found.get(l.itemId)!;
      const batchId = lines.find((x) => x.itemId === l.itemId && x.batchId)?.batchId;
      return { itemId: l.itemId, milli: l.milli, itemName: it.name, unit: it.unit, batchId };
    });
  }

  /** Makes a transfer note: a draft, or (with `send`) sent at once. */
  async create(tenantId: string, input: TransferNoteInput, userId: string | null = null): Promise<StockTransfer> {
    const b = transferNoteInputSchema.parse(input);
    await this.validateEnds(tenantId, b.fromLocationId, b.toLocationId);
    const lines = await this.cleanLines(tenantId, b.lines);
    const date = this.today();
    const row = await this.db.transaction(async (tx) => {
      const number = await this.inv.purchasing.nextNumber(tx, tenantId, "tr", date);
      const [created] = await tx
        .insert(stockTransfers)
        .values({
          tenantId,
          fromLocationId: b.fromLocationId,
          toLocationId: b.toLocationId,
          lines: lines.map((l) => ({ itemId: l.itemId, qty: fromMilli(l.milli), itemName: l.itemName, unit: l.unit, ...(l.batchId ? { batches: [{ batchId: l.batchId, batchNo: "", expiry: null, qty: 0 }] } : {}) })),
          note: b.note ?? null,
          transport: b.transport ?? null,
          createdBy: userId,
          createdAt: this.now(),
          number,
          status: "draft",
        })
        .returning();
      return created!;
    });
    if (b.send) return this.send(tenantId, row.id, userId);
    return toTransfer(row);
  }

  async updateDraft(tenantId: string, id: string, input: TransferDraftPatch): Promise<StockTransfer> {
    const b = transferDraftPatchSchema.parse(input);
    const cur = await this.row(this.db, tenantId, id);
    if (cur.status !== "draft") throw conflict("Only a draft can be edited");
    const to = b.toLocationId ?? cur.toLocationId;
    await this.validateEnds(tenantId, cur.fromLocationId, to);
    const set: Partial<typeof stockTransfers.$inferInsert> = { toLocationId: to };
    if (b.note !== undefined) set.note = b.note;
    if (b.transport !== undefined) set.transport = b.transport;
    if (b.lines) {
      const lines = await this.cleanLines(tenantId, b.lines);
      set.lines = lines.map((l) => ({ itemId: l.itemId, qty: fromMilli(l.milli), itemName: l.itemName, unit: l.unit, ...(l.batchId ? { batches: [{ batchId: l.batchId, batchNo: "", expiry: null, qty: 0 }] } : {}) }));
    }
    const [row] = await this.db
      .update(stockTransfers)
      .set(set)
      .where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id), eq(stockTransfers.status, "draft")))
      .returning();
    if (!row) throw conflict("This transfer changed meanwhile; reload and try again");
    return toTransfer(row);
  }

  async deleteDraft(tenantId: string, id: string): Promise<void> {
    const cur = await this.row(this.db, tenantId, id);
    if (cur.status !== "draft") throw conflict("Only a draft can be deleted; cancel a sent transfer instead");
    await this.db.delete(stockTransfers).where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id), eq(stockTransfers.status, "draft")));
  }

  /**
   * Takes the goods out of the source and puts the note in transit. 409 `insufficient_stock` when the source is short.
   * Batch-tracked items come out of the chosen batch, then first-expiry-first-out; the batches are recorded on the line.
   */
  async send(tenantId: string, id: string, userId: string | null = null, opts: { receiveNow?: boolean } = {}): Promise<StockTransfer> {
    const drops = this.inv.dropSinkPublic();
    const sentRow = await this.db.transaction(async (tx) => {
      const cur = await this.row(tx, tenantId, id, true);
      if (cur.status !== "draft") throw conflict(cur.status === "cancelled" ? "This transfer was cancelled" : "This transfer was already sent");
      await this.validateEnds(tenantId, cur.fromLocationId, cur.toLocationId);
      const ids = cur.lines.map((l) => l.itemId);
      const untracked = await this.inv.untrackedOf(tx, tenantId, ids);
      const locked = await this.inv.lockRowsPublic(tx, tenantId, [cur.fromLocationId, cur.toLocationId], ids);
      const source = new Map(
        locked
          .filter((r) => r.locationId === cur.fromLocationId)
          .map((r) => [r.itemId, { qtyMilli: toMilli(r.qty), reservedMilli: toMilli(r.reserved), avgCost: r.avgCost }]),
      );
      const lines = cur.lines.map((l) => ({ itemId: l.itemId, milli: toMilli(l.qty) }));
      const check = checkAvailability(lines, source, untracked);
      if (!check.ok) throw insufficientStock(check.items);
      const sentAt = this.now();
      const out: TransferLine[] = [];
      for (const l of cur.lines) {
        const milli = toMilli(l.qty);
        const cost = source.get(l.itemId)?.avgCost ?? null;
        const chosen = (l.batches ?? []).filter((b) => b.batchId).map((b) => ({ batchId: b.batchId, milli }));
        if (untracked.has(l.itemId)) {
          out.push({ ...l, unitCost: cost, batches: undefined });
          continue;
        }
        const moved = await this.inv.change(
          tx,
          {
            tenantId,
            locationId: cur.fromLocationId,
            itemId: l.itemId,
            deltaMilli: -milli,
            reason: "transfer_out",
            refType: "transfer",
            refId: cur.id,
            refNumber: cur.number,
            note: cur.note,
            createdBy: userId,
            batchPreferred: chosen,
          },
          drops,
        );
        const parts: TransferBatchPart[] = moved.batches.allocations.map((a) => ({ batchId: a.batchId, batchNo: a.batchNo, expiry: a.expiry, qty: fromMilli(a.milli) }));
        out.push({ ...l, unitCost: cost, ...(parts.length ? { batches: parts } : { batches: undefined }) });
      }
      const [row] = await tx
        .update(stockTransfers)
        .set({ lines: out, status: "in_transit", sentAt, sentBy: userId })
        .where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id)))
        .returning();
      return row!;
    });
    this.log.info({ tenantId, transferId: id, number: sentRow.number }, "inventory: transfer sent");
    await this.inv.emitLowStockPublic(tenantId, drops);
    if (!opts.receiveNow) await this.announce(tenantId, sentRow);
    return toTransfer(sentRow);
  }

  /** Tells the receiving side (webhook event and the notice port). Never throws. */
  private async announce(tenantId: string, row: StockTransferRow) {
    try {
      const locs = await this.db
        .select({ id: stockLocations.id, name: stockLocations.name })
        .from(stockLocations)
        .where(and(eq(stockLocations.tenantId, tenantId), inArray(stockLocations.id, [row.fromLocationId, row.toLocationId])));
      const name = (i: string) => locs.find((l) => l.id === i)?.name ?? "";
      const payload = {
        transferId: row.id,
        number: row.number ?? "",
        fromLocationId: row.fromLocationId,
        toLocationId: row.toLocationId,
        fromName: name(row.fromLocationId),
        toName: name(row.toLocationId),
        items: row.lines.length,
      };
      await this.inv.eventsPort()?.emit(tenantId, "stock.transfer_sent", payload);
      await this.notice?.sent(tenantId, payload);
    } catch (err) {
      this.log.warn({ err, tenantId, transferId: row.id }, "inventory: transfer notice failed");
    }
  }

  // ================================================================ receive

  /**
   * Receives goods at the destination: good quantity is added there (same batches), damaged and short quantities are
   * written off on the note. A line can be received in several steps. `all` receives everything still on the way;
   * `closeShort` writes the rest off as short and closes the note.
   */
  async receive(tenantId: string, id: string, input: TransferReceiveInput, userId: string | null = null): Promise<StockTransfer> {
    const b = transferReceiveSchema.parse(input);
    const row = await this.db.transaction(async (tx) => {
      const cur = await this.row(tx, tenantId, id, true);
      if (cur.status === "closed" || cur.status === "cancelled" || cur.status === "draft") {
        throw conflict(cur.status === "draft" ? "Send the transfer first" : `This transfer is already ${cur.status}`);
      }
      const lines: TransferLine[] = cur.lines.map((l) => ({ ...l, batches: l.batches?.map((p) => ({ ...p })) }));
      const asked = new Map(b.lines.map((l) => [l.itemId, l]));
      if (!b.all && !b.closeShort && b.lines.length === 0) throw badRequest("Enter what arrived");
      for (const a of b.lines) if (!lines.some((l) => l.itemId === a.itemId)) throw badRequest("A line is not on this transfer", { itemId: a.itemId });
      for (const l of lines) {
        const outstanding = toMilli(lineInTransit(l));
        if (outstanding <= 0) continue;
        const a = asked.get(l.itemId);
        const ex = a?.batches ?? [];
        const sumEx = (k: "received" | "damaged" | "short") => ex.reduce((t, x) => t + toMilli(x[k] ?? 0), 0);
        // Per-batch numbers (when given) are the line's numbers.
        let good = b.all ? outstanding : ex.length ? sumEx("received") : toMilli(a?.received ?? 0);
        let damaged = ex.length ? sumEx("damaged") : toMilli(a?.damaged ?? 0);
        let short = ex.length ? sumEx("short") : toMilli(a?.short ?? 0);
        if (b.all) {
          damaged = 0;
          short = 0;
        }
        if (good + damaged + short > outstanding) {
          throw badRequest(`More than what is still on the way for "${l.itemName ?? l.itemId}" (${fromMilli(outstanding)})`, { itemId: l.itemId, outstanding: fromMilli(outstanding) });
        }
        if (b.closeShort) short += outstanding - (good + damaged + short);
        if (good + damaged + short === 0) continue;
        // Split between the batches (explicit per batch, else in order).
        const parts = l.batches ?? [];
        const split = this.splitAcrossBatches(parts, { good, damaged, short }, a?.batches);
        const unitCost = l.unitCost ?? null;
        if (good > 0) {
          await this.inv.change(tx, {
            tenantId,
            locationId: cur.toLocationId,
            itemId: l.itemId,
            deltaMilli: good,
            reason: "transfer_in",
            refType: "transfer",
            refId: cur.id,
            refNumber: cur.number,
            unitCost,
            note: b.note ?? cur.note,
            createdBy: userId,
          });
          for (const s of split.parts) {
            if (s.good <= 0) continue;
            const part = parts.find((p) => p.batchId === s.batchId)!;
            await this.inv.batches.applyDelta(tx, tenantId, { id: part.batchId, itemId: l.itemId }, cur.toLocationId, s.good, "transfer_in", {
              refType: "transfer",
              refId: cur.id,
              refNumber: cur.number,
              userId,
            });
          }
        }
        l.received = round3((l.received ?? 0) + fromMilli(good));
        l.damaged = round3((l.damaged ?? 0) + fromMilli(damaged));
        l.short = round3((l.short ?? 0) + fromMilli(short));
        if (a?.reason) l.reason = a.reason;
        else if ((damaged > 0 || short > 0) && !l.reason) l.reason = damaged > 0 ? "damaged" : "short";
        for (const s of split.parts) {
          const part = parts.find((p) => p.batchId === s.batchId)!;
          part.received = round3((part.received ?? 0) + fromMilli(s.good));
          part.damaged = round3((part.damaged ?? 0) + fromMilli(s.damaged));
          part.short = round3((part.short ?? 0) + fromMilli(s.short));
        }
      }
      const status = transferStatusAfter(lines);
      const at = this.now();
      const [updated] = await tx
        .update(stockTransfers)
        .set({
          lines,
          status,
          receivedAt: at,
          receivedBy: userId,
          closedAt: status === "closed" ? at : null,
          receiveNote: b.note ?? cur.receiveNote,
        })
        .where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id)))
        .returning();
      return updated!;
    });
    this.log.info({ tenantId, transferId: id, status: row.status }, "inventory: transfer received");
    return toTransfer(row);
  }

  /** Spreads good / damaged / short milli over a line's batches (explicit per-batch numbers win, else in order). */
  private splitAcrossBatches(
    parts: readonly TransferBatchPart[],
    n: { good: number; damaged: number; short: number },
    explicit: { batchId: string; received: number; damaged?: number; short?: number }[] | undefined,
  ): { parts: { batchId: string; good: number; damaged: number; short: number }[] } {
    if (parts.length === 0) return { parts: [] };
    const room = new Map(parts.map((p) => [p.batchId, toMilli(lineInTransit(p))]));
    const out = new Map(parts.map((p) => [p.batchId, { batchId: p.batchId, good: 0, damaged: 0, short: 0 }]));
    const take = (key: "good" | "damaged" | "short", batchId: string, milli: number) => {
      const r = room.get(batchId) ?? 0;
      const m = Math.min(milli, r);
      out.get(batchId)![key] += m;
      room.set(batchId, r - m);
      return milli - m;
    };
    const left = { good: n.good, damaged: n.damaged, short: n.short };
    for (const e of explicit ?? []) {
      if (!out.has(e.batchId)) throw badRequest("A batch is not on this transfer", { batchId: e.batchId });
      left.good = take("good", e.batchId, toMilli(e.received)) + (left.good - toMilli(e.received));
      left.damaged = take("damaged", e.batchId, toMilli(e.damaged ?? 0)) + (left.damaged - toMilli(e.damaged ?? 0));
      left.short = take("short", e.batchId, toMilli(e.short ?? 0)) + (left.short - toMilli(e.short ?? 0));
    }
    for (const key of ["good", "damaged", "short"] as const) {
      let rest = left[key];
      for (const p of parts) {
        if (rest <= 0) break;
        rest = take(key, p.batchId, rest);
      }
    }
    return { parts: [...out.values()] };
  }

  /** Cancels a note that nothing was received from: the goods go back to the source (same batches). */
  async cancel(tenantId: string, id: string, reason: string | null, userId: string | null = null): Promise<StockTransfer> {
    const row = await this.db.transaction(async (tx) => {
      const cur = await this.row(tx, tenantId, id, true);
      if (cur.status === "cancelled") return cur;
      if (cur.status === "closed") throw conflict("A closed transfer can't be cancelled");
      if (cur.status === "partially_received") throw conflict("Part of this transfer was already received; receive or close the rest instead");
      if (cur.status === "in_transit") {
        for (const l of cur.lines) {
          const unit = l.unitCost ?? null;
          if (toMilli(l.qty) <= 0 || (await this.inv.untrackedOf(tx, tenantId, [l.itemId])).has(l.itemId)) continue;
          await this.inv.change(tx, {
            tenantId,
            locationId: cur.fromLocationId,
            itemId: l.itemId,
            deltaMilli: toMilli(l.qty),
            reason: "transfer_in",
            refType: "transfer",
            refId: cur.id,
            refNumber: cur.number,
            unitCost: unit,
            note: `Transfer ${cur.number ?? ""} cancelled`,
            createdBy: userId,
          });
        }
        await this.inv.batches.reverseRef(tx, tenantId, "transfer", cur.id, "transfer_in", { refNumber: cur.number, userId, note: "Transfer cancelled" });
      }
      const [updated] = await tx
        .update(stockTransfers)
        .set({ status: "cancelled", cancelledAt: this.now(), cancelReason: reason })
        .where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id)))
        .returning();
      return updated!;
    });
    return toTransfer(row);
  }

  // ================================================================ the old instant transfer

  /**
   * Moves stock between two locations at once (`POST /v1/inventory/transfers`): a numbered note that is sent and received
   * in one transaction. Same movements as before (`transfer_out` at the source, `transfer_in` at the destination with the
   * source cost); 409 `insufficient_stock` when the source is short.
   */
  async instant(tenantId: string, input: unknown, userId: string | null = null): Promise<StockTransfer> {
    const b = transferNoteInputSchema.parse(input);
    await this.validateEnds(tenantId, b.fromLocationId, b.toLocationId);
    const lines = await this.cleanLines(tenantId, b.lines);
    const date = this.today();
    const id = await this.db.transaction(async (tx) => {
      const number = await this.inv.purchasing.nextNumber(tx, tenantId, "tr", date);
      const [created] = await tx
        .insert(stockTransfers)
        .values({
          tenantId,
          fromLocationId: b.fromLocationId,
          toLocationId: b.toLocationId,
          lines: lines.map((l) => ({ itemId: l.itemId, qty: fromMilli(l.milli), itemName: l.itemName, unit: l.unit, ...(l.batchId ? { batches: [{ batchId: l.batchId, batchNo: "", expiry: null, qty: 0 }] } : {}) })),
          note: b.note ?? null,
          transport: b.transport ?? null,
          createdBy: userId,
          createdAt: this.now(),
          number,
          status: "draft",
        })
        .returning({ id: stockTransfers.id });
      return created!.id;
    });
    try {
      await this.send(tenantId, id, userId, { receiveNow: true });
      return await this.receive(tenantId, id, { all: true }, userId);
    } catch (err) {
      // Leave no half-made note behind when the source was short.
      await this.db.delete(stockTransfers).where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id), eq(stockTransfers.status, "draft")));
      throw err;
    }
  }
}

