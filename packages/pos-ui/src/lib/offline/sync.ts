import { BLOCK_SIZE, fyOf, isSpent, needsBlock, staleBlocks } from "./numbering";
import { isPending } from "./queue";
import type { OfflineStore } from "./store";
import type { OfflineApi, QueuedBill, SyncResultDto } from "./types";

/**
 * The sync engine: posts queued bills (oldest first, 25 at a time) with their idempotency keys, applies the per-bill
 * answers, retries what can be retried, and keeps the reserved number block topped up. A network failure never marks a
 * bill failed: the bill goes back to "queued" and the next round (online again, or "Sync now") tries it again. Because
 * the server answers a repeated key with the first result, "did my request arrive?" never matters.
 */

export const SYNC_BATCH = 25;
/** A bill "syncing" for longer than this was interrupted (tab closed): it is queued again. */
export const SYNCING_STALE_MS = 2 * 60_000;
const BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export const backoffMs = (attempts: number) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;

/** True for "couldn't reach the server": a thrown fetch error or an API error with status 0 / 408 / 502-504. */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const status = (err as { status?: number } | null)?.status;
  return status === 0 || status === 502 || status === 503 || status === 504 || status === 408;
}

export interface SyncReport {
  sent: number;
  synced: number;
  voided: number;
  failed: number;
  /** Still queued: the server was busy with the same key, or never answered for it. */
  waiting: number;
  /** The network (or the server) was unreachable: the rest waits. */
  offline: boolean;
  /** The server refused the whole request (no permission, session over ...). */
  refused?: { status: number; code?: string };
  blockReserved: boolean;
  blocksReleased: number;
}

export interface SyncOptions {
  store: OfflineStore;
  api: OfflineApi;
  now?: () => number;
  /** Retry failed bills whatever their delay (the "Sync now" button). */
  force?: boolean;
  /** Today's IST date (for the FY of the number block). */
  today: string;
  /** Ask for more numbers and release spent ones (default on; the caller knows it is online). */
  topUp?: boolean;
}

const inFlight = new WeakMap<OfflineStore, Promise<SyncReport>>();

/** One sync round. Two calls at once share one run. */
export function syncQueue(opts: SyncOptions): Promise<SyncReport> {
  const running = inFlight.get(opts.store);
  if (running) return running;
  const p = run(opts).finally(() => inFlight.delete(opts.store));
  inFlight.set(opts.store, p);
  return p;
}

const emptyReport = (): SyncReport => ({ sent: 0, synced: 0, voided: 0, failed: 0, waiting: 0, offline: false, blockReserved: false, blocksReleased: 0 });

/** Which bills a round sends: queued ones whose wait is over, and failed ones that may be retried (all, when forced). */
export function dueBills(bills: readonly QueuedBill[], at: number, force: boolean): QueuedBill[] {
  return bills
    .filter((b) => {
      if (b.status === "queued") return force || !b.nextTryAt || b.nextTryAt <= at;
      if (b.status === "failed") return force || (b.error?.retryable === true && b.nextTryAt !== undefined && b.nextTryAt <= at);
      return false;
    })
    .sort((a, b) => a.order - b.order);
}

async function run(o: SyncOptions): Promise<SyncReport> {
  const clock = o.now ?? Date.now;
  const report = emptyReport();
  const all = await o.store.listBills();

  // A bill left "syncing" by a closed tab goes back in line.
  const stale = all.filter((b) => b.status === "syncing" && clock() - (b.syncingSince ?? 0) > SYNCING_STALE_MS).map((b) => ({ ...b, status: "queued" as const }));
  if (stale.length) await o.store.putBills(stale);
  const fresh = all.map((b) => stale.find((s) => s.clientId === b.clientId) ?? b);
  const due = dueBills(fresh, clock(), o.force ?? false);

  for (let i = 0; i < due.length; i += SYNC_BATCH) {
    const chunk = due.slice(i, i + SYNC_BATCH);
    const marked = chunk.map((b) => ({ ...b, status: "syncing" as const, syncingSince: clock() }));
    await o.store.putBills(marked);
    report.sent += chunk.length;
    let results: SyncResultDto[];
    try {
      results = await o.api.sync(chunk.map((b) => b.payload));
    } catch (err) {
      // Back where they were, untouched (a network failure doesn't count as an attempt).
      await o.store.putBills(chunk);
      report.sent -= chunk.length;
      if (isNetworkFailure(err)) report.offline = true;
      else {
        const e = err as { status?: number; code?: string } | null;
        report.refused = { status: e?.status ?? 0, ...(e?.code ? { code: e.code } : {}) };
      }
      break;
    }
    const byId = new Map(results.map((r) => [r.clientId, r]));
    await o.store.putBills(marked.map((b) => applyResult(b, byId.get(b.clientId), clock(), report)));
  }

  if (!report.offline && !report.refused && o.topUp !== false) await maintainBlocks(o, report, clock);
  return report;
}

