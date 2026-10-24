import { loadLogoBitmap } from "./canvas";
import { loadDeviceConfig, resolveConfig, type KeyValueStore, type PrinterConfig, browserStore } from "./config";
import { printReceiptDirect, type DirectFailure, type DirectOptions } from "./direct";
import type { ReceiptData } from "./receipt";

/** Fetches the shop defaults (`GET /settings/printing` -> values). Supplied by the UI so this package has no HTTP client. */
export type ShopDefaultsLoader = () => Promise<unknown>;

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const TTL_MS = 60_000;

/** Shop defaults for printing, cached for a minute per shop. A failing or forbidden request is treated as "no defaults". */
export function loadShopDefaults(tenant: string | null | undefined, load: ShopDefaultsLoader, now = Date.now()): Promise<unknown> {
  const key = tenant ?? "-";
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = load().catch(() => ({}));
  cache.set(key, { at: now, value });
  return value;
}

export function invalidateShopDefaults(tenant?: string | null) {
  if (tenant === undefined) cache.clear();
  else cache.delete(tenant ?? "-");
}

/** Effective config for this device: built-in < shop defaults < device overrides. */
export async function resolvePrinterConfig(
  tenant: string | null | undefined,
  load: ShopDefaultsLoader,
  store: KeyValueStore | null = browserStore(),
): Promise<PrinterConfig> {
  const shop = await loadShopDefaults(tenant, load);
  return resolveConfig(shop, loadDeviceConfig(tenant, store));
}

export type DirectOutcome = { handled: true; raster: boolean } | { handled: false; reason: DirectFailure; message?: string };

/**
 * The one call the Print buttons make: prints on the direct printer when this device has one configured. When it
 * returns `handled: false` the caller uses the browser print as before (`reason: "not_configured"` needs no message;
 * any other reason is worth a short note: "printer not reachable, printed through the browser instead").
 */
export async function printDirectIfConfigured(o: {
  tenant: string | null | undefined;
  loadShop: ShopDefaultsLoader;
  receipt: ReceiptData | ((config: PrinterConfig) => ReceiptData);
  /** The shop logo; printed only when "Print logo" is on for this device / shop. */
  logoUrl?: string | null;
  /** Kick the drawer with this print (cash was taken). */
  drawer?: boolean;
  direct?: DirectOptions;
  store?: KeyValueStore | null;
}): Promise<DirectOutcome> {
  const config = await resolvePrinterConfig(o.tenant, o.loadShop, o.store);
  if (config.transport === "none") return { handled: false, reason: "not_configured" };
  const data = typeof o.receipt === "function" ? o.receipt(config) : o.receipt;
  const logo = config.showLogo && o.logoUrl ? await loadLogoBitmap(o.logoUrl, Math.floor(config.widthDots * 0.6)) : null;
  const res = await printReceiptDirect(config, data, { interactive: true, logo, ...o.direct, drawer: o.drawer && config.openDrawerOnCash });
  return res.ok ? { handled: true, raster: res.raster } : { handled: false, reason: res.code, message: res.message };
}
