import { canRasterize, createCanvasRasterizer, loadLogoBitmap, prepareRaster } from "./canvas";
import { defaultCharsPerLine, defaultWidthDots, isDirectConfigured, type PrinterConfig } from "./config";
import type { MonoBitmap } from "./escpos";
import { drawerKickBytes, formatReceipt, rowsToBytes, testPageRows, type ReceiptData, type Row } from "./receipt";
import { browserEnv, selectTransport } from "./transport/select";
import { PrintError, type PairedDevice, type PrintEnv, type PrintErrorCode, type Transport } from "./transport/types";

export type DirectFailure = PrintErrorCode | "not_configured" | "unsupported_url";

export type DirectResult =
  | { ok: true; raster: boolean; lossy: boolean; paired?: PairedDevice }
  | { ok: false; code: DirectFailure; message?: string };

export interface DirectOptions {
  env?: PrintEnv;
  /** A user gesture is in progress: the pairing picker may open. Auto-print after a sale passes false. */
  interactive?: boolean;
  /** Override the canvas rasterizer (tests, workers). */
  rasterize?: (rows: Row[], widthDots: number) => MonoBitmap | null;
  /** Logo bitmap already loaded (see `loadLogoBitmap`). */
  logo?: MonoBitmap | null;
  /** Kick the drawer with this receipt (cash sales). */
  drawer?: boolean;
}

const sessions = new Map<string, Session>();

/** One open connection per printer, writes queued one after another. */
class Session {
  private queue: Promise<unknown> = Promise.resolve();
  private ready = false;
  constructor(readonly transport: Transport) {}

  async ensure(interactive: boolean): Promise<PairedDevice | undefined> {
    if (this.ready) return undefined;
    const dev = await this.transport.connect(interactive);
    this.ready = true;
    return dev;
  }

  send(bytes: Uint8Array, interactive: boolean): Promise<PairedDevice | undefined> {
    const run = async () => {
      const dev = await this.ensure(interactive);
      try {
        await this.transport.write(bytes);
      } catch (err) {
        this.ready = false; // reconnect next time
        throw err;
      }
      return dev;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close() {
    this.ready = false;
    await this.transport.close();
  }
}

const sessionKey = (c: PrinterConfig) => [c.transport, c.baudRate, c.bridgeUrl, c.bridgePrinter, c.bridgeToken ? "t" : "", c.deviceHint].join("|");

/** Forgets cached connections (tests, "forget printer"). */
export async function resetPrinterSessions() {
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(all.map((s) => s.close()));
}

function failure(err: unknown): DirectResult {
  if (err instanceof PrintError) return { ok: false, code: err.code, message: err.message };
  return { ok: false, code: "io", message: (err as Error)?.message };
}

async function send(config: PrinterConfig, bytes: Uint8Array, o: DirectOptions): Promise<{ paired?: PairedDevice } | DirectResult> {
  const sel = selectTransport(config, o.env ?? browserEnv());
  if (!sel.transport) return { ok: false, code: sel.reason === "not_configured" ? "not_configured" : sel.reason === "unsupported" ? "unsupported" : "unsupported_url" };
  const key = sessionKey(config);
  let s = sessions.get(key);
  if (!s) {
    s = new Session(sel.transport);
    sessions.set(key, s);
  }
  try {
    return { paired: await s.send(bytes, o.interactive ?? false) };
  } catch (err) {
    if (err instanceof PrintError && (err.code === "unsupported" || err.code === "cancelled")) sessions.delete(key);
    return failure(err);
  }
}

const isResult = (v: unknown): v is DirectResult => !!v && typeof v === "object" && "ok" in v;

function bytesOptions(config: PrinterConfig, o: DirectOptions) {
  return {
    charsPerLine: config.charsPerLine || defaultCharsPerLine(config.paperWidth),
    widthDots: config.widthDots || defaultWidthDots(config.paperWidth),
    cut: config.cut,
    drawerPin: config.drawerPin,
    drawer: o.drawer ? ("after" as const) : ("none" as const),
    rasterize: o.rasterize ?? (canRasterize() ? createCanvasRasterizer() : undefined),
  };
}

/**
 * Prints a receipt on the configured printer. Resolves (never rejects) with `ok: false` and a code when the browser
 * print should be used instead: the caller shows a short note and falls back.
 */
export async function printReceiptDirect(config: PrinterConfig, data: ReceiptData, o: DirectOptions = {}): Promise<DirectResult> {
  if (!isDirectConfigured(config)) return { ok: false, code: "not_configured" };
  try {
    const merged: ReceiptData = {
      ...data,
      headerLines: [...(config.headerLines ?? []), ...(data.headerLines ?? [])],
      footerLines: [...(data.footerLines ?? []), ...(config.footerLines ?? [])],
    };
    const rows = formatReceipt(merged, { showQr: config.showQr, logo: o.logo ?? null });
    const opts = bytesOptions(config, o);
    if (opts.rasterize) await prepareRaster();
    const built = rowsToBytes(rows, opts);
    const res = await send(config, built.bytes, o);
    if (isResult(res)) return res;
    return { ok: true, raster: built.raster, lossy: built.lossy, paired: res.paired };
  } catch (err) {
    return failure(err);
  }
}

/** Opens the cash drawer without printing ("No sale"). */
export async function openDrawerDirect(config: PrinterConfig, o: DirectOptions = {}): Promise<DirectResult> {
  if (!isDirectConfigured(config)) return { ok: false, code: "not_configured" };
  const res = await send(config, drawerKickBytes(config.drawerPin), o);
  return isResult(res) ? res : { ok: true, raster: false, lossy: false, paired: res.paired };
}

/** Test page; from the Settings button, so `interactive` is normally true (this is where pairing happens). */
export async function printTestPage(config: PrinterConfig, shopName: string, o: DirectOptions & { locale?: "en" | "ta" } = {}): Promise<DirectResult> {
  if (!isDirectConfigured(config)) return { ok: false, code: "not_configured" };
  try {
    const opts = bytesOptions(config, { ...o, drawer: false });
    if (opts.rasterize) await prepareRaster();
    const rows = testPageRows(shopName, { charsPerLine: opts.charsPerLine, widthDots: opts.widthDots, locale: o.locale });
    const built = rowsToBytes(rows, opts);
    const res = await send(config, built.bytes, { ...o, interactive: o.interactive ?? true });
    return isResult(res) ? res : { ok: true, raster: built.raster, lossy: built.lossy, paired: res.paired };
  } catch (err) {
    return failure(err);
  }
}

/** Pairing only (the Pair button): asks for permission and opens the printer without printing. */
export async function pairPrinter(config: PrinterConfig, o: DirectOptions = {}): Promise<DirectResult> {
  if (!isDirectConfigured(config)) return { ok: false, code: "not_configured" };
  const sel = selectTransport(config, o.env ?? browserEnv());
  if (!sel.transport) return { ok: false, code: sel.reason === "not_configured" ? "not_configured" : sel.reason === "unsupported" ? "unsupported" : "unsupported_url" };
  const key = sessionKey(config);
  let s = sessions.get(key);
  if (!s) {
    s = new Session(sel.transport);
    sessions.set(key, s);
  }
  try {
    const paired = await s.ensure(o.interactive ?? true);
    return { ok: true, raster: false, lossy: false, paired };
  } catch (err) {
    sessions.delete(key);
    return failure(err);
  }
}

export { loadLogoBitmap };
