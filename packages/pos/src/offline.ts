import { AppError, type AuditPort, type TenantRef } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { MAX_SYNC_BATCH, billListQuery, blockListQuery, closeBlockBody, offlineBillBody, reserveBody, reviewBody, type OfflineBillBody } from "./offline-schemas";
import { financialYearOf, inRange, isLate, isRetryableStatus, negativeStockFlags, reconcileLines, remainingPayments, unusedSeqs } from "./offline-logic";
import type { LoggerPort, PosCatalogPort, PosInvoicesPort } from "./ports";
import {
  posNumberBlocks,
  posOfflineBills,
  type NumberBlockRow,
  type OfflineBillRow,
  type OfflineFlag,
  type VoidedSeq,
} from "./schema";

/**
 * Offline billing on the server (docs/offline-billing.md): reserved invoice-number blocks per device and the idempotent
 * sync of bills a counter made while the internet was down. Every query filters by tenant.
 */

export interface OfflineDeps {
  db: Db;
  catalog: PosCatalogPort;
  invoices?: PosInvoicesPort;
  audit?: AuditPort;
  log?: LoggerPort;
  now?: () => Date;
}

export interface OfflineActor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
  /** The request's branch (x-branch / the terminal's). */
  branchId: string | null;
  /** The paired terminal of the request, if any. */
  terminalId: string | null;
  /** May manage terminals (pos.devices): close any block, review flags. */
  canManage: boolean;
}

export interface BlockView {
  id: string;
  deviceId: string;
  branchId: string | null;
  fy: string;
  prefix: string;
  fromSeq: number;
  toSeq: number;
  status: "open" | "closed";
  voided: VoidedSeq[];
  /** Numbers held by bills (synced, failed or in flight). */
  used: number;
  createdAt: Date;
  closedAt: Date | null;
}

export interface SyncResult {
  clientId: string;
  status: "synced" | "voided" | "failed" | "in_progress";
  /** This key had been synced before: the first result is returned again. */
  duplicate: boolean;
  invoiceId: string | null;
  /** The legal invoice number (null for a voided or failed bill). */
  number: string | null;
  total: number | null;
  paid: number | null;
  balance: number | null;
  flags: OfflineFlag[];
  error?: { code: string; message: string; retryable: boolean };
}

/** A processing row older than this is taken to have died; a retry may take it over. */
export const STALE_MS = 2 * 60_000;
export const MAX_OPEN_BLOCKS_PER_DEVICE = 3;

