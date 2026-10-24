"use client";

import { EMPTY_NUMBERING, MAX_CACHED_CUSTOMERS, type OfflineStore, type TransactResult } from "./store";
import type { CachedCustomer, NumberingState, QueuedBill } from "./types";

/**
 * IndexedDB store of the offline queue: one database per shop (`sr_pos_offline:<shop>`) with `bills` (by clientId),
 * `customers` (by id) and `meta` (numbering state, device id ...). `openOfflineStore` returns null when IndexedDB is
 * unavailable; the counter then keeps the queue in memory and warns that it won't survive a reload.
 */

const VERSION = 1;
const NUMBERING = "numbering";

const req = <T,>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function openOfflineStore(shop: string | null): Promise<OfflineStore | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    const open = indexedDB.open(`sr_pos_offline:${shop ?? "-"}`, VERSION);
    open.onupgradeneeded = () => {
      const d = open.result;
      if (!d.objectStoreNames.contains("bills")) d.createObjectStore("bills", { keyPath: "clientId" });
      if (!d.objectStoreNames.contains("customers")) d.createObjectStore("customers", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    db = await req(open);
  } catch {
    return null;
  }

  return {
    persistent: true,
    async transact<T>(fn: (n: NumberingState) => TransactResult<T>): Promise<T> {
      const tx = db.transaction(["bills", "meta"], "readwrite");
      const meta = tx.objectStore("meta");
      const saved = (await req(meta.get(NUMBERING) as IDBRequest<NumberingState | undefined>)) ?? EMPTY_NUMBERING;
      // Synchronous from here to the writes: the transaction stays open, and no other tab can slip in between.
      const out = fn(saved);
      if (out.numbering) meta.put(out.numbering, NUMBERING);
      for (const b of out.putBills ?? []) tx.objectStore("bills").put(b);
      await done(tx);
      return out.result;
    },
    async numbering() {
      const tx = db.transaction("meta", "readonly");
      return (await req(tx.objectStore("meta").get(NUMBERING) as IDBRequest<NumberingState | undefined>)) ?? EMPTY_NUMBERING;
    },
    async setNumbering(state) {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put(state, NUMBERING);
      await done(tx);
    },
    async getBill(clientId) {
      const tx = db.transaction("bills", "readonly");
      return (await req(tx.objectStore("bills").get(clientId) as IDBRequest<QueuedBill | undefined>)) ?? null;
    },
    async listBills() {
      const tx = db.transaction("bills", "readonly");
      const all = await req(tx.objectStore("bills").getAll() as IDBRequest<QueuedBill[]>);
      return all.sort((a, b) => a.order - b.order);
    },
    async putBills(bills) {
      if (!bills.length) return;
      const tx = db.transaction("bills", "readwrite");
      for (const b of bills) tx.objectStore("bills").put(b);
      await done(tx);
    },
    async deleteBills(ids) {
      if (!ids.length) return;
      const tx = db.transaction("bills", "readwrite");
      for (const id of ids) tx.objectStore("bills").delete(id);
      await done(tx);
    },
    async putCustomers(customers) {
      if (!customers.length) return;
      const tx = db.transaction("customers", "readwrite");
      const store = tx.objectStore("customers");
      for (const c of customers) store.put(c);
      const all = await req(store.getAll() as IDBRequest<CachedCustomer[]>);
      if (all.length > MAX_CACHED_CUSTOMERS) {
        // Oldest-seen first out. (The puts above are queued ahead of this read, so it sees them.)
        for (const c of all.sort((a, b) => a.seenAt - b.seenAt).slice(0, all.length - MAX_CACHED_CUSTOMERS)) store.delete(c.id);
      }
      await done(tx);
    },
    async listCustomers() {
      const tx = db.transaction("customers", "readonly");
      const all = await req(tx.objectStore("customers").getAll() as IDBRequest<CachedCustomer[]>);
      return all.sort((a, b) => b.seenAt - a.seenAt);
    },
    async getMeta<T>(key: string) {
      const tx = db.transaction("meta", "readonly");
      return ((await req(tx.objectStore("meta").get(key))) ?? null) as T | null;
    },
    async setMeta(key, value) {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put(value, key);
      await done(tx);
    },
  };
}
