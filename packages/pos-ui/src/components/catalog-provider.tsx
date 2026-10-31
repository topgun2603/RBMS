"use client";

import * as React from "react";
import { ApiError } from "@rbms/web";
import { openCatalogStore } from "../lib/catalog-idb";
import { buildCatalogIndex, emptySnapshot, snapshotFrom, syncCatalog, type CatalogIndex, type CatalogSnapshot, type CatalogStore } from "../lib/catalog-sync";
import { readPricing, writePricing } from "../lib/pricing-idb";
import { fetchCatalogPage, fetchPosCategories, fetchPricingCache } from "../lib/terminal-api";
import type { PricingCache } from "../lib/units";
import type { PosCategory } from "../lib/terminal-types";

/**
 * The full POS catalogue on this device (GET /v1/pos/catalog): loaded from IndexedDB first so the grid opens at once
 * and search works offline, then synced (delta with the saved cursor) on open, every few minutes and when the window
 * gets focus. When the endpoint isn't there (older API, feature off) `available` is false and the counter keeps its
 * server search.
 */

export interface CatalogValue {
  /** The endpoint answered (or a saved cache exists). False = use the old server search. */
  available: boolean;
  /** A cache (saved or synced) is loaded. */
  ready: boolean;
  syncing: boolean;
  /** The last sync failed (offline): the saved cache is in use. */
  stale: boolean;
  count: number;
  syncedAt: number | null;
  index: CatalogIndex | null;
  categories: PosCategory[];
  /** Price lists for offline pricing (null = none / the feature is off). */
  pricing: PricingCache | null;
  sync: () => void;
}

const OFF: CatalogValue = { available: false, ready: false, syncing: false, stale: false, count: 0, syncedAt: null, index: null, categories: [], pricing: null, sync: () => undefined };

const CatalogContext = React.createContext<CatalogValue>(OFF);
export const useCatalog = () => React.useContext(CatalogContext);

const SYNC_EVERY = 3 * 60_000;
const FOCUS_MIN_GAP = 30_000;

export function CatalogProvider({ enabled, tenant, children }: { enabled: boolean; tenant: string | null; children: React.ReactNode }) {
  const [snap, setSnap] = React.useState<CatalogSnapshot>(emptySnapshot);
  const [index, setIndex] = React.useState<CatalogIndex | null>(null);
  const [ready, setReady] = React.useState(false);
  const [available, setAvailable] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [categories, setCategories] = React.useState<PosCategory[]>([]);
  const [pricing, setPricing] = React.useState<PricingCache | null>(null);
  const snapRef = React.useRef(snap);
  const storeRef = React.useRef<CatalogStore | null>(null);
  const inflight = React.useRef(false);
  const lastTry = React.useRef(0);
  const indexBuilt = React.useRef(false);
  const tenantRef = React.useRef(tenant);
  tenantRef.current = tenant;

  const sync = React.useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    lastTry.current = Date.now();
    setSyncing(true);
    try {
      const r = await syncCatalog(snapRef.current, (q) => fetchCatalogPage(q), storeRef.current);
      snapRef.current = r.snapshot;
      setSnap(r.snapshot);
      if (r.changed || !indexBuilt.current) {
        indexBuilt.current = true;
        setIndex(buildCatalogIndex(r.snapshot.items.values()));
      }
      setReady(true);
      setAvailable(true);
      setStale(false);
      fetchPosCategories()
        .then(setCategories)
        .catch(() => undefined);
      // Price lists ride along with the catalogue (403 / 404 = the shop has none: no list pricing).
      fetchPricingCache()
        .then((c) => {
          setPricing(c);
          void writePricing(tenantRef.current, c);
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 402)) setPricing(null);
        });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403 || err.status === 402 || err.status === 400)) {
        // No POS catalogue for this session: fall back unless a saved cache exists.
        if (snapRef.current.items.size === 0) setAvailable(false);
        else setStale(true);
      } else setStale(true);
    } finally {
      inflight.current = false;
      setSyncing(false);
    }
  }, []);

  // Saved cache first, then the first sync.
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const store = await openCatalogStore(tenant);
      if (cancelled) return;
      storeRef.current = store;
      const savedPricing = await readPricing(tenant);
      if (!cancelled && savedPricing) setPricing(savedPricing);
      const saved = store ? await store.read() : null;
      if (cancelled) return;
      if (saved && saved.items.length) {
        const s = snapshotFrom(saved);
        snapRef.current = s;
        setSnap(s);
        indexBuilt.current = true;
        setIndex(buildCatalogIndex(s.items.values()));
        setReady(true);
      }
      void sync();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, tenant, sync]);

  // Every few minutes, and on focus / back to the tab.
  React.useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => void sync(), SYNC_EVERY);
    const onFocus = () => {
      if (document.visibilityState === "visible" && Date.now() - lastTry.current > FOCUS_MIN_GAP) void sync();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [enabled, sync]);

  const value = React.useMemo<CatalogValue>(
    () =>
      enabled
        ? { available, ready, syncing, stale, count: snap.items.size, syncedAt: snap.syncedAt, index, categories, pricing, sync: () => void sync() }
        : OFF,
    [enabled, available, ready, syncing, stale, snap, index, categories, pricing, sync],
  );
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}