/** Applies the server's answer for one bill to its record. */
export function applyResult(b: QueuedBill, r: SyncResultDto | undefined, at: number, report: SyncReport = emptyReport()): QueuedBill {
  const base: QueuedBill = { ...b };
  delete base.syncingSince;
  if (!r) {
    // The server said nothing about this bill: it stays queued for the next round.
    report.waiting++;
    return { ...base, status: "queued" };
  }
  if (r.status === "synced" || r.status === "voided") {
    if (r.status === "synced") report.synced++;
    else report.voided++;
    delete base.error;
    delete base.nextTryAt;
    return { ...base, status: r.status, result: { invoiceId: r.invoiceId, number: r.number, flags: r.flags, syncedAt: at } };
  }
  if (r.status === "in_progress") {
    report.waiting++;
    return { ...base, status: "queued", nextTryAt: at + 10_000 };
  }
  report.failed++;
  const attempts = b.attempts + 1;
  const error = r.error ?? { code: "sync_error", message: "The bill could not be saved", retryable: true };
  const next: QueuedBill = { ...base, status: "failed", attempts, error };
  if (error.retryable) next.nextTryAt = at + backoffMs(attempts);
  else delete next.nextTryAt;
  return next;
}

async function dropBlock(store: OfflineStore, id: string) {
  await store.transact((n) => ({ result: undefined, numbering: { ...n, blocks: n.blocks.filter((b) => b.id !== id) } }));
}

/**
 * Keeps the number block right: asks for a new one when few numbers are left, and releases a block of a finished
 * financial year (or forgets a used-up one) once none of its bills are still waiting to sync.
 */
async function maintainBlocks(o: SyncOptions, report: SyncReport, clock: () => number): Promise<void> {
  const numbering = await o.store.numbering();
  const bills = await o.store.listBills();
  const waitingOn = new Set(bills.filter(isPending).map((b) => b.payload.number?.blockId).filter((x): x is string => !!x));

  // Old financial year: give back what wasn't used (the server records each released number as voided).
  for (const b of staleBlocks(numbering.blocks, o.today)) {
    if (waitingOn.has(b.id)) continue;
    try {
      await o.api.closeBlock(b.id);
      await dropBlock(o.store, b.id);
      report.blocksReleased++;
    } catch {
      // Next round.
    }
  }
  // Used-up blocks need no call (the server sees every number on a bill): forget them locally.
  for (const b of (await o.store.numbering()).blocks.filter(isSpent)) {
    if (!waitingOn.has(b.id)) await dropBlock(o.store, b.id);
  }
  const current = await o.store.numbering();
  if (!needsBlock(current.blocks, o.today)) return;
  try {
    const block = await o.api.reserveBlock(BLOCK_SIZE);
    if (block.fy !== fyOf(o.today)) return;
    await o.store.transact((n) => ({
      result: undefined,
      numbering: {
        ...n,
        blocks: [
          ...n.blocks.filter((x) => x.id !== block.id),
          { id: block.id, fy: block.fy, prefix: block.prefix, fromSeq: block.fromSeq, toSeq: block.toSeq, nextSeq: block.fromSeq, branchId: block.branchId, createdAt: clock() },
        ],
      },
    }));
    report.blockReserved = true;
  } catch {
    // Offline, or the server said no (block limit, profile incomplete): billing continues with provisional numbers.
  }
}
