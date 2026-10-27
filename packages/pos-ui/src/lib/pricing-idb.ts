"use client";

import type { PricingCache } from "./units";

/**
 * The POS price-list cache on this device (IndexedDB `sr_pos_pricing:<shop>`, one record), so wholesale prices and
 * slabs work offline. Every call is guarded: without IndexedDB it reads null and writes nothing.
 */
const STORE = "kv";

function open(shop: string | null): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(`sr_pos_pricing:${shop ?? "-"}`, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readPricing(shop: string | null): Promise<PricingCache | null> {
  const db = await open(shop);
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const g = db.transaction(STORE, "readonly").objectStore(STORE).get("cache");
      g.onsuccess = () => resolve((g.result as PricingCache | undefined) ?? null);
      g.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writePricing(shop: string | null, cache: PricingCache): Promise<void> {
  const db = await open(shop);
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(cache, "cache");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