/** Postgres unique-violation constraint name (drizzle wraps driver errors in `cause`), or null. */
function uniqueViolation(err: unknown): string | null {
  for (let cur = err as { code?: string; constraint_name?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (typeof cur !== "object") break;
    if (cur.code === "23505") return cur.constraint_name ?? "";
  }
  return null;
}

const toBlockView = (r: NumberBlockRow, used: number): BlockView => ({
  id: r.id,
  deviceId: r.deviceId,
  branchId: r.branchId,
  fy: r.fy,
  prefix: r.prefix,
  fromSeq: r.fromSeq,
  toSeq: r.toSeq,
  status: r.status,
  voided: r.voided,
  used,
  createdAt: r.createdAt,
  closedAt: r.closedAt,
});

const resultOf = (r: OfflineBillRow, duplicate: boolean): SyncResult => {
  const failed = r.status === "failed";
  return {
    clientId: r.clientId,
    status: r.status === "processing" ? "in_progress" : r.status,
    duplicate,
    invoiceId: r.invoiceId,
    number: r.number,
    total: null,
    paid: null,
    balance: null,
    flags: r.flags,
    ...(failed && r.error ? { error: { ...r.error, retryable: true } } : {}),
  };
};

export class OfflineBillingService {
  private readonly db: Db;
  private readonly now: () => Date;

  constructor(private readonly deps: OfflineDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  private port(): PosInvoicesPort {
    if (!this.deps.invoices) throw new AppError(503, "not_configured", "Offline billing is not set up on this server");
    return this.deps.invoices;
  }

  private async audit(tenantId: string, actor: Pick<OfflineActor, "userId" | "ip" | "userAgent">, e: { action: string; entityType: string; entityId?: string; summary: string; after?: unknown }) {
    await this.deps.audit?.record({ tenantId, actorUserId: actor.userId, ip: actor.ip, userAgent: actor.userAgent, ...e }).catch(() => undefined);
  }

  // ================================================================ number blocks

  private async blockRow(tenantId: string, id: string): Promise<NumberBlockRow> {
    const [row] = await this.db.select().from(posNumberBlocks).where(and(eq(posNumberBlocks.tenantId, tenantId), eq(posNumberBlocks.id, id))).limit(1);
    if (!row) throw new AppError(404, "block_not_found", "Number block not found");
    return row;
  }

  private async usedCounts(tenantId: string, blockIds: string[]): Promise<Map<string, number>> {
    if (!blockIds.length) return new Map();
    const rows = await this.db
      .select({ blockId: posOfflineBills.blockId, n: count() })
      .from(posOfflineBills)
      .where(and(eq(posOfflineBills.tenantId, tenantId), inArray(posOfflineBills.blockId, blockIds)))
      .groupBy(posOfflineBills.blockId);
    return new Map(rows.map((r) => [r.blockId!, Number(r.n)]));
  }

  /**
   * Reserves `count` invoice numbers for a device: they are taken from the real (branch, FY) invoice series and recorded
   * as a block in the same transaction, so no number can be taken without a record of who holds it.
   */
  async reserveBlock(tenant: TenantRef, actor: OfflineActor, input: unknown): Promise<BlockView> {
    const p = reserveBody.parse(input);
    const deviceId = actor.terminalId ?? p.deviceId;
    if (!deviceId) throw new AppError(400, "device_id_required", "Send the device id of this browser");
    const [open] = await this.db
      .select({ n: count() })
      .from(posNumberBlocks)
      .where(and(eq(posNumberBlocks.tenantId, tenant.id), eq(posNumberBlocks.deviceId, deviceId), eq(posNumberBlocks.status, "open")));
    if (Number(open?.n ?? 0) >= MAX_OPEN_BLOCKS_PER_DEVICE) {
      throw new AppError(409, "block_limit", "This device already holds open number blocks. Use or release them before taking another");
    }
    let row: NumberBlockRow | undefined;
    await this.port().reserveBlock(tenant, { branchId: actor.branchId, count: p.count }, async (tx, b) => {
      [row] = await tx
        .insert(posNumberBlocks)
        .values({
          tenantId: tenant.id,
          deviceId,
          terminalId: actor.terminalId,
          branchId: b.branchId,
          fy: b.fy,
          prefix: b.prefix,
          fromSeq: b.fromSeq,
          toSeq: b.toSeq,
          reservedBy: actor.userId,
        })
        .returning();
    });
    await this.audit(tenant.id, actor, {
      action: "pos.offline.block.reserve",
      entityType: "pos_number_block",
      entityId: row!.id,
      summary: `Reserved invoice numbers ${row!.fromSeq}–${row!.toSeq} (${row!.fy}) for offline billing`,
    });
    return toBlockView(row!, 0);
  }

  async listBlocks(tenantId: string, query: unknown): Promise<{ items: BlockView[] }> {
    const q = blockListQuery.parse(query);
    const rows = await this.db
      .select()
      .from(posNumberBlocks)
      .where(and(eq(posNumberBlocks.tenantId, tenantId), q.status ? eq(posNumberBlocks.status, q.status) : undefined, q.deviceId ? eq(posNumberBlocks.deviceId, q.deviceId) : undefined))
      .orderBy(desc(posNumberBlocks.createdAt), desc(posNumberBlocks.id))
      .limit(100);
    const used = await this.usedCounts(tenantId, rows.map((r) => r.id));
    return { items: rows.map((r) => toBlockView(r, used.get(r.id) ?? 0)) };
  }

  /**
   * Releases the numbers of a block that no bill holds: each is written to the block's `voided` list with the reason and
   * the person, and audited. Refused while a failed or in-flight bill still holds a number of the block.
   */
  async closeBlock(tenant: TenantRef, actor: OfflineActor, id: string, input: unknown): Promise<{ block: BlockView; released: number[] }> {
    const p = closeBlockBody.parse(input ?? {});
    if (p.reason === "lost_device" && !actor.canManage) throw new AppError(403, "forbidden", "Only a manager can close the numbers of a lost device");
    const result = await this.db.transaction(async (tx) => {
      const [block] = await tx
        .select()
        .from(posNumberBlocks)
        .where(and(eq(posNumberBlocks.tenantId, tenant.id), eq(posNumberBlocks.id, id)))
        .for("update")
        .limit(1);
      if (!block) throw new AppError(404, "block_not_found", "Number block not found");
      if (!actor.canManage && block.reservedBy !== actor.userId && block.deviceId !== actor.terminalId) {
        throw new AppError(403, "forbidden", "This number block belongs to another device");
      }
      if (block.status === "closed") return { block, released: [] as number[], used: 0 };
      const bills = await tx
        .select({ seq: posOfflineBills.seq, status: posOfflineBills.status })
        .from(posOfflineBills)
        .where(and(eq(posOfflineBills.tenantId, tenant.id), eq(posOfflineBills.blockId, id), isNotNull(posOfflineBills.seq)));
      if (bills.some((b) => b.status === "processing" || b.status === "failed")) {
        throw new AppError(409, "block_has_pending", "Some bills of this block are still syncing or failed. Sync or fix them first");
      }
      const released = unusedSeqs(block, bills.map((b) => b.seq!));
      const at = this.now().toISOString();
      const voided: VoidedSeq[] = [...block.voided, ...released.map((seq): VoidedSeq => ({ seq, reason: p.reason === "lost_device" ? "lost_device" : "unused", at, by: actor.userId }))];
      const [updated] = await tx
        .update(posNumberBlocks)
        .set({ status: "closed", voided, closedAt: this.now(), closedBy: actor.userId, closeNote: p.note ?? null, updatedAt: sql`now()` })
        .where(eq(posNumberBlocks.id, id))
        .returning();
      return { block: updated!, released, used: bills.length };
    });
    if (result.released.length) {
      await this.audit(tenant.id, actor, {
        action: "pos.offline.block.close",
        entityType: "pos_number_block",
        entityId: id,
        summary: `Released ${result.released.length} unused invoice number(s) of ${result.block.fromSeq}–${result.block.toSeq} (${result.block.fy}): ${p.reason}`,
        after: { released: result.released, reason: p.reason, note: p.note ?? null },
      });
    }
    return { block: toBlockView(result.block, result.used), released: result.released };
  }

  // ================================================================ sync

  /** Syncs the bills one after the other (oldest first, as sent). One bill's failure never stops the rest. */
  async sync(tenant: TenantRef, actor: OfflineActor, rawBills: unknown[]): Promise<{ results: SyncResult[] }> {
    if (rawBills.length > MAX_SYNC_BATCH) throw new AppError(400, "batch_too_large", `Send at most ${MAX_SYNC_BATCH} bills at a time`);
    this.port();
    const results: SyncResult[] = [];
    for (const raw of rawBills) results.push(await this.syncOne(tenant, actor, raw));
    return { results };
  }

  private async syncOne(tenant: TenantRef, actor: OfflineActor, raw: unknown): Promise<SyncResult> {
    const parsed = offlineBillBody.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { clientId?: unknown } | null)?.clientId;
      return {
        clientId: typeof id === "string" ? id : "",
        status: "failed",
        duplicate: false,
        invoiceId: null,
        number: null,
        total: null,
        paid: null,
        balance: null,
        flags: [],
        error: { code: "invalid_bill", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300), retryable: false },
      };
    }
    const body = parsed.data;
    const claim = await this.claim(tenant, actor, body);
    if ("result" in claim) return claim.result;
    try {
      return await this.process(tenant, actor, claim.row, body);
    } catch (err) {
      const status = err instanceof AppError ? err.status : 500;
      const code = err instanceof AppError ? err.code : "sync_error";
      const message = err instanceof AppError ? err.message : "The bill could not be saved on the server";
      if (!(err instanceof AppError)) this.deps.log?.error({ err, tenantId: tenant.id, clientId: body.clientId }, "pos offline: sync failed");
      const [row] = await this.db
        .update(posOfflineBills)
        .set({ status: "failed", error: { code, message }, updatedAt: sql`now()` })
        .where(eq(posOfflineBills.id, claim.row.id))
        .returning();
      await this.audit(tenant.id, actor, { action: "pos.offline.sync_failed", entityType: "pos_offline_bill", entityId: claim.row.id, summary: `Offline bill ${body.provisionalNumber ?? body.clientId} could not be synced: ${code}` });
      return { ...resultOf(row!, false), error: { code, message, retryable: isRetryableStatus(status) } };
    }
  }

  /** Takes the idempotency key: a first sight creates the row, a replay answers with the stored result. */
  private async claim(tenant: TenantRef, actor: OfflineActor, body: OfflineBillBody): Promise<{ row: OfflineBillRow } | { result: SyncResult }> {
    const [inserted] = await this.db
      .insert(posOfflineBills)
      .values({
        tenantId: tenant.id,
        clientId: body.clientId,
        deviceId: body.deviceId,
        userId: actor.userId,
        payload: body as unknown as Record<string, unknown>,
        billedAt: new Date(body.billedAt),
        claimedAt: this.now(),
        provisionalNumber: body.provisionalNumber ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { row: inserted };
    const [existing] = await this.db
      .select()
      .from(posOfflineBills)
      .where(and(eq(posOfflineBills.tenantId, tenant.id), eq(posOfflineBills.clientId, body.clientId)))
      .limit(1);
    if (!existing) return { result: { ...this.empty(body.clientId), status: "in_progress" } };
    if (existing.status === "synced" || existing.status === "voided") return { result: await this.replay(tenant, existing) };
    const age = this.now().getTime() - existing.claimedAt.getTime();
    if (existing.status === "processing" && age < STALE_MS) return { result: resultOf(existing, true) };
    // Failed, or a first attempt that died: this retry takes it over (once; a racing retry loses the update).
    const [taken] = await this.db
      .update(posOfflineBills)
      .set({ status: "processing", attempts: sql`${posOfflineBills.attempts} + 1`, claimedAt: this.now(), error: null, updatedAt: sql`now()` })
      .where(and(eq(posOfflineBills.id, existing.id), eq(posOfflineBills.status, existing.status), eq(posOfflineBills.attempts, existing.attempts)))
      .returning();
    return taken ? { row: taken } : { result: resultOf(existing, true) };
  }

  private empty(clientId: string): SyncResult {
    return { clientId, status: "failed", duplicate: false, invoiceId: null, number: null, total: null, paid: null, balance: null, flags: [] };
  }

  private async replay(tenant: TenantRef, r: OfflineBillRow): Promise<SyncResult> {
    const res = resultOf(r, true);
    if (r.invoiceId) {
      const info = await this.port().get(tenant, r.invoiceId).catch(() => null);
      if (info) return { ...res, total: info.total, paid: info.paid, balance: info.balance, number: info.number ?? res.number };
    }
    return res;
  }

  /**
   * Takes the reserved number for this bill under the block's row lock (a block being closed at the same moment can't
   * void it from under the bill). Returns the number to issue with, or the reason it can't be used.
   */
  private async holdNumber(tenant: TenantRef, row: OfflineBillRow, body: OfflineBillBody): Promise<{ preset: { fy: string; prefix: string; seq: number } } | { why: string }> {
    const ref = body.number;
    if (!ref) return { why: "none" };
    try {
      return await this.db.transaction(async (tx) => {
        const [block] = await tx
          .select()
          .from(posNumberBlocks)
          .where(and(eq(posNumberBlocks.tenantId, tenant.id), eq(posNumberBlocks.id, ref.blockId)))
          .for("update")
          .limit(1);
        if (!block) return { why: "unknown_block" };
        if (block.status !== "open") return { why: "block_closed" };
        if (block.deviceId !== body.deviceId) return { why: "wrong_device" };
        if (!inRange(block, ref.seq)) return { why: "out_of_range" };
        if (block.voided.some((v) => v.seq === ref.seq)) return { why: "voided" };
        if (block.fy !== financialYearOf(body.date)) return { why: "fy_mismatch" };
        await tx.update(posOfflineBills).set({ blockId: block.id, seq: ref.seq, updatedAt: sql`now()` }).where(eq(posOfflineBills.id, row.id));
        return { preset: { fy: block.fy, prefix: block.prefix, seq: ref.seq } };
      });
    } catch (err) {
      if (uniqueViolation(err) !== null) return { why: "seq_taken" };
      throw err;
    }
  }

  private async process(tenant: TenantRef, actor: OfflineActor, row: OfflineBillRow, body: OfflineBillBody): Promise<SyncResult> {
    const port = this.port();
    const flags: OfflineFlag[] = [...row.flags];

    // ---- a bill cancelled at the counter before it synced: its number is voided, nothing is invoiced
    if (body.voided) {
      if (body.number) await this.voidBillNumber(tenant, actor, row, body);
      const [done] = await this.db
        .update(posOfflineBills)
        .set({ status: "voided", syncedAt: this.now(), updatedAt: sql`now()` })
        .where(eq(posOfflineBills.id, row.id))
        .returning();
      await this.audit(tenant.id, actor, { action: "pos.offline.void", entityType: "pos_offline_bill", entityId: row.id, summary: `Offline bill ${body.provisionalNumber ?? body.clientId} was cancelled at the counter: ${body.voided.reason}` });
      return resultOf(done!, false);
    }

    // ---- 1. issue the invoice (unless a crashed earlier attempt already did)
    let invoiceId = row.invoiceId;
    let number = row.number;
    let issuedSeq: number | null = row.seq;
    let total: number | null = null;
    let reassigned = false;
    if (!invoiceId) {
      const held = await this.holdNumber(tenant, row, body);
      const preset = "preset" in held ? held.preset : undefined;
      if (!preset && body.number) {
        reassigned = true;
        flags.push({ code: "number_reassigned", detail: { offlineSeq: body.number.seq, reason: "why" in held ? held.why : "unknown", provisional: body.provisionalNumber ?? null } });
      }

      const ids = [...new Set(body.lines.map((l) => l.itemId).filter((x): x is string => !!x))];
      const items = ids.length ? await this.deps.catalog.items(tenant.id, ids) : [];
      const { lines, flags: lineFlags } = reconcileLines(body.lines, body.snapshots ?? [], new Map(items.map((i) => [i.itemId, i])));
      flags.push(...lineFlags);

      let issued;
      try {
        issued = await port.issue(tenant, {
          date: body.date,
          branchId: actor.branchId,
          ...(body.customerId ? { customerId: body.customerId } : {}),
          ...(body.customer ? { customer: { name: body.customer.name || "Walk-in", ...(body.customer.phone ? { phone: body.customer.phone } : {}) } } : {}),
          lines,
          ...(body.notes ? { notes: body.notes } : {}),
          ...(body.tillSessionId ? { tillSessionId: body.tillSessionId } : {}),
          userId: actor.userId,
          ...(preset ? { preset } : {}),
        });
      } catch (err) {
        // A crash between the invoice insert and our bookkeeping: the reserved number already has its bill.
        const adopted = preset && uniqueViolation(err) !== null ? await port.findBySeq(tenant, { branchId: actor.branchId, fy: preset.fy, seq: preset.seq }) : null;
        if (!adopted) throw err;
        issued = { invoiceId: adopted.invoiceId, number: adopted.number ?? "", fy: preset!.fy, seq: preset!.seq, total: adopted.total, paid: adopted.paid, balance: adopted.balance, flags: [] as OfflineFlag[] };
      }
      flags.push(...issued.flags);
      invoiceId = issued.invoiceId;
      number = issued.number;
      total = issued.total;
      issuedSeq = preset ? preset.seq : null;
      await this.db
        .update(posOfflineBills)
        .set({ invoiceId, number, flags, ...(preset ? {} : { blockId: null, seq: null }), updatedAt: sql`now()` })
        .where(eq(posOfflineBills.id, row.id));

      // Stock that went below zero by this sale is for a person to look at; the sale stands.
      if (ids.length) {
        const after = await this.deps.catalog.items(tenant.id, ids).catch(() => []);
        flags.push(...negativeStockFlags(lines, new Map(after.filter((i) => i.stock && i.stock.status !== "untracked").map((i) => [i.itemId, i.stock!.qty]))));
      }
    }

    // ---- 2. payments as taken (a retry records only what is missing)
    const current = await port.get(tenant, invoiceId);
    if (!current) throw new AppError(409, "invoice_missing", "The invoice of this bill was removed");
    let paid = current.paid;
    let balance = current.balance;
    total = current.total;
    const planned = remainingPayments(body.payments, current.paid);
    if (planned.length) {
      const r = await port.pay(tenant, invoiceId, { date: body.date, payments: planned, ...(body.tillSessionId ? { tillSessionId: body.tillSessionId } : {}), userId: actor.userId });
      paid = r.paid;
      balance = r.balance;
      flags.push(...r.flags);
    }
    if (isLate(new Date(body.billedAt), this.now())) flags.push({ code: "late_sync", detail: { billedAt: body.billedAt } });

    const unique = flags.filter((f, i) => flags.findIndex((g) => g.code === f.code && g.line === f.line) === i);
    const [done] = await this.db
      .update(posOfflineBills)
      .set({ status: "synced", flags: unique, invoiceId, number, error: null, syncedAt: this.now(), updatedAt: sql`now()` })
      .where(eq(posOfflineBills.id, row.id))
      .returning();
    if (unique.length) {
      await this.audit(tenant.id, actor, {
        action: "pos.offline.synced_with_flags",
        entityType: "pos_offline_bill",
        entityId: row.id,
        summary: `Offline bill ${body.provisionalNumber ?? body.clientId} synced as ${number}: ${[...new Set(unique.map((f) => f.code))].join(", ")}`,
        after: { invoiceId, number, reassigned, seq: issuedSeq },
      });
    }
    return { ...resultOf(done!, false), total, paid, balance };
  }

  /** A voided bill still holds its number: record it in the block's voided list (and on the bill, so it can't be reused). */
  private async voidBillNumber(tenant: TenantRef, actor: OfflineActor, row: OfflineBillRow, body: OfflineBillBody): Promise<void> {
    const ref = body.number!;
    await this.db.transaction(async (tx) => {
      const [block] = await tx
        .select()
        .from(posNumberBlocks)
        .where(and(eq(posNumberBlocks.tenantId, tenant.id), eq(posNumberBlocks.id, ref.blockId)))
        .for("update")
        .limit(1);
      if (!block || !inRange(block, ref.seq) || block.deviceId !== body.deviceId) return;
      if (!block.voided.some((v) => v.seq === ref.seq)) {
        const entry: VoidedSeq = { seq: ref.seq, reason: "bill_voided", at: this.now().toISOString(), by: actor.userId, clientId: body.clientId };
        await tx.update(posNumberBlocks).set({ voided: [...block.voided, entry], updatedAt: sql`now()` }).where(eq(posNumberBlocks.id, block.id));
      }
      await tx.update(posOfflineBills).set({ blockId: block.id, seq: ref.seq, updatedAt: sql`now()` }).where(eq(posOfflineBills.id, row.id));
    }).catch((err: unknown) => {
      if (uniqueViolation(err) === null) throw err;
    });
  }

  // ================================================================ review (managers)

  async listBills(tenantId: string, query: unknown) {
    const q = billListQuery.parse(query);
    const where = and(
      eq(posOfflineBills.tenantId, tenantId),
      q.status ? eq(posOfflineBills.status, q.status) : undefined,
      q.flagged === "true" ? sql`jsonb_array_length(${posOfflineBills.flags}) > 0 and ${posOfflineBills.reviewedAt} is null` : undefined,
      q.flagged === "false" ? sql`jsonb_array_length(${posOfflineBills.flags}) = 0` : undefined,
    );
    const [rows, total] = await Promise.all([
      this.db
        .select({
          clientId: posOfflineBills.clientId,
          deviceId: posOfflineBills.deviceId,
          status: posOfflineBills.status,
          attempts: posOfflineBills.attempts,
          invoiceId: posOfflineBills.invoiceId,
          number: posOfflineBills.number,
          provisionalNumber: posOfflineBills.provisionalNumber,
          flags: posOfflineBills.flags,
          error: posOfflineBills.error,
          billedAt: posOfflineBills.billedAt,
          syncedAt: posOfflineBills.syncedAt,
          reviewedAt: posOfflineBills.reviewedAt,
          reviewNote: posOfflineBills.reviewNote,
        })
        .from(posOfflineBills)
        .where(where)
        .orderBy(desc(posOfflineBills.billedAt), desc(posOfflineBills.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ n: count() }).from(posOfflineBills).where(where),
    ]);
    return { items: rows, total: Number(total[0]?.n ?? 0), limit: q.limit, offset: q.offset };
  }

  /** A manager has looked at the flags of a synced bill. */
  async markReviewed(tenant: TenantRef, actor: OfflineActor, clientId: string, input: unknown): Promise<{ ok: true }> {
    const p = reviewBody.parse(input ?? {});
    const rows = await this.db
      .update(posOfflineBills)
      .set({ reviewedAt: this.now(), reviewedBy: actor.userId, reviewNote: p.note ?? null, updatedAt: sql`now()` })
      .where(and(eq(posOfflineBills.tenantId, tenant.id), eq(posOfflineBills.clientId, clientId)))
      .returning({ id: posOfflineBills.id });
    if (!rows.length) throw new AppError(404, "offline_bill_not_found", "Offline bill not found");
    await this.audit(tenant.id, actor, { action: "pos.offline.reviewed", entityType: "pos_offline_bill", entityId: rows[0]!.id, summary: `Offline bill flags reviewed${p.note ? `: ${p.note}` : ""}` });
    return { ok: true };
  }
}
