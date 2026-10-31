/**
 * Stock depth wiring (docs/stock-depth.md): batches and expiry, physical stock audits, transfers with in-transit.
 * Everything that needs more than one module lives here so kit.ts only gets small hunks:
 *  - the pharmacy (medicines) batches as read-only context for the generic batches,
 *  - the expired-stock rule on bill create / edit,
 *  - the transfer note PDF,
 *  - the daily expiry alert job.
 */
import { AppError } from "@rbms/core";
import type { Db } from "@rbms/db";
import { renderTransferNote, safeFilename, type DocSeller, type DocumentRegistry, type TransferNoteDocData } from "@rbms/documents";
import { addDays, type InventoryService, type LegacyBatchPort } from "@rbms/inventory";
import { medicineBatches, medicines, type MedicinesService } from "@rbms/medicines";
import { and, eq, sql } from "@rbms/db";
import type { FastifyRequest } from "fastify";

/** The pharmacy batches for the generic batch service: which items have them, and their expiry totals. */
export function legacyBatchPort(d: { db: Db; medicines: () => { service: MedicinesService } | undefined; isEnabled: (tenantId: string, key: string) => Promise<boolean> }): LegacyBatchPort {
  return {
    async hasBatches(tenantId, itemId) {
      const [batch] = await d.db
        .select({ id: medicineBatches.id })
        .from(medicineBatches)
        .where(and(eq(medicineBatches.tenantId, tenantId), eq(medicineBatches.itemId, itemId)))
        .limit(1);
      if (batch) return true;
      const [details] = await d.db.select({ id: medicines.id }).from(medicines).where(and(eq(medicines.tenantId, tenantId), eq(medicines.itemId, itemId))).limit(1);
      return Boolean(details);
    },
    async expirySummary(tenantId, withinDays) {
      const m = d.medicines();
      if (!m || !(await d.isEnabled(tenantId, "medicines"))) return null;
      const s = await m.service.expirySummary(tenantId, withinDays);
      if (s.expired.batches === 0 && s.expiring.batches === 0) return null;
      return { expired: s.expired, expiring: s.expiring };
    },
  };
}

/**
 * Bill create / edit: with the shop's expired-stock rule on `block`, a line naming an expired batch (or needing more than
 * the unexpired batches can give) is refused with 400 `batch_expired`. Other rules do nothing here (the counter warns).
 */
export function expiredSaleGuard(inventory: () => InventoryService, isEnabled: (tenantId: string, key: string) => Promise<boolean>) {
  return async (req: FastifyRequest): Promise<void> => {
    const tenant = req.ctx.tenant;
    if (!tenant) return;
    const lines = (req.body as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines) || lines.length === 0) return;
    if (!(await isEnabled(tenant.id, "inventory"))) return;
    const items = (lines as { itemId?: unknown; qty?: unknown; batchId?: unknown; description?: unknown }[])
      .filter((l) => typeof l === "object" && l !== null)
      .map((l) => ({
        itemId: typeof l.itemId === "string" ? l.itemId : null,
        qty: Number(l.qty ?? 0),
        batchId: typeof l.batchId === "string" ? l.batchId : null,
        description: typeof l.description === "string" ? l.description : undefined,
      }));
    const check = await inventory().batches.checkSale(tenant.id, items, req.ctx.branch?.locationId ?? null);
    if (!check.ok) throw new AppError(400, "batch_expired", check.message, { items: check.items });
  };
}

/** Runs several guards in order. */
export const chainGuards =
  (...guards: ((req: FastifyRequest) => Promise<void>)[]) =>
  async (req: FastifyRequest) => {
    for (const g of guards) await g(req);
  };

export interface TransferNoteDocDeps {
  inventory: InventoryService;
  seller: (tenantId: string) => Promise<DocSeller>;
  registry: DocumentRegistry;
}

/** Registers `GET /v1/documents/transfer-note/:id.pdf` (own renderer; feature `inventory.locations`). */
export function registerTransferNoteDocument(d: TransferNoteDocDeps) {
  d.registry.register<TransferNoteDocData>({
    key: "transfer-note",
    paper: "A4",
    feature: "inventory.locations",
    permission: "inventory.transfer",
    load: async (tenantId, id) => {
      const t = await d.inventory.transfers.get(tenantId, id).catch((err: { status?: number }) => {
        if (err?.status === 404) return null;
        throw err;
      });
      if (!t) return null;
      const locs = await d.inventory.listLocations(tenantId, {});
      const place = (locId: string, fallback: string) => {
        const l = locs.items.find((x) => x.id === locId);
        return { name: l?.name ?? fallback, code: l?.code ?? null, address: l?.address ?? null };
      };
      return {
        id: t.id,
        number: t.number ?? `TR-${t.id.slice(0, 8)}`,
        status: t.status,
        sentAt: t.sentAt ?? t.createdAt,
        receivedAt: t.receivedAt,
        from: place(t.fromLocationId, t.fromName),
        to: place(t.toLocationId, t.toName),
        transport: t.transport,
        note: t.note,
        receiveNote: t.receiveNote,
        lines: t.lines.map((l) => ({
          itemName: l.itemName ?? "",
          unit: l.unit ?? "",
          qty: l.qty,
          received: l.received ?? 0,
          damaged: l.damaged ?? 0,
          short: l.short ?? 0,
          reason: l.reason ?? null,
          unitCost: l.unitCost ?? null,
          batches: (l.batches ?? []).map((b) => ({ batchNo: b.batchNo, expiry: b.expiry, qty: b.qty })),
        })),
        shop: await d.seller(tenantId),
        updatedAt: t.closedAt ?? t.receivedAt ?? t.sentAt ?? t.createdAt,
      };
    },
    render: renderTransferNote,
    filename: (data) => safeFilename(`Transfer-${data.number}`),
    version: (data) => (data.updatedAt instanceof Date ? data.updatedAt.toISOString() : data.updatedAt ? String(data.updatedAt) : null),
  });
}

/**
 * Daily job: for every shop with batches expiring (or expired) inside the alert window, emits one
 * `stock.batch_expiring` event per batch (developer webhooks; the shop's own integrations decide what to do with them).
 */
export function expiryAlertJob(d: { db: Db; inventory: () => InventoryService; emit: (tenantId: string, type: string, data: unknown) => Promise<void>; today: () => string }) {
  return async () => {
    const horizon = addDays(d.today(), 90);
    const rows = await d.db.execute<{ tenant_id: string }>(
      sql`select distinct b.tenant_id from stock_batches b join stock_batch_levels l on l.batch_id = b.id and l.tenant_id = b.tenant_id where b.expiry is not null and b.expiry <= ${horizon} and l.qty > 0`,
    );
    const list = (rows as unknown as { rows?: { tenant_id: string }[] }).rows ?? (rows as unknown as { tenant_id: string }[]);
    for (const r of list) await d.inventory().batches.emitExpiryAlerts(r.tenant_id, (type, data) => d.emit(r.tenant_id, type, data));
  };
}
