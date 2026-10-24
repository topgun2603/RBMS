import { SHOP_DEFAULT_KEYS, defaultCharsPerLine, defaultWidthDots, sanitizeConfig, type PrinterConfig } from "@srirealtime/receipt-print";

/** The Printing settings form: numbers and line lists as text so typing is never fought. Pure, unit-tested. */
export interface PrintForm {
  transport: PrinterConfig["transport"];
  baudRate: string;
  bridgeUrl: string;
  bridgeToken: string;
  bridgePrinter: string;
  paperWidth: "58" | "80";
  charsPerLine: string;
  widthDots: string;
  headerText: string;
  footerText: string;
  showLogo: boolean;
  showQr: boolean;
  autoPrint: boolean;
  openDrawerOnCash: boolean;
  cut: PrinterConfig["cut"];
  drawerPin: "0" | "1";
}

export const DEVICE_KEYS = ["transport", "baudRate", "bridgeUrl", "bridgeToken", "bridgePrinter"] as const satisfies readonly (keyof PrinterConfig)[];

export function formFromConfig(c: PrinterConfig): PrintForm {
  return {
    transport: c.transport,
    baudRate: String(c.baudRate),
    bridgeUrl: c.bridgeUrl,
    bridgeToken: c.bridgeToken,
    bridgePrinter: c.bridgePrinter,
    paperWidth: c.paperWidth === 58 ? "58" : "80",
    charsPerLine: String(c.charsPerLine),
    widthDots: String(c.widthDots),
    headerText: c.headerLines.join("\n"),
    footerText: c.footerLines.join("\n"),
    showLogo: c.showLogo,
    showQr: c.showQr,
    autoPrint: c.autoPrint,
    openDrawerOnCash: c.openDrawerOnCash,
    cut: c.cut,
    drawerPin: c.drawerPin === 1 ? "1" : "0",
  };
}

const inRange = (s: string, lo: number, hi: number) => /^\d+$/.test(s.trim()) && Number(s) >= lo && Number(s) <= hi;

export interface FormErrors {
  charsPerLine?: true;
  widthDots?: true;
  baudRate?: true;
  headerText?: true;
  footerText?: true;
  bridgeUrl?: true;
  bridgeToken?: true;
}

const lineList = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function validateForm(f: PrintForm): FormErrors {
  const e: FormErrors = {};
  if (!inRange(f.charsPerLine, 24, 64)) e.charsPerLine = true;
  if (!inRange(f.widthDots, 192, 832)) e.widthDots = true;
  if (!inRange(f.baudRate, 1200, 921600)) e.baudRate = true;
  if (lineList(f.headerText).length > 6 || lineList(f.headerText).some((l) => l.length > 64)) e.headerText = true;
  if (lineList(f.footerText).length > 6 || lineList(f.footerText).some((l) => l.length > 64)) e.footerText = true;
  if (f.transport === "bridge") {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(f.bridgeUrl.trim())) e.bridgeUrl = true;
    if (f.bridgeToken.trim().length < 16) e.bridgeToken = true;
  }
  return e;
}

/** Config fields from the form, sanitised. */
export function configFromForm(f: PrintForm): Partial<PrinterConfig> {
  return sanitizeConfig({
    transport: f.transport,
    baudRate: Number(f.baudRate),
    bridgeUrl: f.bridgeUrl.trim(),
    bridgeToken: f.bridgeToken.trim(),
    bridgePrinter: f.bridgePrinter.trim() || "default",
    paperWidth: Number(f.paperWidth),
    charsPerLine: Number(f.charsPerLine),
    widthDots: Number(f.widthDots),
    headerLines: lineList(f.headerText),
    footerLines: lineList(f.footerText),
    showLogo: f.showLogo,
    showQr: f.showQr,
    autoPrint: f.autoPrint,
    openDrawerOnCash: f.openDrawerOnCash,
    cut: f.cut,
    drawerPin: Number(f.drawerPin),
  });
}

export const pickKeys = <T extends object>(o: T, keys: readonly (keyof T)[]): Partial<T> => {
  const out: Partial<T> = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
};

/** Switching paper width moves characters per line and dots to that width's defaults. */
export function withPaperWidth(f: PrintForm, w: "58" | "80"): PrintForm {
  const n = w === "58" ? 58 : 80;
  return { ...f, paperWidth: w, charsPerLine: String(defaultCharsPerLine(n)), widthDots: String(defaultWidthDots(n)) };
}

export const LAYOUT_KEYS = SHOP_DEFAULT_KEYS;
