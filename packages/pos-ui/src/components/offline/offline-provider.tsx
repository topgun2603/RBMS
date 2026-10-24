"use client";

import * as React from "react";
import { toast } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { todayIST } from "../../lib/format";
import { reportNetwork } from "../../lib/online";
import { createOfflineApi } from "../../lib/offline/api";
import { setCustomerCache } from "../../lib/offline/customers";
import { newClientId, OfflineQueue, countBills, type QueueCounts, type SaleInput } from "../../lib/offline/queue";
import { MemoryOfflineStore, type OfflineStore } from "../../lib/offline/store";
import { openOfflineStore } from "../../lib/offline/store-idb";
import { syncQueue, type SyncReport } from "../../lib/offline/sync";
import type { QueuedBill } from "../../lib/offline/types";
import { usePos } from "../pos-context";

/**
 * Offline billing for the counter (docs/offline-billing.md): opens the queue (IndexedDB, else memory), syncs it when the
 * connection is back and on "Sync now", keeps the pending count for the banner and the logout guard, and exposes the
 * actions of the Pending bills screen.
 */

export interface OfflineValue {
  ready: boolean;
  /** The queue survives a reload. False = memory only (private mode): warn the cashier. */
  persistent: boolean;
  deviceId: string;
  bills: QueuedBill[];
  counts: QueueCounts;
  syncing: boolean;
  lastReport: SyncReport | null;
  lastSyncAt: number | null;
  enqueue: (sale: SaleInput) => Promise<QueuedBill>;
  syncNow: () => Promise<SyncReport | null>;
  retry: (clientId: string) => Promise<void>;
  voidBill: (clientId: string, reason: string) => Promise<boolean>;
  exportJson: () => Promise<string>;
  refresh: () => Promise<void>;
}

const EMPTY_COUNTS: QueueCounts = { queued: 0, syncing: 0, failed: 0, synced: 0, voided: 0, pending: 0, flagged: 0 };

const OfflineContext = React.createContext<OfflineValue | null>(null);

export function useOffline(): OfflineValue {
  const v = React.useContext(OfflineContext);
  if (!v) throw new Error("useOffline must be used inside <OfflineProvider>");
  return v;
}

/** Sync every minute while bills wait and the connection is up. */
const SYNC_EVERY = 60_000;

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { tenant, terminal, online, cashier } = usePos();
  const { t } = useI18n();
  const [queue, setQueue] = React.useState<OfflineQueue | null>(null);
  const [persistent, setPersistent] = React.useState(true);
  const [bills, setBills] = React.useState<QueuedBill[]>([]);
  const [syncing, setSyncing] = React.useState(false);
  const [lastReport, setLastReport] = React.useState<SyncReport | null>(null);
  const [lastSyncAt, setLastSyncAt] = React.useState<number | null>(null);
  const queueRef = React.useRef<OfflineQueue | null>(null);
  const onlineRef = React.useRef(online.online);
  onlineRef.current = online.online;
  const tRef = React.useRef(t);
  tRef.current = t;

  // Open the store; the device id is the paired terminal's id, else one made for this browser.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const idb = await openOfflineStore(tenant);
      const store: OfflineStore = idb ?? new MemoryOfflineStore();
      let deviceId: string | null = terminal?.device.terminal.id ?? (await store.getMeta<string>("deviceId"));
      if (!deviceId) {
        deviceId = `web-${newClientId()}`;
        await store.setMeta("deviceId", deviceId);
      }
      if (cancelled) return;
      const q = new OfflineQueue(store, deviceId);
      queueRef.current = q;
      setCustomerCache(idb);
      setPersistent(!!idb);
      setQueue(q);
      await q.prune().catch(() => undefined);
      setBills(await q.list());
    })();
    return () => {
      cancelled = true;
      queueRef.current = null;
      setCustomerCache(null);
    };
  }, [tenant, terminal?.device.terminal.id]);

  const refresh = React.useCallback(async () => {
    const q = queueRef.current;
    if (q) setBills(await q.list());
  }, []);

  const running = React.useRef(false);
  const syncNow = React.useCallback(
    async (force = true): Promise<SyncReport | null> => {
      const q = queueRef.current;
      if (!q || running.current) return null;
      running.current = true;
      setSyncing(true);
      try {
        const report = await syncQueue({
          store: q.store,
          api: createOfflineApi(q.deviceId),
          today: todayIST(),
          force,
          // Numbers are reserved from the server only on a store that survives a reload, or they'd leak on every reload.
          topUp: q.store.persistent,
        });
        if (report.offline) reportNetwork(false);
        else if (!report.refused) reportNetwork(true);
        setLastReport(report);
        setLastSyncAt(Date.now());
        await refresh();
        if (report.synced + report.voided > 0 && !report.failed) toast.success(tRef.current("pos.off.syncedToast", { count: report.synced + report.voided }));
        else if (report.failed > 0) toast.warning(tRef.current("pos.off.failedToast", { count: report.failed }));
        return report;
      } finally {
        running.current = false;
        setSyncing(false);
      }
    },
    [refresh],
  );

  // Back online (or the first look): reserve numbers and send what waits. Quietly: no toast when there is nothing.
  const wasOnline = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (!queue) return;
    if (online.online && wasOnline.current !== true) void syncNow(false);
    wasOnline.current = online.online;
  }, [online.online, queue, syncNow]);

  // While bills wait and the connection is up, try again every minute (failed ones follow their retry delay).
  const pending = countBills(bills).pending;
  React.useEffect(() => {
    if (!queue || !online.online || pending === 0) return;
    const id = window.setInterval(() => void syncNow(false), SYNC_EVERY);
    return () => window.clearInterval(id);
  }, [queue, online.online, pending, syncNow]);

  // Closing the tab with unsynced bills asks first (they are safe on this device, but not on the server yet).
  React.useEffect(() => {
    if (pending === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending]);

  const value = React.useMemo<OfflineValue>(
    () => ({
      ready: !!queue,
      persistent,
      deviceId: queue?.deviceId ?? "",
      bills,
      counts: queue ? countBills(bills) : EMPTY_COUNTS,
      syncing,
      lastReport,
      lastSyncAt,
      enqueue: async (sale) => {
        const q = queueRef.current;
        if (!q) throw new Error("The offline queue is not ready");
        const bill = await q.enqueueSale(sale);
        await refresh();
        return bill;
      },
      syncNow: () => syncNow(true),
      retry: async (id) => {
        await queueRef.current?.retry(id);
        await refresh();
        if (onlineRef.current) void syncNow(true);
      },
      voidBill: async (id, reason) => {
        const out = await queueRef.current?.voidBill(id, reason);
        await refresh();
        if (out && onlineRef.current) void syncNow(false);
        return !!out;
      },
      exportJson: async () => (queueRef.current ? queueRef.current.exportJson({ shop: tenant, cashier, terminal: terminal?.device.terminal.name ?? null }) : "{}"),
      refresh,
    }),
    [queue, persistent, bills, syncing, lastReport, lastSyncAt, syncNow, refresh, tenant, cashier, terminal],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
