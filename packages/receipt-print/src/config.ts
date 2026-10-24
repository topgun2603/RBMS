/**
 * Printer settings. Two layers: shop defaults (settings namespace `printing`, shared by every counter of the shop)
 * and this device's own choices (localStorage; the printer is plugged into this PC, so transport and pairing are
 * always per device). Effective config = built-in defaults < shop defaults < device overrides.
 */

export type TransportKind = "none" | "usb" | "serial" | "bluetooth" | "bridge";
export const TRANSPORT_KINDS: TransportKind[] = ["none", "usb", "serial", "bluetooth", "bridge"];

export interface PrinterConfig {
  transport: TransportKind;
  /** 58 or 80 (mm). */
  paperWidth: 58 | 80;
  /** Characters per line in the text path. Default 32 (58 mm) / 48 (80 mm). */
  charsPerLine: number;
  /** Printable width in dots for the image path. Default 384 / 576. */
  widthDots: number;
  headerLines: string[];
  footerLines: string[];
  showLogo: boolean;
  /** UPI / e-invoice QR codes on the receipt. */
  showQr: boolean;
  autoPrint: boolean;
  openDrawerOnCash: boolean;
  cut: "partial" | "full" | "none";
  /** Cash-drawer connector pin: 0 = pin 2 (most drawers), 1 = pin 5. */
  drawerPin: 0 | 1;
  /** Serial (RS-232 / USB-serial / Bluetooth SPP) baud rate. */
  baudRate: number;
  /** Local print bridge (tools/print-bridge). */
  bridgeUrl: string;
  /** Device only, never a shop default. */
  bridgeToken: string;
  /** Name of the printer in the bridge's config. */
  bridgePrinter: string;
  /** What was paired on this device (USB "vid:pid", Bluetooth device id), so it reconnects without asking. */
  deviceHint: string;
  deviceName: string;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  transport: "none",
  paperWidth: 80,
  charsPerLine: 48,
  widthDots: 576,
  headerLines: [],
  footerLines: [],
  showLogo: false,
  showQr: true,
  autoPrint: false,
  openDrawerOnCash: true,
  cut: "partial",
  drawerPin: 0,
  baudRate: 9600,
  bridgeUrl: "http://127.0.0.1:9101",
  bridgeToken: "",
  bridgePrinter: "default",
  deviceHint: "",
  deviceName: "",
};

/** Keys the shop can set for every counter. Transport, pairing and the bridge token stay on the device. */
export const SHOP_DEFAULT_KEYS = [
  "paperWidth",
  "charsPerLine",
  "widthDots",
  "headerLines",
  "footerLines",
  "showLogo",
  "showQr",
  "autoPrint",
  "openDrawerOnCash",
  "cut",
  "drawerPin",
] as const satisfies readonly (keyof PrinterConfig)[];
export type ShopDefaultKey = (typeof SHOP_DEFAULT_KEYS)[number];
export type ShopPrintDefaults = Pick<PrinterConfig, ShopDefaultKey>;

export const defaultCharsPerLine = (w: 58 | 80) => (w === 58 ? 32 : 48);
export const defaultWidthDots = (w: 58 | 80) => (w === 58 ? 384 : 576);

const lines = (v: unknown, max = 6): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, max)
    : [];
const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/**
 * Sanitises a partial config from storage / the API: unknown keys are dropped, bad values are ignored (the key is
 * left out so a lower layer shows through). Never throws.
 */
export function sanitizeConfig(raw: unknown): Partial<PrinterConfig> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PrinterConfig> = {};
  if (typeof r.transport === "string" && (TRANSPORT_KINDS as string[]).includes(r.transport)) out.transport = r.transport as TransportKind;
  if (r.paperWidth === 58 || r.paperWidth === 80) out.paperWidth = r.paperWidth;
  if (r.charsPerLine !== undefined) out.charsPerLine = int(r.charsPerLine, 24, 64, NaN) || undefined!;
  if (r.widthDots !== undefined) out.widthDots = int(r.widthDots, 192, 832, NaN) || undefined!;
  if (Array.isArray(r.headerLines)) out.headerLines = lines(r.headerLines);
  if (Array.isArray(r.footerLines)) out.footerLines = lines(r.footerLines);
  for (const k of ["showLogo", "showQr", "autoPrint", "openDrawerOnCash"] as const) if (typeof r[k] === "boolean") out[k] = bool(r[k], false);
  if (r.cut === "partial" || r.cut === "full" || r.cut === "none") out.cut = r.cut;
  if (r.drawerPin === 0 || r.drawerPin === 1) out.drawerPin = r.drawerPin;
  if (r.baudRate !== undefined) out.baudRate = int(r.baudRate, 1200, 921600, 9600);
  if (typeof r.bridgeUrl === "string") out.bridgeUrl = str(r.bridgeUrl, 200, "");
  if (typeof r.bridgeToken === "string") out.bridgeToken = str(r.bridgeToken, 200, "");
  if (typeof r.bridgePrinter === "string") out.bridgePrinter = str(r.bridgePrinter, 80, "");
  if (typeof r.deviceHint === "string") out.deviceHint = str(r.deviceHint, 200, "");
  if (typeof r.deviceName === "string") out.deviceName = str(r.deviceName, 120, "");
  for (const k of Object.keys(out) as (keyof PrinterConfig)[]) if (out[k] === undefined || Number.isNaN(out[k] as number)) delete out[k];
  return out;
}

