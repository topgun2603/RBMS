"use client";

import * as React from "react";
import {
  invalidateShopDefaults,
  loadDeviceConfig,
  logDrawer,
  openDrawerDirect,
  pickShopDefaults,
  printConfigKey,
  receiptFromInvoice,
  resolveConfig,
  resolvePrinterConfig,
  saveDeviceConfig,
  type DirectFailure,
  type PrinterConfig,
  type ReceiptData,
  type ReceiptLocale,
} from "@rbms/receipt-print";
import { api } from "@rbms/web";
import { upiLink } from "@rbms/gst";
import { isProvisionalSlip } from "./offline/bill";
import type { Invoice, SellerProfile } from "./types";

/** `GET /settings/printing` values: the shop's layout defaults for direct receipt printing. */
export const fetchShopPrinting = () => api<{ values?: Record<string, unknown> }>("/settings/printing").then((r) => r.values ?? {});

/** Saves this config's layout fields as the shop default (owner / admin only: the API answers 403 otherwise). */
export async function saveShopPrinting(tenant: string | null, config: PrinterConfig) {
  const r = await api<{ values: Record<string, unknown> }>("/settings/printing/tenant", { method: "PUT", body: pickShopDefaults(config) });
  invalidateShopDefaults(tenant);
  return r.values;
}

export interface PrinterState {
  /** Effective config: built-in < shop defaults < this device. */
  config: PrinterConfig;
  shop: Record<string, unknown>;
  device: Partial<PrinterConfig>;
  loading: boolean;
  /** Merges into this device's saved config. */
  save: (patch: Partial<PrinterConfig>) => void;
  /** Re-reads the shop defaults from the server. */
  reloadShop: () => void;
}

/** This device's own saved overrides, following changes from other tabs and other components (no network). */
export function useDeviceConfig(tenant: string | null | undefined): [Partial<PrinterConfig>, (patch: Partial<PrinterConfig>) => void] {
  const [device, setDevice] = React.useState<Partial<PrinterConfig>>({});
  React.useEffect(() => {
    const read = () => setDevice(loadDeviceConfig(tenant));
    read();
    const key = printConfigKey(tenant);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) read();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sr-print-config", read);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sr-print-config", read);
    };
  }, [tenant]);
  const save = React.useCallback((patch: Partial<PrinterConfig>) => setDevice(saveDeviceConfig(tenant, patch)), [tenant]);
  return [device, save];
}

/** Effective printer config for the shop on this device (shop defaults fetched from the API). */
export function usePrinterConfig(tenant: string | null | undefined): PrinterState {
  const [device, save] = useDeviceConfig(tenant);
  const [shop, setShop] = React.useState<Record<string, unknown>>({});
  const [loading, setLoading] = React.useState(true);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    fetchShopPrinting()
      .catch(() => ({}))
      .then((v) => {
        if (!live) return;
        setShop(v);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tenant, tick]);

  const reloadShop = React.useCallback(() => {
    invalidateShopDefaults(tenant);
    setTick((n) => n + 1);
  }, [tenant]);
  const config = React.useMemo(() => resolveConfig(shop, device), [shop, device]);
  return { config, shop, device, loading, save, reloadShop };
}

/** The receipt the PDF prints, from the issued bill (the same totals the server returned). */
export function saleReceipt(
  inv: Invoice,
  o: { locale: string; shopName: string; seller: Partial<SellerProfile>; branchName?: string | null; cashier?: string | null; change: number; time: string },
): ReceiptData {
  const locale: ReceiptLocale = o.locale === "ta" ? "ta" : "en";
  return receiptFromInvoice(inv, {
    locale,
    shopName: o.shopName,
    branchName: o.branchName,
    seller: o.seller,
    cashier: o.cashier,
    change: o.change,
    time: o.time,
    provisional: isProvisionalSlip(inv),
    upiLink: (x) => upiLink({ vpa: x.vpa, name: x.name, amountPaise: x.amountPaise, note: x.note }),
  });
}

/** Short user-facing reason key for a failed direct print (pos.print.direct.*). */
export function failureKey(code: DirectFailure): string {
  switch (code) {
    case "not_paired":
      return "pos.printing.err.notPaired";
    case "unsupported":
    case "unsupported_url":
      return "pos.printing.err.unsupported";
    case "cancelled":
      return "pos.printing.err.cancelled";
    case "bridge_unreachable":
      return "pos.printing.err.bridgeDown";
    case "bridge_rejected":
      return "pos.printing.err.bridgeRejected";
    case "no_endpoint":
      return "pos.printing.err.noEndpoint";
    default:
      return "pos.printing.err.io";
  }
}

export type DrawerOutcome = { opened: true } | { opened: false; reason: DirectFailure };

/**
 * Opens the cash drawer through the direct printer. Every attempt is logged on this device (lib `logDrawer`); the
 * caller shows any message. `kind` is "no_sale" for the button, "cash_sale" for the automatic kick after cash.
 */
export async function kickDrawer(o: { tenant: string | null | undefined; kind: "no_sale" | "cash_sale" | "test"; user?: string | null; interactive: boolean }): Promise<DrawerOutcome> {
  const config = await resolvePrinterConfig(o.tenant, fetchShopPrinting);
  if (config.transport === "none") return { opened: false, reason: "not_configured" };
  const res = await openDrawerDirect(config, { interactive: o.interactive });
  logDrawer({ kind: o.kind, user: o.user, ok: res.ok, note: res.ok ? undefined : res.code });
  return res.ok ? { opened: true } : { opened: false, reason: res.code };
}
