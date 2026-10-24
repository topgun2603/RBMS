"use client";

import type { CatalogChange, CatalogStore } from "./catalog-sync";
import type { PosItem } from "./terminal-types";

/**
 * IndexedDB store of the POS catalogue cache: one database per shop (`sr_pos_catalog:<shop>`), an `items` store keyed
 * by itemId and a `meta` record with the cursor. Every call is guarded: without IndexedDB (private mode, blocked
 * storage) `openCatalogStore` returns null and the counter keeps the cache in memory.
 */

const VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openCatalogStore(shop: string | null): Promise<CatalogStore | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    const open = indexedDB.open(`sr_pos_catalog:${shop ?? "-"}`, VERSION);
    open.onupgradeneeded = () => {
      const d = open.result;
      if (!d.objectStoreNames.contains("items")) d.createObjectStore("items", { keyPath: "itemId" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    db = await req(open);
  } catch {
    return null;
  }
  return {
    async read() {
      try {
        const tx = db.transaction(["items", "meta"], "readonly");
        const [items, meta] = await Promise.all([
          req(tx.objectStore("items").getAll() as IDBRequest<PosItem[]>),
          req(tx.objectStore("meta").get("sync") as IDBRequest<{ cursor: string | null; syncedAt: number | null } | undefined>),
        ]);
        if (!meta) return null;
        return { items, cursor: meta.cursor, syncedAt: meta.syncedAt };
      } catch {
        return null;
      }
    },
    async write(change: CatalogChange) {
      const tx = db.transaction(["items", "meta"], "readwrite");
      const items = tx.objectStore("items");
      if (change.replace) items.clear();
      for (const id of change.removes) items.delete(id);
      for (const it of change.upserts) items.put(it);
      tx.objectStore("meta").put({ cursor: change.cursor, syncedAt: change.syncedAt }, "sync");
      await done(tx);
    },
  };
}
