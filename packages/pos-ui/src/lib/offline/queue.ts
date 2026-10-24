import { allocate } from "./numbering";
import type { OfflineStore } from "./store";
import type { BillDisplay, OfflineBillPayload, QueuedBill, QueuedStatus } from "./types";
import type { Invoice } from "../types";

/** The queue of bills made offline: add a sale, void one that hasn't synced, list, count, export, tidy. */

export interface SaleInput {
  date: string;
  billedAt: Date;
  lines: Record<string, unknown>[];
  snapshots: { itemId: string; price: number; gstRate: number }[];
  payments: OfflineBillPayload["payments"];
  customerId?: string;
  customer?: { name: string; phone?: string };
  tillSessionId?: string;
  notes?: string;
  display: BillDisplay;
  receipt?: Omit<Invoice, "id" | "number">;
}

export const newClientId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Synced bills stay on the device this long (for the list and a reprint), then are removed. */
export const KEEP_SYNCED_MS = 7 * 24 * 60 * 60_000;
/** Not yet on the server: queued, syncing or failed. */
export const isPending = (b: Pick<QueuedBill, "status">) => b.status === "queued" || b.status === "syncing" || b.status === "failed";

export interface QueueCounts {
  queued: number;
  syncing: number;
  failed: number;
  synced: number;
  voided: number;
  /** queued + syncing + failed: bills the server doesn't have yet. */
  pending: number;
  /** Synced bills with something to look at. */
  flagged: number;
}

export function countBills(bills: readonly QueuedBill[]): QueueCounts {
  const n: Record<QueuedStatus, number> = { queued: 0, syncing: 0, failed: 0, synced: 0, voided: 0 };
  let flagged = 0;
  for (const b of bills) {
    n[b.status]++;
    if (b.status === "synced" && b.result?.flags.length) flagged++;
  }
  return { ...n, pending: n.queued + n.syncing + n.failed, flagged };
}

export class OfflineQueue {
  constructor(
    readonly store: OfflineStore,
    readonly deviceId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Saves a finished sale: takes its number (a reserved invoice number, else a provisional one) and writes the bill in
   * the same transaction, so the number and the bill can't get apart even if the tab dies at that moment.
   */
  async enqueueSale(input: SaleInput): Promise<QueuedBill> {
    const clientId = newClientId();
    return this.store.transact((numbering) => {
      const a = allocate(numbering, input.date, this.deviceId);
      const order = numbering.order + 1;
      const payload: OfflineBillPayload = {
        clientId,
        deviceId: this.deviceId,
        billedAt: input.billedAt.toISOString(),
        date: input.date,
        ...(a.kind === "reserved" ? { number: a.ref } : { provisionalNumber: a.provisional }),
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.customer ? { customer: input.customer } : {}),
        lines: input.lines,
        snapshots: input.snapshots,
        payments: input.payments,
        ...(input.tillSessionId ? { tillSessionId: input.tillSessionId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      };
      const bill: QueuedBill = {
        clientId,
        order,
        status: "queued",
        createdAt: input.billedAt.getTime(),
        payload,
        display: input.display,
        ...(input.receipt ? { receipt: input.receipt } : {}),
        number: a.number,
        numberKind: a.kind,
        attempts: 0,
      };
      return { result: bill, putBills: [bill], numbering: { ...a.state, order } };
    });
  }

  list() {
    return this.store.listBills();
  }

  async counts(): Promise<QueueCounts> {
    return countBills(await this.store.listBills());
  }

  /**
   * Cancels a bill that hasn't reached the server. It still syncs (as a voided bill): its number is recorded as
   * cancelled on the server, so the sequence stays complete. Returns null when the bill can't be voided any more.
   */
  async voidBill(clientId: string, reason: string): Promise<QueuedBill | null> {
    const bill = await this.store.getBill(clientId);
    if (!bill || (bill.status !== "queued" && bill.status !== "failed")) return null;
    const next: QueuedBill = {
      ...bill,
      status: "queued",
      payload: { ...bill.payload, voided: { reason: reason.trim() || "Cancelled at the counter" } },
      display: { ...bill.display, received: 0 },
      attempts: 0,
    };
    delete next.error;
    delete next.nextTryAt;
    await this.store.putBills([next]);
    return next;
  }

  /** Puts a failed bill back in the line for the next sync (by hand: ignores the retry delay). */
  async retry(clientId: string): Promise<void> {
    const bill = await this.store.getBill(clientId);
    if (!bill || bill.status !== "failed") return;
    const next: QueuedBill = { ...bill, status: "queued" };
    delete next.nextTryAt;
    await this.store.putBills([next]);
  }

  async retryAllFailed(): Promise<number> {
    const failed = (await this.store.listBills()).filter((b) => b.status === "failed");
    await this.store.putBills(
      failed.map((b) => {
        const next: QueuedBill = { ...b, status: "queued" };
        delete next.nextTryAt;
        return next;
      }),
    );
    return failed.length;
  }

  /** Removes synced / voided bills older than a week. Returns how many went. */
  async prune(): Promise<number> {
    const cutoff = this.now() - KEEP_SYNCED_MS;
    const old = (await this.store.listBills()).filter((b) => (b.status === "synced" || b.status === "voided") && (b.result?.syncedAt ?? b.createdAt) < cutoff);
    await this.store.deleteBills(old.map((b) => b.clientId));
    return old.length;
  }

  /** Everything on this device as JSON, for support (no tokens; the bills as they would be sent). */
  async exportJson(meta: Record<string, unknown> = {}): Promise<string> {
    const [bills, numbering] = await Promise.all([this.store.listBills(), this.store.numbering()]);
    return JSON.stringify({ exportedAt: new Date(this.now()).toISOString(), deviceId: this.deviceId, ...meta, numbering, bills }, null, 2);
  }
}
