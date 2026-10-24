import type { CachedCustomer, LocalBlock, NumberingState, QueuedBill } from "./types";

/**
 * Where the offline queue lives. The browser implementation is IndexedDB (store-idb.ts); the in-memory one below is
 * used when IndexedDB is unavailable (private mode) and by the tests. Both run `transact` as one atomic step, so two
 * tabs of the same counter can't take the same reserved number.
 */

export interface TransactResult<T> {
  result: T;
  putBills?: QueuedBill[];
  /** Replaces the numbering state (blocks + provisional counter). */
  numbering?: NumberingState;
}

export interface OfflineStore {
  /** Survives a reload (IndexedDB). False = in memory only. */
  readonly persistent: boolean;
  /** Reads the numbering state, runs `fn` synchronously, writes what it returns: all in one transaction. */
  transact<T>(fn: (numbering: NumberingState) => TransactResult<T>): Promise<T>;
  numbering(): Promise<NumberingState>;
  setNumbering(state: NumberingState): Promise<void>;
  getBill(clientId: string): Promise<QueuedBill | null>;
  listBills(): Promise<QueuedBill[]>;
  putBills(bills: QueuedBill[]): Promise<void>;
  deleteBills(clientIds: string[]): Promise<void>;
  putCustomers(customers: CachedCustomer[]): Promise<void>;
  /** Cached customers, most recently seen first. */
  listCustomers(): Promise<CachedCustomer[]>;
  /** Small values (the device id, the local order counter ...). */
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export const EMPTY_NUMBERING: NumberingState = { blocks: [], counter: 0, order: 0 };
export const MAX_CACHED_CUSTOMERS = 500;

export class MemoryOfflineStore implements OfflineStore {
  readonly persistent = false;
  private bills = new Map<string, QueuedBill>();
  private customers = new Map<string, CachedCustomer>();
  private meta = new Map<string, unknown>();
  private state: NumberingState = EMPTY_NUMBERING;
  private chain: Promise<unknown> = Promise.resolve();

  async transact<T>(fn: (numbering: NumberingState) => TransactResult<T>): Promise<T> {
    const run = this.chain.then(() => {
      const out = fn(structuredClone(this.state));
      if (out.numbering) this.state = structuredClone(out.numbering);
      for (const b of out.putBills ?? []) this.bills.set(b.clientId, structuredClone(b));
      return out.result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
  async numbering() {
    return structuredClone(this.state);
  }
  async setNumbering(state: NumberingState) {
    this.state = structuredClone(state);
  }
  async getBill(clientId: string) {
    const b = this.bills.get(clientId);
    return b ? structuredClone(b) : null;
  }
  async listBills() {
    return [...this.bills.values()].map((b) => structuredClone(b)).sort((a, b) => a.order - b.order);
  }
  async putBills(bills: QueuedBill[]) {
    for (const b of bills) this.bills.set(b.clientId, structuredClone(b));
  }
  async deleteBills(ids: string[]) {
    for (const id of ids) this.bills.delete(id);
  }
  async putCustomers(customers: CachedCustomer[]) {
    for (const c of customers) this.customers.set(c.id, { ...c });
    if (this.customers.size > MAX_CACHED_CUSTOMERS) {
      const keep = [...this.customers.values()].sort((a, b) => b.seenAt - a.seenAt).slice(0, MAX_CACHED_CUSTOMERS);
      this.customers = new Map(keep.map((c) => [c.id, c]));
    }
  }
  async listCustomers() {
    return [...this.customers.values()].sort((a, b) => b.seenAt - a.seenAt).map((c) => ({ ...c }));
  }
  async getMeta<T>(key: string) {
    return (this.meta.has(key) ? (structuredClone(this.meta.get(key)) as T) : null) as T | null;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, structuredClone(value));
  }
}