/** Built-in < shop defaults < device. A changed paper width re-derives characters and dots unless the layer set them. */
export function resolveConfig(shop?: unknown, device?: unknown): PrinterConfig {
  const s = sanitizeConfig(shop);
  const d = sanitizeConfig(device);
  // Shop defaults never carry device-only keys, even if the server returned them.
  for (const k of Object.keys(s) as (keyof PrinterConfig)[]) if (!(SHOP_DEFAULT_KEYS as readonly string[]).includes(k)) delete s[k];
  const merged = { ...DEFAULT_PRINTER_CONFIG, ...s, ...d };
  const width = merged.paperWidth;
  const layerSet = (key: "charsPerLine" | "widthDots") => d[key] !== undefined || s[key] !== undefined;
  if (!layerSet("charsPerLine")) merged.charsPerLine = defaultCharsPerLine(width);
  if (!layerSet("widthDots")) merged.widthDots = defaultWidthDots(width);
  return merged;
}

/** The shop-default subset of a config (what "Save as shop default" sends). */
export function pickShopDefaults(c: PrinterConfig): ShopPrintDefaults {
  const out = {} as Record<string, unknown>;
  for (const k of SHOP_DEFAULT_KEYS) out[k] = c[k];
  return out as unknown as ShopPrintDefaults;
}

// ---------------------------------------------------------------- device storage

/** The slice of Storage used (so tests can pass a Map-backed one). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const printConfigKey = (tenant: string | null | undefined) => `sr_print:cfg:${tenant ?? "-"}`;

export function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The device's own overrides (partial). Storage errors and bad JSON give {}. */
export function loadDeviceConfig(tenant: string | null | undefined, store: KeyValueStore | null = browserStore()): Partial<PrinterConfig> {
  try {
    const raw = store?.getItem(printConfigKey(tenant));
    return raw ? sanitizeConfig(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveDeviceConfig(tenant: string | null | undefined, patch: Partial<PrinterConfig>, store: KeyValueStore | null = browserStore()): Partial<PrinterConfig> {
  const next = { ...loadDeviceConfig(tenant, store), ...sanitizeConfig(patch) };
  try {
    store?.setItem(printConfigKey(tenant), JSON.stringify(next));
    if (typeof window !== "undefined" && store === window.localStorage) window.dispatchEvent(new CustomEvent("sr-print-config", { detail: tenant ?? "-" }));
  } catch {
    // Private mode / quota: printing works for this session only.
  }
  return next;
}

/** Removes the given keys from the device overrides (so the shop defaults show through again). */
export function clearDeviceKeys(tenant: string | null | undefined, keys: readonly (keyof PrinterConfig)[], store: KeyValueStore | null = browserStore()): Partial<PrinterConfig> {
  const next = { ...loadDeviceConfig(tenant, store) };
  for (const k of keys) delete next[k];
  try {
    store?.setItem(printConfigKey(tenant), JSON.stringify(next));
    if (typeof window !== "undefined" && store === window.localStorage) window.dispatchEvent(new CustomEvent("sr-print-config", { detail: tenant ?? "-" }));
  } catch {
    // ignore
  }
  return next;
}

export function clearDeviceConfig(tenant: string | null | undefined, store: KeyValueStore | null = browserStore()) {
  try {
    store?.removeItem(printConfigKey(tenant));
  } catch {
    // ignore
  }
}

/** True when a direct printer is chosen on this device. */
export const isDirectConfigured = (c: PrinterConfig) => c.transport !== "none";
